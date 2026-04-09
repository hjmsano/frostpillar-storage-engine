# ADR-0020: RecordId Canonical Single-Separator Validation

Status: Accepted  
Date: 2026-03-11

## Context

`RecordId` is used by `getById`, `updateById`, and `deleteById`.
The canonical encoder emits IDs as `<keySegment>:<insertionOrder>`, where
non-numeric keys are encoded as `k~${encodeURIComponent(serializedKey)}`.

The parser previously split with `lastIndexOf(':')`, which allowed non-canonical
IDs containing extra `:` characters to be parsed instead of being rejected.
That weakened deterministic ID validation and could produce silent null results
for malformed IDs.

## Decision

Enforce canonical `RecordId` parsing with a single separator:

- parser now requires exactly one `:` separator
- insertion order remains unsigned decimal and bounded to unsigned 64-bit range
- key segment continues to support:
  - legacy numeric form
  - `k~` encoded form

Any non-canonical multi-separator ID is rejected with `ValidationError`.

## Consequences

Positive:

- deterministic, strict `RecordId` validation
- clear rejection path for malformed IDs instead of ambiguous parsing
- colon-containing keys continue to work via canonical encoded `_id` values

Trade-offs:

- previously accepted non-canonical IDs with extra separators are now invalid

## References

- Spec:
  - `docs/specs/01_DatastoreAPI.md`
- Implementation:
  - `src/storage/record/recordId.ts`
- Tests:
  - `tests/storage/record-id-canonical.test.mjs`
