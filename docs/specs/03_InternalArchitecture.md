# Spec: Internal Architecture and Source Layout

Status: Active
Version: 0.5
Last Updated: 2026-04-01

## 1. Scope

This spec defines internal consistency rules for storage engine implementation.

In scope:
- durable backend controller architecture and auto-commit orchestration
- internal source layout by responsibility under `src/storage`
- runtime throw contract and async-flow constraints
- shared metadata integer-validation helper contract

Out of scope:
- public API behavior changes (see `01_DatastoreAPI.md`)
- external GitHub Actions release process (see `04_GitHubActionsCIPipeline.md`)
- query-language/query-API engine implementation (handled by `frostpillar-query-interface`)

## 2. Backend Controller Architecture

### 2.1 Shared Auto-Commit Orchestration

Durable backend controllers MUST reuse shared orchestration:
- `FileBackendController` MUST extend `AsyncDurableAutoCommitController`.
- `LocalStorageBackendController` MUST extend `AsyncDurableAutoCommitController`.
- `SyncStorageBackendController` MUST extend `AsyncDurableAutoCommitController`.
- each controller `create()` options interface MUST require a `config` object, even when all inner config properties are optional.
- backend-specific commit logic MUST be implemented in `executeSingleCommit()`.
- backend-specific close cleanup MUST be implemented in lifecycle hook methods.
- scheduled auto-commit interval timers MUST be unreferenced immediately after creation (`timer.unref()` in Node.js) so that a Datastore that is not explicitly closed does not prevent the Node.js process from exiting naturally.

### 2.2 File Controller Test Hook Boundary

`FileBackendController` test hooks are test-only orchestration helpers.

Required:
- `FileBackendController.create()` MAY accept explicit optional `testHooks` in create options.
- `FileBackendController.create()` MUST reject `config.__testHooks` with `ConfigurationError`.

## 3. Internal Throw and Async Control-Flow Contract

TypeScript runtime paths MUST throw `Error` instances only.

Required:
- foreground commit failures MUST throw `Error` instances.
- deferred init/close failures MUST throw `Error` instances.
- if `Datastore.close()` observes both deferred initialization failure and backend close failure, it MUST throw `AggregateError` containing both.
- lint config MUST enforce this with `@typescript-eslint/only-throw-error` set to `error`.

Async control flow:
- core orchestration paths MUST use direct `async` functions (not `Promise.resolve().then(async ...)` wrappers).

### 3.1 Deferred Initialization Single-Flight Semantics

Deferred backend initialization MUST use single-flight semantics:
- the pending init promise MUST be stored in a single reference slot.
- the init promise chain MUST clear the reference slot via `.finally()` after settlement, so the slot is null for all subsequent callers once initialization has completed or failed.
- concurrent `runWithOpen` callers that observe the non-null slot MUST await the same promise. After settlement, the `.finally()` handler ensures the slot is cleared exactly once, preventing stale references.

## 4. Shared Metadata Integer Validator

Browser metadata parsing MUST reuse a shared non-negative safe-integer helper under `src/validation/`.

Required:
- `localStorage`, `syncStorage`, `indexedDB`, and `opfs` metadata integer validation MUST call a common helper.
- backend-specific message prefixes MAY differ, but numeric validation semantics MUST stay aligned.

## 5. Storage Source Layout by Responsibility

`src/storage` MUST be organized by responsibility:
- `src/storage/datastore/`: datastore orchestration and lifecycle.
- `src/storage/backend/`: backend-agnostic orchestration primitives.
- `src/storage/config/`: runtime config parsing/path resolution variants.
- `src/storage/drivers/file/`: file backend implementation/controller.
- `src/storage/drivers/localStorage/`: localStorage backend implementation/controller.
- `src/storage/drivers/IndexedDB/`: IndexedDB backend implementation/controller.
- `src/storage/drivers/opfs/`: OPFS backend implementation/controller.
- `src/storage/drivers/syncStorage/`: sync storage backend implementation/controller.
- `src/storage/btree/`: key-index B-Tree adapter boundary.
- `src/storage/record/`: storage-scoped record identity/ordering helpers.

Placement constraints:
- modules MUST NOT be duplicated across old/new paths.
- cross-responsibility imports MUST use explicit relative paths.
- package public exports remain unchanged unless separately specified.
- query engine modules MUST NOT be implemented under this repository's `src/storage/*` layout.

## 6. B-Tree Adapter Boundary

`src/storage/btree/` is an adapter boundary around `@frostpillar/frostpillar-btree`.

### 6.1 Adapter API

The adapter (`RecordKeyIndexBTree`) wraps `InMemoryBTree` and exposes:

Key type:
- adapter MUST use the plain user key `TKey` as btree key (not a composite key).
- duplicate key handling MUST be delegated to the btree's native `DuplicateKeyPolicy`.
- adapter constructor MUST accept `duplicateKeys: DuplicateKeyPolicy` and forward it to the btree config.
- adapter constructor MUST accept `autoScale?: boolean`, `maxLeafEntries?: number`, and `maxBranchChildren?: number` and forward them to the btree config.
- adapter MUST default `autoScale` to `true` when not explicitly provided.
- adapter MUST enable `enableEntryIdLookup: true` in btree config.

Mutation:
- `put(key, value)` MUST return `EntryId` from the btree.
- `putMany(entries)` MUST accept `readonly { key: TKey; value: TValue }[]` pre-sorted by key and return `EntryId[]` from the btree.

Read (non-destructive):
- `peekLast()` MUST return the rightmost entry or `null` via btree's `peekLast`.

ID-based operations:
- `peekById(entryId)` MUST return entry or null via btree's `peekById`.
- `updateById(entryId, value)` MUST return previous entry or null via btree's `updateById`.
- `removeById(entryId)` MUST return removed entry or null via btree's `removeById`.

Range and bulk:
- `rangeQuery(start, end)` MUST return entries in range via btree's `range`.
- `deleteRange(start, end)` MUST return count of deleted entries via btree's `deleteRange`.
- `snapshot()` MUST return all entries via btree's `snapshot`.
- `popFirst()` MUST return oldest entry or null via btree's `popFirst`.
- `size()` MUST return entry count via btree's `size`.
- `hasKey(key)` MUST return boolean via btree's `hasKey`.
- `keys()` MUST return key iterator via btree's `keys`.

Serialization:
- `toJSON()` MUST return `BTreeJSON` via btree's `toJSON`.
- static `fromJSON(json, config)` MUST restore adapter from `BTreeJSON` via btree's `fromJSON`.
- `fromJSON` MUST patch the snapshot's config with the provided `config` values (`duplicateKeys`, `autoScale`, `maxLeafEntries`, `maxBranchChildren`) so that constructor-time settings override whatever was persisted in the snapshot.

Lifecycle:
- `clear()` MUST call btree's `clear`.

### 6.2 Adapter Dependencies

Required:
- datastore internals MUST depend on `RecordKeyIndexBTree` adapter, not upstream package directly.
- comparator safety: adapter MUST reject `NaN` comparator results with `IndexCorruptionError`. Non-integer and non-finite results (e.g. `0.5`, `Infinity`) are clamped to `-1`/`0`/`1` on the hot path for performance. Full validation via `normalizeComparatorResult` (which rejects non-finite and non-integer values) is applied at the `getRange` boundary check only; other Datastore APIs (`getMany`, `keys`) use lightweight clamping.
- datastore modules MUST NOT import `ConcurrentInMemoryBTree` directly.

Removed from adapter (superseded by btree native capabilities):
- `RecordKeyIndexEntryKey<TKey>` composite type
- `createRangeStartKey`, `createRangeEndKey`
- `MAX_INSERTION_ORDER_SENTINEL`

## 7. External Query Boundary

Query-language and query-API capabilities (Native/SQL-like/Lucene-like) are outside this repository boundary.

Required:
- storage-engine modules in this repository MUST expose storage-focused primitives only.
- integration with external query interface layer MUST happen outside this repository.

## 8. Build Output Cleanup Safety

`scripts/clean-build-output.mjs` MUST resolve removable output targets from repository root derived from script file location.

Required:
- cleanup path resolution MUST NOT depend on `process.cwd()`.

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 0.5 | 2026-04-01 | Rename adapter insert→put, add putMany/peekLast to adapter API (§6.1). |
| 0.4 | 2026-03-30 | Add deferred init single-flight semantics (§3.1), autoCommit timer unref requirement (§2.1). |
| 0.3 | 2026-03-25 | Rewrite B-Tree adapter boundary for plain key + EntryId API (§6), remove composite key types. |
| 0.2 | 2026-03-21 | Add storage source layout by responsibility (§5), build output cleanup safety (§8). |
| 0.1 | 2026-03-20 | Initial specification. |
