# 38. Concurrent Record-Key Index Adapter for B-Tree v0.0.3

Date: 2026-03-13

## Status

Accepted

## Context

`@frostpillar/frostpillar-btree` was upgraded from `0.0.2` to `0.0.3`.

`0.0.3` keeps `InMemoryBTree` API compatibility and adds
`ConcurrentInMemoryBTree`, which provides async mutation/read operations backed
by a shared-store log contract (`getLogEntriesSince` / versioned `append`).

This repository already centralizes B-Tree usage behind
`src/storage/btree/recordKeyIndexBTree.ts`, but only had the synchronous
adapter (`RecordKeyIndexBTree`).

## Decision

1. Add `ConcurrentRecordKeyIndexBTree` as an internal adapter in
   `src/storage/btree/recordKeyIndexBTree.ts`.
2. Preserve the existing key-index ordering semantics in both adapters:
   - key comparator ascending
   - insertion order ascending for key ties
3. Keep comparator output hardening (finite integer normalization) shared with
   the synchronous adapter path.
4. Keep current datastore internals on synchronous `RecordKeyIndexBTree`
   (no direct `ConcurrentInMemoryBTree` import in datastore modules).
5. Extend adapter integration tests to cover concurrent shared-store
   synchronization semantics.

## Consequences

- **Positive:** Adapter boundary now tracks `frostpillar-btree@0.0.3` features
  without forcing immediate datastore lifecycle changes.
- **Positive:** Async concurrent key-index behavior is available for future
  storage flows that need shared-log coordination.
- **Trade-off:** Two adapter variants (sync/async) now require ongoing contract
  parity tests.
