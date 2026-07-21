# ADR-007: Document Intelligence Contract Freeze

## Status
ACCEPTED

## Context
As CloudVault transitions from an AI-capable infrastructure to an AI-powered document workspace, the frontend requires stable interfaces to consume document intelligence results. To maintain clean separation of concerns and ensure that queue implementation details (e.g., job IDs, recovery states, retries) do not leak into the presentation layer, we must establish and freeze the boundaries of the Document Intelligence API.

## Decisions

### 1. AI Result Shape
The frontend retrieves the document intelligence summary, tags, and AI model metadata via `GET /workspaces/:workspaceId/files/:fileId/ai`.
The shape of this response is strictly frozen as follows:
```json
{
  "status": "READY" | "PROCESSING" | "PENDING" | "FAILED" | "NOT_STARTED",
  "summary": "...",
  "tags": ["aws", "cloud", "resume"],
  "modelName": "mock-ai",
  "modelVersion": "1.0",
  "generatedAt": "ISO-8601-Timestamp" | null
}
```

### 2. Extracted Text Shape
The frontend retrieves raw document content via `GET /workspaces/:workspaceId/files/:fileId/text`.
The shape of this response is strictly frozen as follows:
```json
{
  "content": "...",
  "truncated": true | false
}
```

### 3. Reprocess Flow
To allow manual regeneration of insights, the backend exposes:
`POST /workspaces/:workspaceId/files/:fileId/reprocess`
- Permission: Minimum `EDITOR` role.
- Behavior: Resets the parent file and version statuses to `PROCESSING`, schedules a high-priority job (`priority = 0`), and appends a `AI_REPROCESS_REQUESTED` activity log.

### 4. Status Ownership Boundary
The UI must continue to consume `FileVersion.aiStatus` (reflected in the `File` model) as the single source of truth for the processing state. The `AIJob` state must never be checked directly by the client interface, allowing queue migrations or backoff modifications to remain transparent to the client.

## Consequences
- The frontend remains decoupled from worker, runner, and queue internals.
- Storage performance is optimized using a cache-first text retrieval approach (cache in DB, full text archived in storage).
- Future multi-result support or semantic search layers can be built cleanly on top of this interface contract.
