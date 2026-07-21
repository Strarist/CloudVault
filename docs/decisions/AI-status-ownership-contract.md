# AI Status Ownership Contract

## Status
Approved

## Context
When multiple file versions exist or when background workers are actively processing jobs, we must prevent UI inconsistencies. A common bug is displaying processing states or ready statuses derived directly from active queue entries (`AIJob`) rather than the version metadata itself, leading to race conditions or incorrect status displays for old file versions.

## Rule
1. **AI State Ownership**:
   - `FileVersion` owns the AI state.
   - The UI and API client layers must consume `FileVersion.aiStatus` (or the current version's status aggregated on `File.aiStatus`) only.
   
2. **AIJob Independence**:
   - The UI must **NEVER** derive AI readiness directly from the existence or state of an `AIJob` document.
   - The `AIJob` collection is treated as an ephemeral background queue log; it is not the source of truth for document status.

## Rationale
- Deriving status from `AIJob` causes older versions to show incorrect processing states if a new version is uploaded.
- Direct version-to-status coupling ensures that the user is always presented with the correct processing state (e.g. `READY`, `PROCESSING`, `FAILED`) corresponding to the specific file version they are viewing.
