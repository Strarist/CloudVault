# ADR-008: AI Status State Machine Contract

## Status
APPROVED

## Context
To prevent race conditions, status drift, and unpredictable UI behaviors, we must freeze the state machine transitions for the `aiStatus` field in both the `File` and `FileVersion` models.

## Decision
We enforce a strict lifecycle state model for AI processing:

```text
       NOT_STARTED
            │
            ▼
         PENDING  ◀────────┐
            │              │
            ▼              │ (Manual Reprocess/Retry)
        PROCESSING         │
         │      │          │
         │      └────────▶ FAILED
         ▼
       READY
```

### 1. Allowed Transitions
* **`NOT_STARTED` ➔ `PENDING`**: Triggered only upon successful creation of an `AIJob` entry (either during initial upload or after toggling AI status to enabled).
* **`PENDING` ➔ `PROCESSING`**: Triggered immediately when a background worker claims the job for execution.
* **`PROCESSING` ➔ `READY`**: Triggered upon complete and successful generation of summaries, tags, and embeddings, written atomically to the database.
* **`PROCESSING` ➔ `FAILED`**: Triggered if a permanent error is encountered or the transient retry attempts reach the maximum limit.
* **`FAILED` ➔ `PENDING`**: Triggered when an authorized user manually requests reprocessing, resetting the job.

### 2. Prohibited Transitions
* **`READY` ➔ `PROCESSING`** or **`READY` ➔ `FAILED`**: Prohibited. A document that is already `READY` can only undergo state changes if a new reprocess command is triggered, which transitions it to `PENDING` first.
* **`FAILED` ➔ `PROCESSING`**: Prohibited. Any retry or recovery must route through the `PENDING` state to ensure the queue and workers pick up the task in order.

## Consequences
* Simplifies client-side state handling and badge status tracking.
* Prevents zombie files (e.g. files marked as `PROCESSING` but having no active running worker thread).
