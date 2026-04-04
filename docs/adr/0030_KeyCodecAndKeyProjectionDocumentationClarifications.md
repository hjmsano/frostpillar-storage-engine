# ADR-0030: Key Codec and Key Projection Documentation Clarifications

Status: Partially superseded — key projection/toNativeScalar notes moved to `frostpillar-query-engine`; key codec and callback documentation clarifications remain active.
Date: 2026-03-11

## Context

Documentation had four gaps:

- ADR-0017 / ADR-0018 referenced `src/storage/btree/timeIndexBTree.ts`, which
  no longer exists after the key-index adapter rename.
- `DatastoreKeyDefinition.toNativeScalar` was optional but its role and runtime
  behavior were unclear.
- key codec callback failure behavior for `normalize`, `compare`, `serialize`,
  and `deserialize`, and `ConfigurationError` validation conditions were not fully
  documented.
- native query `key` projection shape was ambiguous for non-native key types.

## Decision

Align specs, usage docs, and ADR references with then-current runtime behavior:

- update ADR-0017 and ADR-0018 references to
  `src/storage/btree/recordKeyIndexBTree.ts`.
- document `toNativeScalar` as an optional projection helper and explicitly
  state that the current baseline does not invoke it yet. (**superseded** — see note below)
- document key callback invocation and failure behavior across normal operations
  and durable backend recovery.
- document constructor-time `ConfigurationError` conditions for invalid
  `config.key` callback definitions.
- define key projection contract for native query rows: (**superseded** — see note below)
  - `key` is always projected as `NativeScalar`.
  - if logical key is non-native, projection uses serialized key string.

## Consequences

Positive:

- removes stale path references in ADR docs.
- makes key-definition callback behavior explicit for integrators.
- clarifies key codec callback behavior for integrators.
- reduces ambiguity for future key codec evolution.

Trade-offs:

- historical query-projection notes in this ADR are now superseded and kept for
  decision history only.

## Supersession Note

The query engine (`queryNative`, query key projection, and `toNativeScalar`
projection behavior) was removed from this repository and transferred to
`frostpillar-query-engine`.

This ADR remains active only for:
- key codec callback documentation and failure semantics
- constructor-time `ConfigurationError` callback validation clarifications
- ADR-0017/0018 adapter path reference corrections

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Usage docs:
  - `README.md`
  - `README-JA.md`
- Updated ADRs:
  - `docs/adr/0017_StorageSourceResponsibilityLayout.md`
  - `docs/adr/0018_ExternalBTreePackageIntegration.md`
- Tests:
  - `tests/specs/storage-source-layout.test.mjs`
