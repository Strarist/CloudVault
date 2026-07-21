# ADR-006: Workspace Deletion Cascade Contract

## Status
Approved

## Context
When a workspace is deleted, we must maintain a clean data hygiene boundary, preventing orphaned metadata, files, comments, notifications, or AI results. We need a strict definition of soft and hard deletion cascade behaviors.

## Decision
1. **Soft Deletion of Workspace**:
   - Keep all associated metadata (`Files`, `Versions`, `Comments`, `Notifications`, `AIResults`, `Activity Logs`) physically in the database.
   - Mark all these objects as inaccessible by setting a `deletedAt` flag or utilizing workspace-wide access guards.
   - Suspend/pause all pending AI jobs to save processing capacity.

2. **Hard Deletion of Workspace**:
   - Physically remove all relational and transactional metadata from MongoDB:
     - `Files`
     - `Versions`
     - `Comments`
     - `Notifications`
     - `AIJobs`
     - `AIResults`
   - Delete all physical file assets stored in Supabase Storage under the workspace's bucket prefix (e.g., `workspaceId/*`).
   - *Audit Strategy Exception*: Preserve workspace creation and membership audit records under a global audit log (or mark deleted but keep logs) if compliance dictates, but purge all user content.

## Consequences
- Prevents database bloating from orphaned objects.
- Guarantees complete user data removal when requested.
- Avoids processing cost overheads by stopping pending AI jobs on suspended workspaces.
