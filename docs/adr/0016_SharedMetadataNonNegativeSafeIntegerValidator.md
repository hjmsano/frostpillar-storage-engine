# ADR-0016: Shared Metadata Non-Negative Safe Integer Validator

Status: Accepted  
Date: 2026-03-11

## Context

Browser durable backends validate metadata counters (`activeGeneration`,
`commitId`) as non-negative safe integers during load.

Before this change, `localStorage` and `indexedDB` each had a private
`parseNonNegativeSafeInteger` helper with the same numeric contract and almost
identical logic. This duplication increased maintenance overhead and made it
easier for validation behavior to diverge accidentally.

## Decision

- Introduce `src/validation/metadata.ts` with a shared
  `parseNonNegativeSafeInteger(value, fieldName, backendName)` function.
- Route both `localStorageBackend` and `indexedDBBackend` metadata integer
  parsing through this shared function.
- Keep backend-specific error message prefixes by passing `backendName`
  explicitly, while preserving the same numeric validation contract.
- Update backend architecture spec to require shared metadata integer
  validation logic under `src/validation/`.

## Consequences

Positive:
- One source of truth for non-negative safe integer metadata parsing in browser
  durable backends.
- Lower risk of drift when changing validation behavior in the future.
- Existing observable behavior remains stable, including backend-specific error
  prefixes.

Trade-off:
- Call sites now pass an explicit `backendName` argument to preserve message
  context.

## References

- Implementation:
  - `src/validation/metadata.ts`
  - `src/storage/drivers/localStorage/localStorageBackend.ts`
  - `src/storage/drivers/IndexedDB/indexedDBBackend.ts`
- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
  - `docs/specs/03_InternalArchitecture.md`
- External references:
  - MDN: Number.isSafeInteger()  
    https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger
