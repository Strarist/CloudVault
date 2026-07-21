# AI Input Size Policy

## Status
Approved

## Context
When processing large documents (e.g. PDFs with hundreds of pages or large CSVs/text dumps), extracting and feeding the raw text directly to LLM providers (OpenAI, Gemini, Claude) or embedding models can cause provider-side rate limits, token budget overflows, network timeouts, and cost spikes. We need a clear, frozen policy defining the maximum input size for Phase 8.5/Phase 9.

## Policy Rules
1. **Maximum Extracted Text Size**:
   - The maximum size of extracted raw text submitted for summary, tagging, or embedding generation is capped at **5 MB**.
   
2. **Current Input Handling Strategy**:
   - Any document exceeding the 5 MB limit must be **safely truncated** (keeping the first 5 MB of UTF-8 characters/bytes) before submission to the AI provider.
   - Truncated documents should append a notice `[TRUNCATED_MAX_INPUT_LIMIT_5MB]` to the cache and logs.
   
3. **Future Handling (Enhancements)**:
   - Chunking strategies (splitting document into overlapping segments and mapping-reducing summaries) and hierarchical summary generation are explicitly out of scope for Phase 8.5/9 and scheduled as future Phase 11 scaling improvements.

## Consequences
- Protects the worker from API token exhaustions and transient rate limits.
- Enforces predictable cost boundaries.
- Minimizes processing latency for large documents.
