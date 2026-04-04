# ADR-0032: Activate `config.key.toNativeScalar` Projection

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-11

## Context

Usage documentation included the note:

- "current baseline does not invoke `toNativeScalar` yet."

This revealed a gap between exposed configuration surface and runtime behavior.
A staged, test-first implementation plan was needed to preserve compatibility
with current key/index semantics.

## Decision

- Adopt the implementation plan documented in `docs/specs/01_DatastoreAPI.md`.
- Implement behavior only in `key` projection flow (`queryNative`), with no
  changes to ordering/comparison or `_id` generation.
- Enforce native scalar projection output constraints and explicit failure
  behavior.
- Explicitly treat `capacity.maxSize: "backendLimit"` as out-of-scope for
  behavior change: capacity resolution, quota policy, and eviction semantics
  remain unchanged.

## Consequences

Positive:

- closes a baseline feature gap already documented in user usage docs,
- clarifies callback error/return-value contract,
- keeps custom-key projection extensibility without changing durable key codec
  contract.

Trade-offs:

- additional tests are required across query projection paths,
- slightly stricter runtime validation on projected key values.
- capacity integration tests must be retained to guard against accidental
  coupling between projection output and persisted storage accounting.

## Supersession Note

The `queryNative` projection path (including `toNativeScalar` invocation) was removed from
this repository and its responsibility transferred to `frostpillar-query-engine`.
The `DatastoreKeyDefinition` interface no longer includes `toNativeScalar`.
Capacity resolution, quota policy, and eviction semantics remain active and unchanged
in `frostpillar-storage-engine`.

## References

- Related capacity spec:
  - `docs/specs/02_DurableBackends.md`
- Official references:
  - TypeScript handbook (everyday types):
    https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
  - MDN JavaScript primitive values:
    https://developer.mozilla.org/en-US/docs/Glossary/Primitive
