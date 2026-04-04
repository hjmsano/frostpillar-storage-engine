# ADR-0047: Nested Payload Values in Default Query Row

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-20

## Context

ADR-0015 established the default `queryNative` row shape and documented that
nested payload objects and arrays should be omitted from the result.
The spec (`docs/specs/01_DatastoreAPI.md` §6.1) codified this as a MUST.

In practice, the implementation serialized nested values to JSON strings rather
than omitting them (see `src/storage/query/queryRowProjection.ts`). Tests
enforced the JSON-string behavior. This created a three-way inconsistency:

- spec said: omit nested fields
- implementation said: include as JSON string
- tests agreed with implementation

The JSON-string approach is a footgun: the field appears to be a string scalar
but requires `JSON.parse` to use. Callers have no signal that the value is
encoded, and the type system (`NativeQueryResultRow: Record<string, NativeScalar>`)
incorrectly narrows the value to `string`.

## Decision

Include nested payload objects and arrays in default projection rows as native
JavaScript values (objects/arrays), not serialized strings.

Concrete changes:

- `NativeQueryResultValue = NativeScalar | Record<string, unknown>`
  added to `src/types.ts`. Payload arrays are rejected at validation time,
  so the `unknown[]` variant is excluded from the type.
- `NativeQueryResultRow` updated from `Record<string, NativeScalar>` to
  `Record<string, NativeQueryResultValue>`.
- `buildQueryRow` default path: pass non-scalar payload values through directly
  instead of calling `JSON.stringify`.
- Spec §6.1 updated: "nested payload objects MUST be included as-is".
- Tests updated to assert `deepEqual` on native objects/arrays.

## Consequences

Positive:

- Callers can use `row.address.city` directly without parsing.
- The TypeScript type now accurately reflects what is returned.
- Spec, implementation, and tests are consistent.

Trade-off:

- This is a breaking change for any caller that expected nested fields to be
  JSON strings. Callers doing `JSON.parse(row.address)` must be updated.
- `distinct` deduplication and output-size estimation already use
  `JSON.stringify(row)` internally, so they are unaffected.

## Supersession Note

The query engine (`queryNative`, `buildQueryRow`, `NativeQueryResultRow`, and all related
projection types) was removed from this repository and its responsibility transferred to
`frostpillar-query-engine`. This ADR's decision is no longer applicable to
`frostpillar-storage-engine`. The decision itself (native objects rather than JSON strings
for nested fields) remains the correct approach and should be carried forward in
`frostpillar-query-engine`.
