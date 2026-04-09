# ADR-0028: Default String Key Mode for Datastore

Status: Accepted  
Date: 2026-03-11

Superseded in part by ADR-0029 for `insert()` key-field strictness.

## Context

`README` and usage examples use tenant-style string keys, but runtime default
behavior still used timestamp normalization.

That mismatch caused onboarding failures in the documented quickstart path
because string inputs such as `"tenant-001"` were parsed as timestamps and
failed with `TimestampParseError`.

## Decision

Switch the built-in default key definition from timestamp-based to string-based.

Key points:

- default mode key type is non-empty `string`
- default comparator is lexicographic ascending
- default serializer/deserializer keep string identity
- `insert({ key, payload })` is the canonical default input
- `insert({ timestamp, payload })` remains a legacy alias only when the active
  key definition explicitly accepts that input shape

## Consequences

Positive:

- README quickstart behavior matches runtime default behavior
- default mode now targets generic key-value scenarios without extra config
- timestamp use cases remain available via explicit `config.key` definition

Trade-offs:

- projects relying on implicit default timestamp behavior must add `config.key`
- existing wording in earlier ADRs/docs required alignment updates

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Usage docs:
  - `README.md`
  - `README-JA.md`
- Implementation:
  - `src/storage/datastore/datastoreKeyDefinition.ts`
- Tests:
  - `tests/storage/datastore-core-baseline.test.mjs`
  - ~~`tests/storage/datastore-query-row-shape.test.mjs`~~ (removed; see ADR-0047)
