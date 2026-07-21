# ADR-004: AI Opt-In Policy

## Context & Problem Statement

As CloudVault prepares to introduce automated document intelligence (auto-summaries, tags generation, and vector embeddings in Phase 8 & 9), data privacy and compliance are paramount. Document processing through third-party LLMs (e.g. OpenAI, Anthropic) or local embedding models raises concerns regarding data confidentiality and user consent.

We must define a clear policy for when and how files are processed by the AI pipeline.

## Decision

We will implement an **opt-in / default-active based AI execution policy** at the workspace level:
1. **Personal Workspaces**: AI processing is **Disabled by Default**.
2. **Team Workspaces**: AI processing is **Enabled by Default** to facilitate collaboration and shared search indexing.
3. **Workspace Owner Control**: The Workspace Owner has the explicit right to override the default setting and toggle the `aiEnabled` flag at any time via workspace settings.
4. **Enforcement**: The AI Job creation route check:
   - Before queueing any document for text extraction or vector embedding, the pipeline checks the parent workspace's `aiEnabled` configuration. If false, no AI processing job is scheduled.

## Rationale

* **Privacy First**: Personal workspaces are private and may contain sensitive credentials, personal logs, or proprietary code. Disabling AI by default ensures no external LLM data leaks occur without explicit user consent.
* **Collaboration Synergy**: Team workspaces are collaborative environments designed for efficiency. Enabling AI by default allows features like full semantic search and document classification to function out-of-the-box, boosting team productivity.
* **User Sovereignty**: By giving the Workspace Owner total control to toggle the policy, organizations and individual users can conform to their internal compliance or data governance rules.

## Consequences

### Benefits
* High compliance posture, aligning with GDPR/CCPA data boundary requirements.
* Complete user transparency regarding when third-party AI APIs are invoked.
* Dynamic policy changes are immediately enforced (if AI is toggled off, pending queue processing is skipped).

### Trade-offs / Mitigations
* **Underutilized Features**: Users in Personal Workspaces might not realize why summaries or semantic search results are unavailable.
  * *Mitigation*: The UI will display a prominent suggestion card advising Personal Workspace owners to enable AI features to unlock summaries and semantic search.
* **State Syncing**: Disabling AI after jobs have already been queued or processed.
  * *Mitigation*: Detailed in the Phase 8 architecture proposal, toggling `aiEnabled` to false will cause the job worker to abort and delete any existing queued jobs for that workspace, and disable search retrieval from vector databases.
