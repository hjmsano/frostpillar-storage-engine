# 37. Default Key Comparator Determinism and Durable Error Traceability

Date: 2026-03-12

## Status

Accepted

## Context

Review feedback identified three maintainability and diagnosability risks:

- default string key ordering depended on `localeCompare`, which can vary by
  locale/runtime and may break deterministic cross-environment ordering.
- `toStorageEngineError` wrapped plain `Error` values without preserving `cause`,
  reducing root-cause traceability for durable backend failures.
- OPFS metadata integer parsing duplicated inline validation instead of reusing
  the shared non-negative-safe-integer validator used by other browser durable
  backends.

## Decision

1. The default string key comparator uses locale-insensitive deterministic
   Unicode code-point ordering via `<` / `>` semantics.
2. `toStorageEngineError` preserves the original error as `cause` when wrapping
   non-`StorageEngineError` `Error` values.
3. OPFS `meta.json commitId` validation is unified with shared
   `parseNonNegativeSafeInteger` parser.
4. Test coverage is extended to lock these contracts:
   - deterministic default key comparator behavior and source guard
   - error `cause` preservation in storage error normalization
   - OPFS shared metadata validator usage
   - IndexedDB config parsing without duplicate defaulting
   - root type export includes `DatastoreDriverSnapshot`

## Consequences

- **Positive:** Key ordering is deterministic across locales and runtimes.
- **Positive:** Durable backend error investigations retain original stack/cause chain.
- **Positive:** Browser durable metadata integer rules stay consistent across
  localStorage/syncStorage/indexedDB/OPFS.
- **Positive:** Public custom-driver type surface is more complete.
