# Testing Strategy

Status: Active
Last Updated: 2026-03-30

## Goals

- Validate public storage engine behavior from docs/specs.
- Keep tests deterministic and backend-focused.
- Protect durability and lock semantics for file backend.
- Keep query-engine language/API behavior out of this repository test scope.

## Test Organization

All test files are in `tests/` using the `.test.mjs` extension.

### Core Behavior (`tests/storage/`)

- **Baseline CRUD:** `datastore-core-baseline`, `datastore-key-based-operations`, `datastore-bulk-operations`
- **ID-based operations:** `datastore-id-based-operations`
- **Duplicate key policies:** `datastore-duplicate-key-config`, `datastore-duplicate-key-policy-behavior`
- **Payload validation:** `datastore-payload-validation`, `datastore-updateById-payload-invariants`
- **Capacity control:** `storage-exhaustion-quota`, `datastore-capacity-backend-limit`, `datastore-capacity-multibyte`, `capacity-turnover-safety`, `datastore-updateById-capacity-boundary`, `datastore-replace-capacity-accounting`, `datastore-replace-turnover-eviction-target`, `datastore-turnover-custom-key-eviction`
- **Lifecycle and close:** `datastore-close-error-aggregation`, `datastore-close-concurrent-error`, `runwithopen-close-ordering`
- **Events:** `datastore-event-listener`
- **Concurrency:** `datastore-write-serialization`

### Driver Backends (`tests/storage/`)

- **File backend:** `file-durability-error-normalization`, `file-lock-init-failure`, `file-stale-lock-recovery`, `file-path-traversal-defense`, `file-initial-snapshot-empty-tree`, `file-backend-reopen-size-accuracy`, `datastore-file-reopen-duplicate-policy`
- **Browser backends:** `browser-backend-integration`, `browser-metadata-validation`, `browser-backend-utf8-size-consistency`
- **IndexedDB:** `indexeddb-driver-integration`
- **OPFS:** `opfs-driver-integration`
- **localStorage:** `local-storage-maintenance-and-commit-resilience`
- **syncStorage:** `datastore-browser-sync-storage`, `sync-storage-maintenance-and-commit-resilience`, `capacity-resolver-sync-storage`

### Internal Contracts (`tests/storage/` and `tests/specs/`)

- **B-Tree adapter:** `record-key-index-btree-adapter`, `comparator-validation-surface`, `default-key-comparator-determinism`
- **Auto-commit:** `autocommit-scheduling-internals`, `autocommit-error-cause-chain`, `autocommit-timer-unref`
- **Backend architecture:** `backend-controller-architecture`, `commit-id-overflow-guard`
- **Data integrity:** `malformed-persisted-data`, `treejson-structural-validation`, `metadata-validation-utils`, `datastore-clear-durable-commit`
- **Source layout:** `storage-source-layout` (in `tests/specs/`)

### Distribution and Exports (`tests/storage/`)

- **Tree-shaking:** `tree-shakeable-drivers`
- **Public API surface:** `public-type-exports`, `public-error-export`
- **Browser bundle:** `browser-bundle-release-contract`
- **Config:** `bytesize-input-error-consistency`

## TDD Flow

For each behavioral change:

1. update spec (`docs/specs/*`)
2. add/adjust test (`tests/*`)
3. implement code (`src/*`)
4. run targeted tests, then full suite

## Execution

- Targeted: `pnpm test tests/storage/<file>.test.mjs`
- Full: `pnpm test`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`

## Browser Backend Testing

Browser-specific backends (localStorage, IndexedDB, OPFS, syncStorage) are tested using mock/adapter patterns within Node.js. Tests inject stub implementations of browser APIs rather than requiring a real browser environment, keeping the test suite deterministic and CI-friendly.
