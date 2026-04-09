# ADR-0012: Close Error Aggregation and Page Corruption Pass-Through Clarity

Status: Accepted  
Date: 2026-03-10

## Context

Two reliability/maintainability concerns were identified:

1. `loadFileSnapshot` catches all errors and rethrows with
   `toStorageEngineError(...)`. This looked risky for corruption detection, but
   `PageCorruptionError` already extends `StorageEngineError`, and
   `toStorageEngineError` passes `StorageEngineError` through unchanged.
2. `Datastore.close()` previously kept only the first deferred error. When both
   deferred initialization failure and backend close failure happened in one
   close path, the close failure was dropped.

## Decision

- Keep `loadFileSnapshot` wrapping logic unchanged, and add an explicit comment
  that `PageCorruptionError` is passed through unchanged by design.
- Change `Datastore.close()` behavior:
  - if only one failure exists, throw that `Error` as before.
  - if both deferred init failure and backend close failure exist, throw
    `AggregateError` with both errors in stable order:
    1. deferred init failure
    2. backend close failure
- Update Datastore spec and usage docs (EN/JA) to document the dual-failure
  `AggregateError` contract.

## Consequences

Positive:

- Backend close failures are no longer silently suppressed when init already
  failed.
- Diagnostics improve for lock-release and cleanup failures.
- `loadFileSnapshot` intent is explicit and less likely to be misread.

Trade-off:

- Callers that assumed a single `Error` from `close()` must now handle
  `AggregateError` for dual-failure cases.

## References

- `src/storage/datastore/Datastore.ts`
- `src/storage/drivers/file/fileBackendSnapshot.ts`
- `docs/specs/01_DatastoreAPI.md` §7
- `docs/specs/03_InternalArchitecture.md` §3
- `README.md`
- `README-JA.md`
- ECMA-262 (AggregateError): https://tc39.es/ecma262/#sec-aggregate-error-objects
- MDN AggregateError: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/AggregateError
