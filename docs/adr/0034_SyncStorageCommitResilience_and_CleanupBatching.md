# ADR-0034: SyncStorage Commit Resilience and Cleanup Batching

Status: Accepted  
Date: 2026-03-11

## Context

Post-merge review identified operational gaps in the new browser `syncStorage`
backend:

- unknown-generation chunk cleanup used sequential `getItems`/`removeItems`
  loops with many round-trips,
- duplicate `isRecordObject` guards existed in multiple sync-storage modules,
- adapter dispatch order (`browser` Promise API first, then `chrome` callback
  API) was implicit in code but undocumented,
- non-quota commit write failures dropped the original error context,
- pre-write cleanup of `nextGeneration` stale chunks could abort a commit even
  though it is only maintenance work.

## Decision

- Batch unknown chunk cleanup:
  - probe speculative chunk keys in one bounded `getItems` call,
  - remove discovered keys in one `removeItems` call.
- Extract shared `isRecordObject` helper into a common validation utility and
  reuse it across sync-storage modules.
- Keep runtime dispatch strategy unchanged. The `browser` Promise API remains
  preferred, and the `chrome` callback API remains the fallback path. Document
  this rationale in code comments.
- Preserve non-quota commit write failure details by attaching the original
  thrown value as `cause` in `StorageEngineError`.
- Treat `nextGeneration` pre-write cleanup as best-effort:
  - attempt cleanup before write,
  - ignore cleanup-only failures and continue commit write path.

## Consequences

Positive:

- fewer adapter round-trips in stale cleanup paths,
- clearer adapter-selection intent for future maintenance,
- improved debugging fidelity from preserved commit failure causes,
- higher commit availability when cleanup maintenance fails transiently.

Trade-offs:

- best-effort pre-cleanup can leave stale unreferenced chunks if cleanup fails,
  but generation isolation keeps committed snapshots safe.
