# ADR-0022: Turnover Capacity Eviction Progress Guard

Status: Accepted  
Date: 2026-03-11

## Context

Turnover capacity policy evicts oldest records while:

`currentSize + incomingRecordSize > maxSize`

The previous loop assumed each eviction reclaimed bytes. If a corrupted internal
state reports `0` reclaimed bytes, the condition never changes and the loop can
run indefinitely.

## Decision

Add a forward-progress guard in turnover enforcement:

- each eviction result MUST be a positive safe integer
- if eviction reports `0`, negative, non-integer, or unsafe integer bytes,
  insertion fails immediately with `IndexCorruptionError`

## Consequences

Positive:

- prevents infinite turnover loops caused by corrupted eviction accounting
- fails fast with an explicit corruption signal
- keeps normal turnover behavior unchanged for valid eviction flows

Trade-offs:

- corruption is surfaced earlier as a hard failure during insert

## References

- Vision and principles:
  - `docs/architecture/vision-and-principles.md`
- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Implementation:
  - `src/storage/backend/capacity.ts`
- Tests:
  - `tests/storage/capacity-turnover-safety.test.mjs`
