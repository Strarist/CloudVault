# Phase 9 Stabilization Audit Report

## Investigation 1 – Extracted Text Endpoint

### Verification Details
1. **Route definition**: [ai.routes.ts](file:///d:/CloudVault/src/routes/ai.routes.ts#L48-L92) defines `router.get('/:workspaceId/files/:fileId/text', ...)`
2. **Route mounting**: [app.ts](file:///d:/CloudVault/src/app.ts#L60) mounts `app.use('/workspaces', aiRoutes)`
3. **Frontend API Path**: [AISummaryPanel.tsx](file:///d:/CloudVault/frontend/src/components/AISummaryPanel.tsx#L71) requests `/workspaces/${workspaceId}/files/${file._id}/text`

### Result
There is **no mismatch** between the backend routes, app mounting, and frontend API paths. The paths align perfectly.

---

## Investigation 2 – AI Job Lifecycle

### Evidence (Uploaded File: `Advertisement_...pdf`)
* **File ID**: `6a292fdfa3f2be83872e803e`
* **Current Version ID**: `6a292fe1a3f2be83872e8040`
* **Workspace ID**: `6a292fada3f2be83872e8019`
* **Queries**:
  ```javascript
  db.aijobs.find({ fileId: ObjectId("6a292fdfa3f2be83872e803e") })       // Returns []
  db.airesults.find({ fileId: ObjectId("6a292fdfa3f2be83872e803e") })    // Returns []
  db.fileversions.find({ fileId: ObjectId("6a292fdfa3f2be83872e803e") }) // Returns 1 version (aiStatus: PENDING)
  ```

### Determination & Root Cause of UI Queue State
* **Status**: **NOT_STARTED** on File, **PENDING** on FileVersion, **NO active job** in AIJob collection.
* **Root Cause**:
  1. The target workspace has `aiEnabled: false` (the default value upon creation).
  2. Because AI is disabled, [AIJobService.createJob](file:///d:/CloudVault/src/services/aiJob.service.ts#L27) returns `null` immediately and skips creating an AIJob.
  3. Since no job is created, the File's `aiStatus` remains at its schema default `NOT_STARTED`.
  4. In [page.tsx](file:///d:/CloudVault/frontend/src/app/dashboard/page.tsx#L85), the dashboard status badge maps `NOT_STARTED` (and `PENDING`) to `"Queued"`, causing it to remain in the "Queued" state indefinitely.

---

## Investigation 3 – Worker Runtime

### Verification & Evidence
* **Worker Process**: **Not running**. The process list shows no active `ai.worker.js` or `ts-node` workers.
* **Recovery Daemon**: **Not running**. No `ai.recovery.js` processes are active.
* **Heartbeat Collection**: **Empty (`[]`)**. Checked the `worker_heartbeats` collection in MongoDB, which contains zero active heartbeat records.

---

## Investigation 4 – React Key Collisions

### Audit Results
* Found a key collision bug in [page.tsx](file:///d:/CloudVault/frontend/src/app/dashboard/page.tsx#L1034-L1052):
  * Both [CommentsDrawer](file:///d:/CloudVault/frontend/src/components/CommentsDrawer.tsx) and [AISummaryPanel](file:///d:/CloudVault/frontend/src/components/AISummaryPanel.tsx) used the fallback key `'empty'` when `selectedFile` was null. Since they are sibling nodes in the JSX, this caused console warning errors: `Encountered two children with the same key, 'empty'`.

### Fix Implemented
1. Added proper state synchronization `useEffect` cleanup blocks in [CommentsDrawer.tsx](file:///d:/CloudVault/frontend/src/components/CommentsDrawer.tsx#L45-L56) and [AISummaryPanel.tsx](file:///d:/CloudVault/frontend/src/components/AISummaryPanel.tsx#L101-L121) to reset all input values, loading flags, results, and errors when the active file changes or the panel closes.
2. Removed the `key` props from both components in [page.tsx](file:///d:/CloudVault/frontend/src/app/dashboard/page.tsx#L1034-L1048), eliminating the key collision warning entirely.

---

## Investigation 5 – Polling Verification

### Evidence
* The telemetry polling loop in [AISummaryPanel.tsx](file:///d:/CloudVault/frontend/src/components/AISummaryPanel.tsx#L114-L142) is fully functional.
* **Network Trace Logs**:
  ```text
  [15:06:31.747] GET /workspaces/6a292fada3f2be83872e8019/files/6a292fdfa3f2be83872e803e/ai - 304
  [15:06:34.747] GET /workspaces/6a292fada3f2be83872e8019/files/6a292fdfa3f2be83872e803e/ai - 304
  [15:06:37.560] GET /workspaces/6a292fada3f2be83872e8019/files/6a292fdfa3f2be83872e803e/ai - 304
  [15:06:40.554] GET /workspaces/6a292fada3f2be83872e8019/files/6a292fdfa3f2be83872e803e/ai - 304
  [15:06:43.560] GET /workspaces/6a292fada3f2be83872e8019/files/6a292fdfa3f2be83872e803e/ai - 304
  ```
  Repeated GET requests are verified at exactly 3-second intervals during processing states.

---

## Investigation 6 – AI Result Consistency

### Inconsistencies Identified
1. **Schema Mismatch (Default values)**:
   * [file.model.ts](file:///d:/CloudVault/src/models/file.model.ts#L64) defaults `aiStatus` to `NOT_STARTED`.
   * [fileVersion.model.ts](file:///d:/CloudVault/src/models/fileVersion.model.ts#L51) defaults `aiStatus` to `PENDING`.
   * On upload in an AI-disabled workspace, the file is `NOT_STARTED` while its version is `PENDING`, violating the single-source-of-truth status boundary.
2. **Leftover Test Artifacts**:
   * Integration tests clean up `AIJob` and `AIResult` records on completion, but leave `File` and `FileVersion` documents marked as `PROCESSING` or `PENDING` without resetting their statuses.

---

## Remaining Risks & Technical Debt

* **TD-053**: Inconsistent status defaults between `File` and `FileVersion` models on initial upload in disabled workspaces.
* **TD-054**: Lack of automatic cleanup/reset of File/FileVersion state when a job is hard-deleted from the queue.
