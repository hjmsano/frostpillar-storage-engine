# ADR-0027: Query Output Serialized-Character Budget Guard

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-11

## Context

Native query execution already enforced:

- scanned-row limits
- filter complexity limits
- `distinct` intermediate working-set limits
- output row-count limit (`MAX_QUERY_OUTPUT_ROWS = 5000`)

However, row count alone does not bound memory use of returned results.
Large scalar payload values can still produce very large query outputs and raise
denial-of-service risk through memory exhaustion.

## Decision

Add a cumulative output budget guard for query results.

Key points:

- define `MAX_QUERY_OUTPUT_TOTAL_CHARS = 1048576`
- for each row that will be returned, estimate serialized size via
  `JSON.stringify(row).length`
- accumulate the total serialized characters across output rows
- fail with `QueryValidationError` when the budget is exceeded

The guard is evaluated in addition to existing row-count and `distinct` guards.

## Consequences

Positive:

- closes a memory-exhaustion gap where a bounded row count could still carry
  oversized payloads
- keeps guard logic deterministic and lightweight (simple counter + string
  length)
- aligns with project availability principles for query execution

Trade-off:

- some previously accepted large-result queries now fail fast with
  `QueryValidationError`
- limit is character-based (serialized output proxy), not exact heap-byte
  accounting

## Supersession Note

The query engine (`queryNative`, output budgeting, and all query resource guards) was
removed from this repository and its responsibility transferred to `frostpillar-query-engine`.
This ADR's decision is no longer applicable to `frostpillar-storage-engine`.

## References

- Vision:
  - `docs/architecture/vision-and-principles.md`
