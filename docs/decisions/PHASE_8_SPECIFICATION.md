# Phase 8 Implementation Specification Review: AI Infrastructure

This document outlines the complete architectural specification for **Phase 8: AI Infrastructure** before implementation begins.

---

## SECTION 1 – AIJOB SCHEMA DESIGN

The `AIJob` collection serves as a persistent, durable, database-backed priority queue to manage document processing tasks asynchronously.

### Database Schema Specification
```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IAIJob extends Document {
  workspaceId: mongoose.Types.ObjectId;
  fileId: mongoose.Types.ObjectId;
  fileVersionId: mongoose.Types.ObjectId;
  jobType: 'SUMMARIZE_AND_EMBED' | 'OCR' | 'CLASSIFICATION' | 'CUSTOM';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  attemptCount: number;
  maxAttempts: number;
  priority: number; // 0 = High (manual retry), 1 = Standard (new upload), 2+ = Low (retry backoffs)
  lastError?: {
    message: string;
    stack?: string;
    timestamp: Date;
    errorType: 'TRANSIENT' | 'PERMANENT';
  };
  runAfter: Date;
  claimedAt?: Date;
  workerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const aiJobSchema = new Schema<IAIJob>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    fileVersionId: { type: Schema.Types.ObjectId, ref: 'FileVersion', required: true },
    jobType: {
      type: String,
      enum: ['SUMMARIZE_AND_EMBED', 'OCR', 'CLASSIFICATION', 'CUSTOM'],
      default: 'SUMMARIZE_AND_EMBED',
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
    },
    attemptCount: { type: Number, default: 0, required: true },
    maxAttempts: { type: Number, default: 3, required: true },
    priority: { type: Number, default: 1, required: true },
    lastError: {
      message: { type: String },
      stack: { type: String },
      timestamp: { type: Date },
      errorType: { type: String, enum: ['TRANSIENT', 'PERMANENT'] },
    },
    runAfter: { type: Date, default: Date.now, required: true },
    claimedAt: { type: Date },
    workerId: { type: String },
  },
  {
    timestamps: true,
  }
);
```

### Required Indexes
To maintain high performance and enforce version-level multi-job support:
1. **Priority FIFO Worker Polling**:
   ```javascript
   db.aijobs.createIndex({ status: 1, priority: 1, runAfter: 1, createdAt: 1 })
   ```
2. **Idempotency & Job Type Isolation**:
   ```javascript
   db.aijobs.createIndex({ fileVersionId: 1, jobType: 1 }, { unique: true })
   ```
3. **Workspace Operations & Toggles**:
   ```javascript
   db.aijobs.createIndex({ workspaceId: 1, status: 1 })
   ```

### Idempotency & Queue Protection Strategy
* **Duplicate Uploads**: Each upload creates a unique `FileVersion` ID. This acts as a fresh revision which naturally schedules a separate job.
* **Duplicate Job Creation**: The compound unique index on `{ fileVersionId, jobType }` prevents double-insertions. If a route attempts to queue a duplicate job, MongoDB triggers error `11000` (Duplicate Key), which is handled gracefully by returning the existing job.
* **Worker Crash Recovery**: Locked jobs in `PROCESSING` whose lock has expired are reset to `PENDING` via a background recovery daemon (detailed in Section 3).
* **Worker Instance Restart**: On boot, a worker instance queries the collection for any jobs currently locked under its `workerId` and releases them back to `PENDING` status.

---

## SECTION 2 – AIRESULT SCHEMA DESIGN

AI results are stored in an independent collection to isolate heavy vector models and summaries from standard metadata list views.

### Database Schema Specification
```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IAIResult extends Document {
  workspaceId: mongoose.Types.ObjectId;
  fileId: mongoose.Types.ObjectId;
  fileVersionId: mongoose.Types.ObjectId;
  schemaVersion: number; // For schema evolution (default = 1)
  summary: string;
  tags: string[];
  extractedTextStorageKey?: string; 
  extractedTextCache?: string; // Inline cached raw text, max 50KB, UTF-8 safe
  embedding: number[];              
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingVersion: number;
  modelProvider: string;
  modelName: string;
  modelVersion: string;
  generatedAt: Date;
}

const aiResultSchema = new Schema<IAIResult>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    fileVersionId: { type: Schema.Types.ObjectId, ref: 'FileVersion', required: true },
    schemaVersion: { type: Number, default: 1, required: true },
    summary: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true }],
    extractedTextStorageKey: { type: String },
    extractedTextCache: { type: String },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, required: true },
    embeddingDimensions: { type: Number, required: true },
    embeddingVersion: { type: Number, required: true },
    modelProvider: { type: String, required: true },
    modelName: { type: String, required: true },
    modelVersion: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now, required: true },
  },
  {
    timestamps: { createdAt: 'generatedAt', updatedAt: false },
  }
);
```

### Extracted Text Cache Policy
* **Field Name**: `extractedTextCache`
* **Truncation Behavior**: If the raw extracted text is $\le 50$ KB, it is saved directly to this field. If it exceeds $50$ KB, it is truncated to exactly $50$ KB (byte-safe UTF-8 boundary slicing using `Buffer.byteLength`), appending `\n\n[TRUNCATED_RAW_TEXT_IN_SUPABASE]`. The full text is always saved to Supabase.
* **UTF-8 Safety**: String slicing is performed on byte buffers, ensuring that multi-byte characters (e.g. emojis or non-ASCII characters) are not sliced in the middle of their byte sequence.
* **Cache Invalidation Rules**: Since `AIResult` is bound to an immutable `FileVersion`, the cache is read-only and never invalidated post-generation.

### Extracted Text Storage Recommendation
* **Decision**: **Option B (Store inside Supabase)**.
* **Justification**:
  - **Storage Costs**: Cloud object storage (Supabase S3) is $\approx 10\times$ cheaper per GB than MongoDB Atlas. Storing large text files (especially multi-MB manuals) would rapidly bloat MongoDB disk storage.
  - **Retrieval Costs**: Extracted text is only read once during search indexing or summary updates. Loading megabytes of text into Node.js memory during standard API metadata reads degrades garbage collection performance.
  - **Debugging Costs**: Storing `.txt` logs in Supabase makes them easy to view and audit directly via the Supabase dashboard interface.
  - **Future Search Implications**: Atlas Search or Elasticsearch can index the Supabase text file directly. 

### Required Indexes
```javascript
db.airesults.createIndex({ fileVersionId: 1 }, { unique: true })
db.airesults.createIndex({ fileId: 1 })
db.airesults.createIndex({ workspaceId: 1 })
```

---

## SECTION 3 – WORKER LIFECYCLE DESIGN

### Concurrency Safety (Atomic Claiming)
Multiple workers polling the queue use MongoDB's atomic `findOneAndUpdate` lock-and-claim mechanism:
```typescript
const job = await AIJob.findOneAndUpdate(
  {
    status: 'PENDING',
    runAfter: { $lte: new Date() }
  },
  {
    $set: {
      status: 'PROCESSING',
      claimedAt: new Date(),
      workerId: UNIQUE_WORKER_ID
    }
  },
  {
    sort: { priority: 1, runAfter: 1, createdAt: 1 }, // Priority FIFO
    new: true
  }
);
```
#### Mathematical Concurrency Safety Proof
1. Suppose $N$ workers execute this query concurrently for Job $X$.
2. MongoDB's transactional storage engine places an exclusive write lock on Job $X$'s document during the update phase.
3. Worker $1$ acquires the lock. The document state transitions from `PENDING` to `PROCESSING`. Worker $1$ receives the updated document.
4. Worker $2$ through $N$'s query filters are subsequently evaluated. Since the document status is no longer `PENDING`, the query returns `null`.
5. Worker $2$ through $N$ bypass Job $X$ and claim subsequent pending jobs, preventing double-processing.

### Processing Lifecycle Flow
1. **Claim**: Acquire job atomically.
2. **Validate Workspace AI State**: Fetch the workspace. If `aiEnabled` is `false`, set status to `'CANCELLED'` and exit.
3. **Validate File State**: Verify the file and version document exist and are not hard-deleted.
4. **Get Read Stream**: Obtain a pre-signed, temporary 60-second download URL from Supabase Storage.
5. **Extract Text**: Download document and extract raw text (PDF/TXT/DOCX content).
6. **Upload Text Object**: Write raw text payload to Supabase (`workspaceId/fileId/vVersion/extracted.txt`).
7. **Generate Summary & Tags**: Call OpenAI model using the text.
8. **Generate Embeddings**: Call Embedding API using the text.
9. **Store Result**: Save the `AIResult` document.
10. **Mark Completed**: Set job status to `COMPLETED` and update the File's `aiStatus` to `READY`.

### Crash Recovery & Lock Timeout Formula
Instead of an arbitrary constant, the lock timeout is calculated dynamically:
$$\text{LockTimeout} = \max(15 \text{ minutes}, 3 \times \text{average processing duration})$$
The worker recovery daemon runs every 5 minutes, querying:
```javascript
db.aijobs.updateMany(
  { 
    status: 'PROCESSING', 
    claimedAt: { $lt: new Date(Date.now() - LockTimeout) } 
  },
  { 
    $set: { status: 'PENDING', claimedAt: null, workerId: null }, 
    $inc: { attemptCount: 1, priority: 1 } // Lower priority on retry
  }
)
```

---

## SECTION 4 – FILEVERSION OWNERSHIP REVIEW

### Confirmed Ownership
AI Results belong strictly to the **`FileVersion`**, not the `File`.

### Version Independence
* Each physical upload yields a unique `FileVersion` ID.
* The `AIResult` holds a unique index on `fileVersionId`.
* Summaries and vector embeddings for `v1`, `v2`, and `v3` remain completely isolated and durable.

### Rollback Scenario
1. Current active version of a file is `v3`.
2. User triggers a rollback to `v2`.
3. The server updates the logical `File` pointer `currentVersionId = v2Id`.
4. When the frontend displays details, it queries the `AIResult` using `fileVersionId = v2Id`.
5. The correct v2 summaries and tag sets are retrieved instantly with zero reprocessing latency or API billing overhead.

---

## SECTION 5 – CLEANUP STRATEGY

### Soft Delete
* **Decision**: AI artifacts **remain intact** during soft-deletion.
* **Justification**: Users can restore soft-deleted files. Keeping the AI results avoids expensive reprocessing and LLM API re-calls upon restoration. During searches, the index filters out records where the parent `File` has `deletedAt !== null`.

### Permanent Delete Sequence
When a file is hard-deleted from the workspace:
1. **Queue Cleanup**: Delete all `AIJob` entries linked to the `fileId`.
2. **Result Cleanup**: Delete all `AIResult` entries linked to the `fileId`.
3. **Storage Cleanup**: Delete all binaries in Supabase Storage matching path: `${workspaceId}/${fileId}/*` (this purges raw uploads and extracted text files in a single API call).

---

## SECTION 6 – USER EXPERIENCE DESIGN

### File AI Status Indicators
* **`PENDING`**: Display *"Queued For Processing"* (disabled, showing grey sparkles icon).
* **`PROCESSING`**: Display *"Generating Insights..."* (pulsing loader).
* **`READY`**: Display *"AI Available"* (clickable green sparkles icon).
* **`FAILED`**: Display *"Retry AI Processing"* (red warning icon).

### Manual Retry Flow
* **Permissions**: Requires role `EDITOR` or higher.
* **Activity Log**: Logs `AI_REPROCESS_REQUESTED` action.
* **Duplicate Prevention**: Before creating a retry job, verify that there is no job with status `PENDING` or `PROCESSING` in the queue for that file version.

---

## SECTION 7 – ACTIVITY & NOTIFICATION INTEGRATION

### Recommendation
* **Log only `AI_PROCESSING_COMPLETED` and `AI_PROCESSING_FAILED`**.
* **Justification**: Bypassing `AI_PROCESSING_STARTED` prevents workspace activity feeds from being flooded with system logs during multi-file parallel uploads, preserving clean, human-collaborative audit records.

---

## SECTION 8 – FUTURE SEARCH COMPATIBILITY

### Phase 10: Keyword Search
* Can search MongoDB `AIResult` using `$text` indexes on `tags` and `summary`.
* To search full-text contents, the server reads the Supabase text file or queries the `extractedTextCache` index.

### Phase 11: Semantic Search
* Queries cosine similarities against the `embedding` float array in `AIResult` using MongoDB Atlas Vector Search.
* The `embeddingModel`, `embeddingDimensions`, and `embeddingVersion` ensure that only compatible vectors are compared during similarity matching.

### Migration Risk Analysis
* **Risk**: The underlying embedding model changes (e.g. from OpenAI to local HuggingFace).
* **Mitigation**: The `embeddingVersion` and `embeddingModel` flags let us identify obsolete vectors. If the model is upgraded, we filter out incompatible versions and queue a reprocessing script to re-embed files dynamically.

---

## SECTION 9 – SCALABILITY REVIEW

* **100 Workspaces**: Minimal load, single worker thread handles queue easily.
* **10,000 Workspaces**: Database queries stay fast due to the compound polling index `{ status: 1, runAfter: 1 }`.
* **100,000 Workspaces**: Storing extracted text in Supabase prevents BSON overflow. Workers scale horizontally by increasing active process threads connected to the shared MongoDB database.

---

## SECTION 10 – AI JOB CREATION TRIGGER

* **Decision**: AI job creation occurs **After Upload Success** (outside the upload database transaction).
* **Justification**: AI processing is an asynchronous, secondary concern. The user's file upload and core database save must never fail due to a secondary job-scheduler connection failure. Scheduling after upload success reduces operational failure rates and simplifies debugging.

---

## SECTION 11 – WORKER RUNTIME STRATEGY (AI-008)

To avoid synchronization issues and resource contention, workers are deployed as separate processes.

* **Development Mode**:
  - The API server and the AI worker run as separate local processes in development.
  - API Server: `npm run dev`
  - AI Worker: `npm run worker` (runs `ts-node-dev --respawn src/workers/ai.worker.ts`)
* **Production Mode**:
  - The API server and the worker run in separate isolated processes/containers.
  - API Server: `npm start` (runs `node dist/app.js`)
  - AI Worker: `npm run worker:prod` (runs `node dist/workers/ai.worker.js`)
* **Monitoring**: Worker processes report status to a `worker_heartbeats` table in MongoDB every 30 seconds. A process manager (such as PM2 or Kubernetes metrics dashboard) restarts crashed processes.

---

## SECTION 12 – PROVIDER ABSTRACTION STRATEGY (AI-009)

The worker is decoupled from specific vendor APIs (OpenAI, Gemini, Claude) through a provider interface.

```typescript
export interface IAIProvider {
  providerName: string;
  generateSummary(text: string): Promise<{ summary: string; version: string }>;
  generateTags(text: string): Promise<{ tags: string[]; version: string }>;
  generateEmbedding(text: string): Promise<{ embedding: number[]; model: string; dimensions: number }>;
}
```

Concrete provider implementations (e.g., `OpenAIProvider`, `GeminiProvider`) implement this interface. The worker instantiates the provider dynamically via environment variables (`AI_PROVIDER=openai` or `AI_PROVIDER=gemini`). The worker only interacts with the `IAIProvider` interface, meaning a provider migration can be done without modifying job queue logic.

---

## SECTION 13 – EMBEDDING STORAGE REVIEW (AI-010)

### Storage Estimates (Float32 vectors = 4 bytes per float)
1. **1536 Dimensions (e.g., OpenAI text-embedding-3-small)**:
   - Size per file version: $1536 \times 4 \text{ bytes} \approx 6.14 \text{ KB}$
   - **1,000 files**: $6.14 \text{ MB}$
   - **10,000 files**: $61.4 \text{ MB}$
   - **100,000 files**: $614 \text{ MB}$
   - **1,000,000 files**: $6.14 \text{ GB}$
2. **3072 Dimensions (e.g., OpenAI text-embedding-3-large)**:
   - Size per file version: $3072 \times 4 \text{ bytes} \approx 12.29 \text{ KB}$
   - **1,000 files**: $12.29 \text{ MB}$
   - **10,000 files**: $122.9 \text{ MB}$
   - **100,000 files**: $1.23 \text{ GB}$
   - **1,000,000 files**: $12.29 \text{ GB}$

### Decision
Embeddings are stored directly inside MongoDB in the `AIResult` collection. MongoDB Atlas natively supports vector index structures ("Atlas Vector Search") on numeric arrays without requiring a separate vector database. This keeps our monolith clean, avoids external service dependencies, and scales efficiently past 1M+ documents.

---

## SECTION 14 – QUEUE STARVATION ANALYSIS (AI-011)

### The Risk
Strict FIFO queues can suffer from starvation if large bulk uploads (e.g., 10,000 files) block the queue, causing new manual uploads or urgent retries to hang.

### Priority Queue Strategy
We implement a **Priority Queue** in `AIJob`. We assign job priorities:
* **Priority `0` (High)**: Triggered by user-driven "Manual Retry" clicks.
* **Priority `1` (Standard)**: New uploads.
* **Priority `2+` (Low)**: Retrying failed tasks (assigned sequentially as $attemptCount$ increases).

The worker queries:
```typescript
const job = await AIJob.findOneAndUpdate(
  { status: 'PENDING', runAfter: { $lte: new Date() } },
  { $set: { status: 'PROCESSING', claimedAt: new Date(), workerId } },
  { sort: { priority: 1, runAfter: 1, createdAt: 1 }, new: true }
);
```
This forces new uploads and manual retries to bypass backlogged failed tasks.

---

## SECTION 15 – AI COST GOVERNANCE (AI-012)

To prevent API cost spikes and credential abuse:

* **Workspace Limits**:
  - **Free Tier Workspace**: Limit of 100 AI processing jobs per calendar month.
  - **Pro Tier Workspace**: Limit of 1,000 AI processing jobs per calendar month.
* **Monthly Usage Tracking**:
  - The `Workspace` collection tracks `aiJobsProcessedThisMonth`. It is reset on the 1st of each month via a cron scheduler.
  - Job creation checks: If `aiJobsProcessedThisMonth >= MonthlyLimit`, job scheduler rejects the task, and the file `aiStatus` is marked as `'FAILED'` with a descriptive error tooltip: *"Workspace AI monthly limit reached."*
* **Abuse Control**:
  - **Retry Cap**: Strict `maxAttempts` limit of `3`. No auto-retries occur once a job fails 3 times.
  - **Throttling**: If a single workspace submits $>50$ file uploads within 5 minutes, subsequent jobs are scheduled with a 30-minute deferred `runAfter` timestamp.

---

## SECTION 16 – SEARCH DEPENDENCY CONTRACT (AI-013)

### The Contract
The Phase 10 (Keyword Search) and Phase 11 (Semantic Search) layers rely *exclusively* on structured fields within the `AIResult` collection. Search features must **NEVER** parse raw text files or interact with external AI providers directly.

### Searchable Fields
* `AIResult.summary` (string)
* `AIResult.tags` (array of strings)
* `AIResult.embedding` (array of floats)
* `AIResult.embeddingModel` (string)
* `AIResult.embeddingVersion` (number)
* `AIResult.modelVersion` (string)

---

## SECTION 17 – OBSERVABILITY STRATEGY (AI-014)

### Metrics Collection
The worker monitors and exposes (via an admin dashboard API):
* **Queue Depth**: Count of jobs where `status === 'PENDING'`.
* **Failed Jobs**: Count of jobs where `status === 'FAILED'`.
* **Average Processing Time**: Average duration `(updatedAt - claimedAt)` of completed jobs.
* **Provider Error Count**: Aggregated counts of errors grouped by `lastError.message`.
* **Active Worker Count**: Heartbeat count from `worker_heartbeats`.

### Event Log Triggers
Every job transitions logs structured events containing `jobId`, `fileVersionId`, and `workspaceId`:
* `AI_JOB_CREATED`: Logged when a job is scheduled.
* `AI_JOB_CLAIMED`: Logged when a worker locks a job.
* `AI_JOB_COMPLETED`: Logged upon successful summary/vector generation.
* `AI_JOB_FAILED`: Logged when a job fails (includes error code/stack).
* `AI_JOB_RETRIED`: Logged when a job is sent back to the queue with backoff.
* `AI_JOB_CANCELLED`: Logged when a workspace owner disables AI.

---

## SECTION 18 – REPROCESSING STRATEGY (AI-016)

When model upgrades occur (e.g. migrating embeddings from OpenAI `v1` to `v2`):

1. **Reprocessing Trigger**: An admin utility script is executed:
   - Queries all active `FileVersion` IDs.
   - Bulk-inserts a new `AIJob` for each version with the new model type (e.g. `jobType: 'SUMMARIZE_AND_EMBED'`), setting `priority: 3` (lowest priority).
2. **Throttling**: The upgrade jobs run in the background. Polling limits them to 5% of total worker capacity to prevent workspace performance drops and protect API budgets.
3. **User Transparency**: The UI displays a notification banner: *"We are optimizing your workspace search index. Summaries remain available."*
4. **Transition & Rollback**:
   - The active `FileVersion` references `AIResult` `schemaVersion = 1`.
   - Once the upgrade job finishes, a new `AIResult` with `schemaVersion = 2` is created. The pointer is atomically swapped.
   - If the new model behaves poorly, rollback is performed by changing the system config to use `schemaVersion = 1`, bypassing the new index.

---

## SECTION 19 – WORKER SHUTDOWN SAFETY (AI-017)

To prevent job disruption and database lock starvation during updates, workers must shut down gracefully:

1. **Shutdown Listeners**: The worker listens for `SIGTERM` and `SIGINT` operating system signals.
2. **Halt Polling**: Upon signal detection, the worker sets `pollingEnabled = false` immediately to refuse any new queue claims.
3. **Complete Active Job**: If a job is currently in `PROCESSING` on the thread, the worker awaits its completion or rolls it back safely.
4. **Flush Logs**: Flushes all internal buffer logs and audit records to MongoDB.
5. **Exit Process**: Calls `process.exit(0)` cleanly.

---

## SECTION 20 – PROVIDER RATE LIMIT HANDLING (AI-018)

AI Provider API errors must be categorized to prevent transient hiccups from exhausting retry counts and terminating tasks prematurely.

### Error Classification Table
| Error Source / Code | Classification | Action | Count Against Retries? |
|---------------------|----------------|--------|------------------------|
| **HTTP 429 (Rate Limit)** | `TRANSIENT` | Pause worker polling + set deferred `runAfter` | **No** (Reschedules with backoff) |
| **HTTP 503 / 504 (Gateway Timeout)** | `TRANSIENT` | Exponential backoff retry | **No** (Reschedules with backoff) |
| **Network Failure (DNS/TCP Reset)** | `TRANSIENT` | Backoff retry | **No** (Reschedules with backoff) |
| **Invalid Request (400 bad payload)** | `PERMANENT` | Set status directly to `FAILED` | **Yes** (Stops execution) |
| **Authentication Error (Invalid API Key)** | `PERMANENT` | Set status directly to `FAILED` | **Yes** (Stops execution) |

*Implementation Note*: Non-transient errors increment the `attemptCount`. If a transient error occurs, the job's `runAfter` timestamp is delayed by a factor of the failure count, but does *not* increment the `attemptCount` immediately unless it fails consistently for more than 5 consecutive attempts.

---

## SECTION 21 – AI RESULT INTEGRATION & ATOMICITY (AI-019)

To prevent corrupted or partially written summaries and tag sets, the worker uses a **single final atomic write**:

1. **Temporary Memory Cache**: As the worker completes summary generation, tag extraction, and embedding calculation, all results are aggregated inside the local JS process memory.
2. **Atomic Write Transaction**: Once all three operations succeed, the worker executes a single write:
   - Creates the `AIResult` document.
   - Sets the active version pointer `FileVersion.aiStatus = 'READY'`.
3. **No Partial Writes**: If any individual step (e.g. embedding fails after summary completes) throws, the database transaction/operation is abandoned, and nothing is written to `AIResult`, ensuring clean database integrity.

---

## SECTION 22 – FUTURE ENUM RESERVATIONS (AI-020)

To avoid migration churn in later phases (Search, Semantic Search, OCR, Classification), the following values are officially reserved:

* **Job Types (`AIJob.jobType`)**:
  - `SUMMARIZE_AND_EMBED` (Active)
  - `OCR` (Reserved)
  - `CLASSIFICATION` (Reserved)
  - `CUSTOM` (Reserved)
