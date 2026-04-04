# ADR-0023: Insertion-Order Sentinel Boundary Guard

Status: Accepted  
Date: 2026-03-11

## Context

`RecordKeyIndexBTree` uses `MAX_INSERTION_ORDER_SENTINEL = 1n << 64n`
as the inclusive upper bound for key-range query end keys.

`Datastore` previously incremented `nextInsertionOrder` without checking this
boundary. If insertion order ever reached the sentinel (or above), key-range
query correctness would no longer be guaranteed for higher insertion-order
records.

## Decision

Add an insertion-order boundary guard aligned with the B-Tree adapter sentinel:

- `Datastore.insert()` validates that `nextInsertionOrder` is non-negative and
  strictly less than `MAX_INSERTION_ORDER_SENTINEL`
- if the boundary is exhausted, insertion fails with `IndexCorruptionError`
- backend initialization validates restored `initialNextInsertionOrder` with
  the same bound before applying in-memory state
- sentinel constant is shared from the B-Tree adapter module to keep one source
  of truth
- sentinel range is aligned with `RecordId` unsigned-64 insertion-order parsing
  contract

## Consequences

Positive:
- preserves deterministic inclusive range-query behavior
- fails fast with explicit corruption semantics instead of allowing silent drift
- keeps B-Tree range bound and datastore insertion contract synchronized

Trade-offs:
- datastore now has a hard terminal insertion-order boundary (practically
  unreachable)

## References

- Vision and principles:
  - `docs/architecture/vision-and-principles.md`
- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Implementation:
  - `src/storage/datastore/Datastore.ts`
  - `src/storage/btree/recordKeyIndexBTree.ts`
- Tests:
  - `tests/storage/datastore-core-baseline.test.mjs`
