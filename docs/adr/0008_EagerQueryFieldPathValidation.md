# ADR-0008: Eager Validation for Query Field Paths

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-10

## Context

Field-path parsing for `select`, `where.field`, and `orderBy.field` accepted trailing-escape-invalid paths (for example, `value\`) only when parsing was actually executed during record evaluation.

This made validation timing data-dependent:
- `select` and `where.field` parsing happened only while iterating records.
- `orderBy.field` parsing happened only when sort comparison executed.

As a result, malformed paths could be silently accepted on empty datasets, which violates the Datastore query contract that malformed paths MUST fail with `ValidationError`.

## Decision

- Add explicit pre-scan field-path validation for all query request paths:
  - every `select` field
  - every leaf `where.field`
  - every `orderBy.field`
- Keep existing field-path parsing rules and error type (`ValidationError`) unchanged.
- Execute this validation before record scanning and sorting.

## Consequences

Positive:
- Query validation behavior becomes deterministic and independent of record count.
- Empty datastore queries now enforce the same path contract as non-empty datastores.
- Test coverage explicitly guards `select`, `where.field`, and `orderBy.field` empty-dataset cases.

Trade-off:
- Some malformed queries that were previously accepted on empty inputs now fail earlier and consistently.

## Supersession Note

The query engine (`queryNative` and related field-path validation logic) was removed from this
repository and its responsibility transferred to `frostpillar-query-engine`. This ADR's
decision is no longer applicable to `frostpillar-storage-engine`.

## References

- MDN: `Array.prototype.sort()` (comparison callback behavior)
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
