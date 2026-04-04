# ADR-0029: Remove `timestamp` Alias Input for `insert()`

Status: Accepted  
Date: 2026-03-11

## Context

After default key mode switched to string keys, datastore still accepted
`insert({ timestamp, payload })` as a field alias path.

That behavior created ambiguity:
- `timestamp` no longer represented a default contract concept
- accidental inputs such as `timestamp: "tenant-001"` could succeed in string
  mode even though caller intent likely targeted timestamp semantics

## Decision

Remove `timestamp` field alias support from `insert()` entirely.

Key points:
- `insert()` input MUST include `key`
- `timestamp` alias input is rejected in all key-definition modes
- timestamp-based use cases remain supported through `key` values with explicit
  timestamp-oriented `config.key` definitions

## Consequences

Positive:
- eliminates ambiguous field-shape behavior
- aligns runtime with strict key-model contract and onboarding docs
- prevents accidental silent acceptance of `timestamp` string inputs

Trade-offs:
- callers still using `insert({ timestamp, payload })` must migrate to
  `insert({ key, payload })`

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Usage docs:
  - `README.md`
  - `README-JA.md`
- Implementation:
  - `src/storage/datastore/datastoreKeyDefinition.ts`
  - `src/storage/datastore/Datastore.ts`
  - `src/types.ts`
- Tests:
  - `tests/storage/datastore-core-baseline.test.mjs`
