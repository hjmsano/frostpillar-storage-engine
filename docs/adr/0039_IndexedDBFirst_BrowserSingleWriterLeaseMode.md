# 39. IndexedDB-first Browser Single-Writer Lease Mode

Date: 2026-03-13

## Status

Accepted

## Context

Browser durable backends currently use snapshot-at-open plus snapshot commit.
When multiple tabs open the same datastore key and write concurrently, commit
ordering becomes last-writer-wins and can lose updates.

Project direction prioritizes:

- fast in-memory operations,
- cycled durability writes,
- predictable correctness over transparent multi-writer behavior.

## Decision

1. Introduce an optional browser single-writer lease mode with fencing fields:
   `writerId`, `leaseUntil`, `epoch`.
2. Implement strict mode on `indexedDB` first.
3. Keep file backend lock-file semantics unchanged.
4. Add optional `BroadcastChannel` write forwarding from non-writer tabs to the
   active writer tab.
5. Treat `localStorage` and `syncStorage` as best-effort only for this feature
   phase; document that strict single-writer guarantees are out of scope there.
6. Implement OPFS strict mode only as a follow-up with explicit capability
   checks and fallback behavior.

## Consequences

- **Positive:** IndexedDB gains strict single-writer browser semantics without
  changing the Datastore public API shape.
- **Positive:** Existing fast in-memory path and auto-commit model remain.
- **Positive:** Non-writer tabs can still issue writes through forwarding when
  enabled.
- **Trade-off:** Lease/heartbeat/fencing introduces timing-sensitive paths and
  more complex tests.
- **Trade-off:** Strict guarantees remain backend-dependent; documentation must
  explicitly state support levels.

