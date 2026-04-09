# ADR-0021: RecordId Writer Canonical Encoded Key Segments

Status: Accepted  
Date: 2026-03-11

## Context

`RecordId` key segments previously allowed a writer-side numeric bypass:

- numeric-looking serialized keys (`"123"`) were emitted as `123:<order>`
- non-numeric serialized keys were emitted as `k~${encodeURIComponent(serializedKey)}:<order>`

That created an ambiguity for custom key codecs where serialized string keys can
be numeric-looking values. In that case, `_id` lost the encoded marker and could
be confused with legacy numeric key-segment IDs.

## Decision

Writer canonicalization is now strict:

- `createRecordId` always emits key segments as
  `k~${encodeURIComponent(serializedKey)}`
- this applies to all serialized keys, including numeric-looking strings

Parser compatibility is preserved:

- `parseRecordId` continues to accept legacy numeric key segments
  (`^(0|-?[1-9][0-9]*)$`) for backward compatibility
- encoded form remains accepted

## Consequences

Positive:

- removes ambiguity between numeric-looking serialized strings and legacy numeric
  IDs
- keeps single canonical writer format for new `_id` values
- preserves compatibility for existing IDs generated before this change

Trade-offs:

- newly generated `_id` values for numeric/timestamp serialized keys now include
  the `k~` prefix (format change)

## References

- Vision and principles:
  - `docs/architecture/vision-and-principles.md`
- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Implementation:
  - `src/storage/record/recordId.ts`
- Tests:
  - `tests/storage/record-id-canonical.test.mjs`
