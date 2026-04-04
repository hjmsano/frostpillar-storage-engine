# ADR-0019: Generic Record Key Model and Key Codec Contract

Status: Accepted  
Date: 2026-03-11

Superseded in part by ADR-0028 (default key mode) and ADR-0029 (`insert()` key-field strictness).

## Context

`@frostpillar/frostpillar-btree` supports generic key types via comparator
injection, but this repository still hard-coded `timestamp` as the datastore
key model.

That mismatch blocked non-timeseries use cases and created unnecessary coupling
across API, indexing, and query defaults.

## Decision

Adopt a generic datastore key model with explicit key codec hooks.

Key points:
- canonical record field becomes `key` (not timestamp-only)
- index adapter is generalized to `RecordKeyIndexBTree`
- datastore accepts `config.key` with required callbacks:
  - `normalize`
  - `compare`
  - `serialize`
  - `deserialize`
- default behavior remains timestamp-compatible through a built-in key codec
- legacy `insert({ timestamp, payload })` remains supported as compatibility
  input in default timestamp mode
- default native query row shape projects `key` instead of `timestamp`
- `RecordId` encodes serialized-key identity + insertion order

## Consequences

Positive:
- datastore can support any key type that can be normalized/compared/serialized
- B-Tree package capabilities are now fully consumable at datastore level
- timestamp use cases continue to work without custom configuration

Trade-offs:
- API surface and docs become more explicit/complex due to key codec contract
- reopen behavior now depends on stable codec behavior for custom key types

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
  - `docs/specs/03_InternalArchitecture.md`
- Implementation:
  - `src/storage/datastore/Datastore.ts`
  - `src/storage/btree/recordKeyIndexBTree.ts`
  - `src/storage/record/recordId.ts`
- Tests:
  - `tests/storage/datastore-core-baseline.test.mjs`
  - `tests/storage/time-index-btree-package-adapter.test.mjs`
