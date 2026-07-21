# ADR-005: Search Result Contract

## Status
Approved

## Context
In Phase 9 and 10, CloudVault will introduce document intelligence and search layers (including semantic, keyword, and tag-based search). To prevent architectural drift, keep the background worker isolated, and ensure low-latency APIs, we need a stable contract for the search layer.

## Decision
1. **Source Data Isolation**:
   - The search layer must consume `AIResult`, `File`, and `FileVersion` documents only.
   - The search layer must **NEVER** depend on `AIJob`, worker heartbeats, or raw AI provider response objects.
   
2. **Search Result Contract**:
   - The search results returned to the client must explain the matching rationale using the `matchedOn` property.
   - Example contract:
     ```json
     {
       "matchedOn": "tag",
       "value": "AWS"
     }
     ```
     or
     ```json
     {
       "matchedOn": "semantic"
     }
     ```

## Consequences
- The query pipeline remains fast by reading directly from indexed fields in `AIResult` and `File`.
- Any changes to worker internals (retries, timeouts, heartbeats) will not break the search layer.
- Clients can display clear explanations of why specific files matched (e.g., matching a user-defined tag vs semantic proximity).
