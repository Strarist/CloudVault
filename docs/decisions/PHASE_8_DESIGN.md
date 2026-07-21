# Phase 8 Architecture Proposal: AI Processing Pipeline

This document designs the async worker queue and text extraction pipeline for **Phase 8: AI Infrastructure**.

---

## 📊 Pipeline Workflow

```text
File Uploaded
  │
  ▼
Supabase Object Created
  │
  ▼
Mongo Metadata & FileVersion Saved
  │
  ▼
Workspace AI Enabled Check ─────[No]─────▶ End (No AI Job)
  │ [Yes]
  ▼
AI Job Created in MongoDB (PENDING)
  │
  ▼
Worker Polls Job (Atomically Sets status to PROCESSING)
  │
  ▼
Worker Downloads File from Supabase & Extracts Text
  │
  ▼
OpenAI Summary & Tags Generation
  │
  ▼
Generate Vector Embeddings
  │
  ▼
Save Summary & Embeddings (Update File metadata)
  │
  ▼
Job Status Set to COMPLETED
```

---

## 🛠️ Queue Architecture & Database Schema

To avoid introducing heavy external infrastructure (such as Redis/BullMQ, RabbitMQ, or Kafka) and satisfy the constraints of Phase 6 & 6.5, we will implement a **database-backed job queue** in MongoDB using the `AIJob` collection.

### Schema Definition
```typescript
interface IAIJob {
  fileId: mongoose.Types.ObjectId;
  fileVersionId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  errorLogs: Array<{
    timestamp: Date;
    error: string;
    stack?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
```

### Database Indexes
* **Unique Processing Constraint**: Compound index `{ fileId: 1, fileVersionId: 1 }` (unique) to guarantee no double-queueing of a single physical revision.
* **Worker Polling Index**: Compound index `{ status: 1, runAfter: 1, createdAt: 1 }` to query the oldest pending job that is ready to run.
* **Workspace Cleanup Index**: Index `{ workspaceId: 1, status: 1 }` to cancel jobs if a workspace disables AI.

---

## 🔑 Answers to Core Architectural Questions

### 1. How are jobs created?
Jobs are created inside a post-upload database hook or transaction context. Once a file upload successfully yields both a MongoDB metadata entry and a physical `FileVersion` record, the application queries the parent workspace's `aiEnabled` flag. If `true`, a job document is inserted into the `AIJob` collection with state `'PENDING'`.

### 2. Where are jobs stored?
Jobs are persisted in the MongoDB `aijobs` collection. This gives the queue durability, transaction capability, and audit visibility out-of-the-box, using existing database connections.

### 3. How are retries handled?
If job processing throws an exception, the worker catches the error, increments the `attempts` count, and updates the job. If `attempts < maxAttempts` (default `3`), the job status is set back to `'PENDING'`, and the `runAfter` timestamp is set to a future date using exponential backoff:
$$\text{runAfter} = \text{Date.now()} + (\text{attempts} \times 5 \text{ minutes})$$

### 4. How are failures tracked?
If `attempts` reaches `maxAttempts`, the status transitions to `'FAILED'`. The worker logs the last error object, stack trace, and timestamps inside the `errorLogs` array. A `'FAILED'` status triggers an immutable `ActivityLog` entry of type `AI_PROCESSING_FAILED` to alert workspace administrators.

### 5. How do we prevent duplicate processing?
Workers avoid race conditions using atomic database updates. A worker fetches a job using `findOneAndUpdate`:
```typescript
const job = await AIJob.findOneAndUpdate(
  {
    status: 'PENDING',
    runAfter: { $lte: new Date() }
  },
  {
    $set: { status: 'PROCESSING', updatedAt: new Date() }
  },
  {
    sort: { createdAt: 1 }, // FIFO
    new: true
  }
);
```
Since MongoDB executes this operation atomically, only one worker process can acquire the job.

### 6. How do we reprocess a file after a new version is uploaded?
Each version of a file is represented by a unique `FileVersion` object in MongoDB. When a new file version is uploaded, a distinct `FileVersionId` is created, which triggers a separate job entry linked to that new version. Older version summaries are kept, and the parent file's active summary updates to reference the output of the latest version processing job.

### 7. How do we disable AI for a workspace while jobs already exist?
When a workspace owner toggles AI off:
1. An API call sets the workspace's `aiEnabled` flag to `false`.
2. A background query immediately transitions all related pending or processing jobs to `'CANCELLED'`:
   ```typescript
   await AIJob.updateMany(
     { workspaceId, status: { $in: ['PENDING', 'PROCESSING'] } },
     { $set: { status: 'CANCELLED' } }
   );
   ```
3. Immediate safety check: Immediately before processing any job, the worker queries the workspace configuration. If `aiEnabled === false`, the worker cancels the job, deletes downloaded temporary chunks, and exits the execution thread.

---

## 🔍 Senior Engineering Review Sections

### Architectural Observations
* **Metadata-Only Integrity**: The queue relies on reference keys. The physical document is retrieved temporarily using pre-signed URLs from Supabase. The worker never holds the document permanently, preventing file duplication on the disk.
* **Low Operational Overhead**: Bypassing external message queues (Redis/RabbitMQ) keeps deployment trivial. The app scales horizontally using standard database connections.

### Future Risks
* **OpenAI API Latency & Rate Limits**: Heavy batch uploads can exhaust token limits.
  * *Mitigation*: The worker queue handles HTTP 429 rate limit exceptions, reads `Retry-After` headers, and updates the `runAfter` field to pause processing.
* **Document Extraction Failures**: Large, encrypted, or corrupted PDFs can cause text extractors to crash.
  * *Mitigation*: Workers execute text extraction inside isolated worker threads or wrapper functions with strict execution timeouts (e.g. 30 seconds max) to protect the main process.

### Technical Debt Register
* **TD-038**: Job Queue Purging Policy. Old completed or cancelled jobs should be pruned to prevent table bloat.
* **TD-039**: Worker Thread Pool Sizing. Static worker counts may lead to queue backlogs under heavy parallel uploads.

### Future Phase Dependencies
* **Phase 9: AI Features**: Depends directly on Phase 8 summaries and tag outputs.
* **Phase 11: Semantic Search**: Depends on Phase 8 vector generation models.

### Open Questions
* *What is the maximum allowed text extraction size?* Extremely large documents (e.g. 500-page books) should be truncated or rejected during extraction to prevent memory issues.
* *Do we support optical character recognition (OCR) for scanned PDFs?* Standard text extraction fails on scanned images. If required, a heavier worker container with Tesseract will be needed.

### Scalability Analysis
MongoDB-based queueing scales comfortably up to hundreds of thousands of jobs. If workspace files grow to millions, indexing on `{ status: 1, runAfter: 1 }` guarantees that polling queries only scan the active working set, maintaining low CPU usage.

### Operational Complexity Analysis
Minimal. No additional Docker containers or services are required. Deployment uses existing Express and MongoDB resources.

### Migration Cost Analysis
Zero database migrations required. The new `aijobs` collection is independent of existing business logic, making it fully backward-compatible.

---

## 🛠️ Detailed AI Design Review (AI-001 to AI-007)

### AI-001: AI Artifacts Ownership (File vs FileVersion)
* **Decision**: AI artifacts (Extracted Text, Summary, Tags, Embeddings) belong to **FileVersion**, not File.
* **Justification**:
  1. **Mutability of Content**: A `File` is a mutable pointer that updates when new versions are uploaded. As the underlying binary shifts (e.g., v1 -> v2), the summary and embeddings must also shift. Grouping AI results under `FileVersion` prevents data mismatch issues (such as returning a v1 summary for a v2 document).
  2. **Rollback Efficiency**: If a workspace editor rolls back the file to v1, we can immediately swap active summaries and tag caches without re-processing or calling OpenAI again. We simply lookup the `FileVersion` marked as active and display its associated AI results.
  3. **Multi-Version Semantic Indexing**: Semantic search (Phase 11) queries vector databases. By storing embeddings per version, we can enable version-history search, or restrict queries to only search the active version of each file at query time without destroying historical vector weights.

### AI-002: Idempotency & Duplicate Prevention Strategy
* **Idempotency Key**: The compound unique key `(fileId, fileVersionId)` acts as the natural idempotency key.
* **idempotency Strategy**:
  1. **Job Creation**: The `AIJob` schema applies a strict unique compound index: `db.aijobs.createIndex({ fileId: 1, fileVersionId: 1 }, { unique: true })`. Any duplicate call to queue a processing job for an already-registered version will trigger a MongoDB error (code `11000`) and be ignored safely.
  2. **Atomic Worker Acquisition**: Multiple workers polling the queue use MongoDB's atomic `findOneAndUpdate` to transitions a job status from `PENDING` to `PROCESSING`. The worker that successfully locks the document owns the job; other workers receive `null` and move on.
  3. **Crash Recovery Lock**: Each job in `PROCESSING` tracks `updatedAt`. If a worker crashes, a lock-timeout task checks for jobs in `PROCESSING` with `updatedAt` older than 15 minutes and automatically resets them to `PENDING` (incrementing the `attempts` count) to prevent orphaned locks.

### AI-003: Database Schemas for AI Results
To avoid bloating the `FileVersion` collection during standard file lists or folder scans, we store the resulting artifacts in a dedicated `AIResult` collection:

```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IAIResult extends Document {
  fileId: mongoose.Types.ObjectId;
  fileVersionId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  summary: string;
  tags: string[];
  extractedTextStorageKey?: string; // Reference to text stored in Supabase if large (> 50KB)
  extractedTextCache?: string;      // Inline cache of extracted text if small (< 50KB)
  embedding: number[];              // Vector embeddings (e.g. 1536 float array)
  createdAt: Date;
}

const aiResultSchema = new Schema<IAIResult>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    fileVersionId: { type: Schema.Types.ObjectId, ref: 'FileVersion', required: true, unique: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    summary: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true }],
    extractedTextStorageKey: { type: String },
    extractedTextCache: { type: String },
    embedding: { type: [Number], required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
aiResultSchema.index({ fileVersionId: 1 }, { unique: true });
aiResultSchema.index({ workspaceId: 1 });
aiResultSchema.index({ fileId: 1 });

export const AIResult = mongoose.model<IAIResult>('AIResult', aiResultSchema);
```

### AI-004: User-Facing Statuses & Dashboard Behavior
We map the status of the AI pipeline to the user via the `aiStatus` field in the `File` model:
* **`PENDING` / `PROCESSING`**:
  - *UI Render*: A pulsing sparkles icon or small loader labeled *"AI Summarizing..."* is displayed next to the filename in the files table.
  - *Behavior*: Clicking the summary button or tab is disabled, showing a tooltip: *"AI is processing this version. Please wait."*
* **`READY`**:
  - *UI Render*: A solid green/indigo Sparkles icon appears next to the file.
  - *Behavior*: Clicking the icon opens the Comments & AI drawer, instantly showing the markdown-rendered summary and interactive tag bubbles.
* **`FAILED`**:
  - *UI Render*: A warning icon next to the filename.
  - *Behavior*: Tooltip shows: *"AI summarization failed. Click to retry."* Clicking it prompts the backend to schedule a fresh retry job.

### AI-005: Worker Concurrency Safety (Atomic Claims)
To demonstrate that multiple workers cannot claim the same job, consider the following timeline:
1. **Initial State**: Job A is in `aijobs` collection with `{ status: "PENDING", runAfter: { $lte: now } }`.
2. **Step 1 (Parallel Query)**: Worker 1 and Worker 2 both issue a `findOneAndUpdate` command filtering for `status: "PENDING"`.
3. **Step 2 (DB Locks)**: MongoDB acquires a write lock on Job A's document.
4. **Step 3 (Worker 1 Success)**: Worker 1's write lock is processed first. The document is modified to `{ status: "PROCESSING" }` and returned to Worker 1.
5. **Step 4 (Worker 2 Skip)**: Worker 1's write lock is released. Worker 2's command is evaluated against the same document. However, the filter condition `status: "PENDING"` is no longer met. MongoDB returns `null` to Worker 2, preventing double processing.

### AI-006: File Deletion Cleanup Strategy
When a logical `File` is hard-deleted from CloudVault, the following cascade is executed programmatically:
1. **Cancel Active Jobs**: Delete all pending/processing entries in the `AIJob` collection for this `fileId`.
2. **Purge Metadata & Embeddings**: Delete all associated `AIResult` documents from MongoDB, freeing database space and removing vector embeddings.
3. **Binaries Removal**: Invoke Supabase Storage SDK to recursively delete the file versions and any associated extracted text logs from the private bucket (e.g., deleting bucket path `workspaceId/fileId/*`).
*Note*: For soft-deletes (`deletedAt !== null`), AI results and jobs remain intact but are hidden from frontend views and skipped during semantic search.

### AI-007: Version Reprocessing Strategy
When a user uploads a new version (v2) of an existing file:
1. **Create Version Metadata**: A new `FileVersion` record (v2) is saved.
2. **Preserve History**: The existing `FileVersion` for v1 and its `AIResult` document remain unchanged, maintaining history.
3. **Trigger Pipeline**: A new `AIJob` is queued with `{ fileId, fileVersionId: v2Id, status: 'PENDING' }`.
4. **Update File Pointers**: The parent `File` model sets `aiStatus` to `'PENDING'` during processing. Once the v2 job completes, the `File`'s active summary cache and tags are updated to match v2's results.

