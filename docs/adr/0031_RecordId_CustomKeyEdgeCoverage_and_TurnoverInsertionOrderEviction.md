# ADR-0031: RecordId/Custom-Key Edge Coverage and Turnover Insertion-Order Eviction

Status: Accepted  
Date: 2026-03-11

## Context

Coverage review identified edge-case gaps around:

- `RecordId` URI-sensitive key segments and malformed encoded parsing.
- file reopen durability with custom keys (special characters, persisted delete,
  and same-key insertion-order stability).
- turnover capacity eviction behavior for custom string keys.
- B-Tree adapter edge operations (empty/single/duplicate-key-heavy flows).
- range query behavior when boundary keys are non-existent.

The turnover path had a behavioral defect: eviction used key-index first entry
ordering instead of true insertion-order oldest record selection.

## Decision

- Define these edge behaviors explicitly in `docs/specs/01_DatastoreAPI.md`.
- Add runtime coverage tests across datastore integration, RecordId parsing, and
  key-index adapter edge flows.
- Fix turnover eviction implementation to evict by insertion order:
  - resolve oldest record from `recordsByInsertionOrder` iteration order.
  - remove the same record from key index.
  - remove the same record from insertion-order buffer.
- Update EN/JA usage docs to describe these guarantees.

## Consequences

Positive:

- custom-key behavior is now verified across URI-sensitive keys and reopen paths.
- turnover policy now matches "oldest record" semantics independently of key
  lexical order.
- B-Tree adapter edge operations are validated with invariant checks.

Trade-offs:

- additional tests increase runtime slightly.
- docs/spec contract is now stricter and must be maintained during future
  key/index refactors.

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Usage docs:
  - `README.md`
  - `README-JA.md`
- Implementation:
  - `src/storage/datastore/datastoreStateOps.ts`
- Tests:
  - `tests/storage/record-id-canonical.test.mjs`
  - `tests/storage/datastore-core-baseline.test.mjs`
  - `tests/storage/datastore-turnover-custom-key-eviction.test.mjs`
  - `tests/storage/time-index-btree-package-adapter.test.mjs`
- Official references:
  - MDN `encodeURIComponent`:
    https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
  - MDN `Map` iteration order:
    https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
