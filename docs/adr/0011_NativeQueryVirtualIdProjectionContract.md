# ADR-0011: Native Query `_id` Projection Contract

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-10

## Context

The Datastore spec stated that `_id` is available in every native query result
row. This wording was ambiguous and could be read as `_id` being always present
in default `queryNative` rows.

Current implementation behavior was:

- `_id` is a virtual field resolved by field lookup.
- default `queryNative` rows include `timestamp` and top-level scalar payload
  fields.
- `_id` is included only when explicitly requested in `select`.

## Decision

- Clarify the normative contract: `_id` is a virtual field that can be projected
  for every record, but it MUST be explicitly listed in `select`.
- Keep default row shape unchanged (no implicit `_id` injection).
- Add test coverage that enforces this projection behavior.
- Reflect the same rule in user docs (EN/JA).

## Consequences

Positive:

- Spec, tests, and implementation are aligned for `_id`.
- Query result shape remains stable for existing callers of `queryNative({})`.
- Record ID retrieval flow is explicit and predictable.

Trade-off:

- Callers must include `_id` in `select` when they need IDs.

## Supersession Note

The query engine (`queryNative`, `_id` virtual field, and projection logic) was removed
from this repository and its responsibility transferred to `frostpillar-query-engine`.
This ADR's decision is no longer applicable to `frostpillar-storage-engine`.
`frostpillar-storage-engine` still supports `getById` / `updateById` / `deleteById`
using canonical `RecordId` strings.
