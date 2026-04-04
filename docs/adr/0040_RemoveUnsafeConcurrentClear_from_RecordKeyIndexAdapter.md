# 40. Remove Unsafe Concurrent `clear()` from Record-Key Index Adapter

Date: 2026-03-13

## Status

Accepted

## Context

`ConcurrentRecordKeyIndexBTree` was introduced as an async adapter on top of
`ConcurrentInMemoryBTree` from `@frostpillar/frostpillar-btree@0.0.3`.

The adapter included a synchronous `clear()` implementation that recreated only
the local `ConcurrentInMemoryBTree` instance. This operation did not append any
shared-store mutation and therefore did not clear data for other clients using
the same store.

On the next sync/mutation, previously existing shared data could reappear in
the local instance. This behavior is misleading for callers and unsafe in
concurrent contexts.

## Decision

1. Remove `clear()` from `ConcurrentRecordKeyIndexBTree`.
2. Keep concurrent adapter API limited to operations that are explicitly backed
   by `@frostpillar/frostpillar-btree` shared-store semantics.
3. Add adapter-level tests that assert the concurrent adapter does not expose
   local-only `clear()`.
4. Update storage layout spec to forbid concurrent adapter `clear()` until
   upstream provides a shared-store-propagated clear operation.

## Consequences

- **Positive:** Prevents a misleading API that can silently resurrect shared
  data and violate caller expectations.
- **Positive:** Adapter surface now matches verified upstream concurrency
  primitives.
- **Trade-off:** Sync/async adapter method symmetry is intentionally reduced.
- **Trade-off:** If future use cases require clear-all semantics, upstream
  support must be added first and then reintroduced intentionally.
