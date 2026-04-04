# ADR-0033: Add Browser `syncStorage` Backend and `backendLimit` Support

Status: Accepted  
Date: 2026-03-11

## Context

The browser runtime already supports durable backends (`localStorage`,
`indexedDB`, `opfs`), but there is no backend for synchronized browser extension
storage (`storage.sync` APIs).

We need:

- explicit backend selection for synchronized browser storage,
- compatibility across API names (`browser.storage.sync`, `chrome.storage.sync`),
- deterministic quota-aware behavior under small limits
  (per-item, total bytes, item count),
- integration with existing `capacity.maxSize: "backendLimit"` resolution.

## Decision

- Add a new browser backend key: `browserStorage: "syncStorage"`.
- Add `syncStorage` config surface:
  - `keyPrefix`
  - `databaseKey`
  - `maxChunkChars`
  - `maxChunks`
  - `maxItemBytes`
  - `maxTotalBytes`
  - `maxItems`
- Implement a dedicated driver/controller pair:
  - `src/storage/drivers/syncStorage/syncStorageBackend.ts`
  - `src/storage/drivers/syncStorage/syncStorageBackendController.ts`
- Detect and support both API families:
  - Promise-based `browser.storage.sync`
  - callback-based `chrome.storage.sync` with `runtime.lastError` handling
- Use manifest + chunk snapshot persistence with metadata validation:
  - validate non-negative safe integers for `activeGeneration`, `commitId`,
    and `chunkCount`.
- Extend `capacity.maxSize: "backendLimit"` resolution:
  - `localStorage` => `maxChunkChars * maxChunks`
  - `syncStorage` => `maxTotalBytes`

## Consequences

Positive:

- synchronized browser storage is now first-class in the browser backend matrix,
- behavior remains aligned with existing auto-commit architecture,
- capacity rules can follow backend-native quota envelopes for sync storage.

Trade-offs:

- sync backend introduces stricter pre-commit quota validation and more metadata
  handling paths,
- additional tests and docs are required to keep contracts synchronized
  (specs, usage EN/JA, architecture, ADRs).

## References

- Browser extension storage API overview and quota fields:
  - https://developer.chrome.com/docs/extensions/reference/api/storage
- `storage.sync` behavior (WebExtensions):
  - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync
