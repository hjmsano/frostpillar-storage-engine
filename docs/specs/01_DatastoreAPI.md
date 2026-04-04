# Spec: Datastore API (Core Baseline)

Status: Active
Version: 0.10
Last Updated: 2026-04-04

## 1. Scope

This spec defines the public Datastore contract and payload/key behavior for storage-engine CRUD operations.

In scope:
- package root public entry and method contract
- key model, key codec contract, and `EntryId` (`_id`) behavior
- payload validation
- close/error behavior observable from public API

Out of scope:
- backend-specific durability internals (see `02_DurableBackends.md`)
- repository/internal source layout policy (see `03_InternalArchitecture.md`)
- query-language parsing/execution and high-level query API design (handled by `frostpillar-query-interface`)

## 2. Public Entry and Construction

```typescript
import { Datastore, FrostpillarError } from '@frostpillar/frostpillar-storage-engine';
```

`FrostpillarError` MUST be exported from the package entrypoint and MUST be part of the public API exports.

Driver factories MUST be exposed as subpath exports:

```typescript
import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';
import { localStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/localStorage';
import { indexedDBDriver } from '@frostpillar/frostpillar-storage-engine/drivers/indexedDB';
import { opfsDriver } from '@frostpillar/frostpillar-storage-engine/drivers/opfs';
import { syncStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/syncStorage';
```

Browser-targeted driver factories MUST also be exported from the package root entry so browser release bundles can access them through a single global object:
- `localStorageDriver`
- `indexedDBDriver`
- `opfsDriver`
- `syncStorageDriver`

Hybrid delivery and tree-shaking contract:
- npm package delivery MUST remain ESM-first and importable from package root and driver subpath exports.
- npm package metadata MUST keep `sideEffects: false`.
- package runtime exports MUST remain named exports only.
- npm publish payload MUST exclude browser release bundle artifact `dist/frostpillar-storage-engine.min.js`.
- browser minified release bundle MUST be built from `src/index.ts` and expose all runtime exports of that root entry on `window.FrostpillarStorageEngine`.
- Node-only driver subpath modules (for example `drivers/file`) remain part of npm package delivery and are not required to execute in browser bundle profile.

Construction rules:
- `new Datastore({})` MUST create in-memory mode.
- durable mode MUST be explicitly selected with `driver`.
- `autoCommit` MUST be configured on Datastore config (top-level), not inside driver options.
- when `autoCommit` is provided without a durable `driver`, datastore construction MUST fail with `ConfigurationError`.

### 2.1 Duplicate Key Policy (`config.duplicateKeys`)

`DatastoreConfig` accepts an optional `duplicateKeys` field:

```typescript
duplicateKeys?: 'allow' | 'replace' | 'reject';
```

| Policy | Behavior | Use case |
|--------|----------|----------|
| `'allow'` (default) | Multiple records per key, insertion-order preserved | Logs, events, time-series |
| `'replace'` | One record per key, last-write-wins | Config, settings, cache |
| `'reject'` | One record per key, throws on duplicate | Unique constraints |

Validation rules:
- when `duplicateKeys` is omitted or `undefined`, MUST default to `'allow'`.
- when `duplicateKeys` is not one of the three valid string values, construction MUST fail with `ConfigurationError`.
- the resolved policy value is stored internally for forwarding to the B+Tree adapter (see §6 B-Tree Adapter Boundary in `03_InternalArchitecture.md`).

## 3. Core Methods

Key-based operations:
- `put(record): Promise<void>`
- `get(key): Promise<KeyedRecord[]>`
- `getFirst(key): Promise<KeyedRecord | null>`
- `getLast(key): Promise<KeyedRecord | null>`
- `delete(key): Promise<number>`
- `has(key): Promise<boolean>`

ID-based operations (target exactly one record by system-generated `_id`):
- `getById(id): Promise<KeyedRecord | null>`
- `updateById(id, patch): Promise<boolean>`
- `deleteById(id): Promise<boolean>`

Bulk operations:
- `getAll(): Promise<KeyedRecord[]>`
- `getRange(start, end): Promise<KeyedRecord[]>`
- `getMany(keys[]): Promise<KeyedRecord[]>`
- `putMany(records[]): Promise<void>`
- `deleteMany(keys[]): Promise<number>`
- `clear(): Promise<void>`

Metadata operations:
- `count(): Promise<number>`
- `keys(): Promise<unknown[]>`

Lifecycle and system:
- `commit(): Promise<void>`
- `close(): Promise<void>`
- `on('error', listener): () => void`
- `off('error', listener): void`
All record-returning APIs (`get`, `getFirst`, `getLast`, `getById`, `getAll`, `getRange`, `getMany`) MUST include read-only `_id` field in returned `KeyedRecord`.

`getLast(key)`:
- counterpart of `getFirst(key)`.
- MUST return the last (latest-inserted) record matching the given key, or `null` if no record exists with that key.
- when `duplicateKeys` is `'replace'` or `'reject'`, behavior is identical to `getFirst(key)` since at most one record per key exists.

### 3.1 Bulk Operation Semantics

`getAll()`:
- MUST return all records in the datastore ordered by key ascending, then insertion order ascending.
- intended for small-to-medium datasets (settings, caches, config).

`getRange(start, end)`:
- MUST return all records where `start <= key <= end` (inclusive) using datastore key comparator.
- MUST fail with `InvalidQueryRangeError` when `start > end`.

`getMany(keys[])`:
- MUST retrieve records for a discrete set of keys.
- keys do not need to be contiguous.
- MUST return `KeyedRecord[]` (flattened results across all keys).
- result order MUST be key ascending, then insertion order ascending (same as `getAll`/`getRange`).

`putMany(records[])`:
- each record follows `put` semantics (always appends, allows duplicate keys).
- executes left-to-right by input order.
- non-atomic: if an element fails, previously applied elements remain applied.

`deleteMany(keys[])`:
- each key follows `delete` semantics (removes all records with that key).
- executes left-to-right by input order.
- non-atomic: if an element fails, previously applied elements remain applied.
- MUST return the total number of records removed across all keys.

`clear()`:
- MUST remove all records from the datastore.
- MUST reset current size tracking to zero.
- MUST signal the backend controller as dirty so that durable auto-commit commits the cleared state, even when pending bytes is zero.
- if that background auto-commit fails, the clear-dirty signal MUST remain pending and be retried by subsequent scheduled background commits until a commit succeeds.

### 3.2 Metadata Operation Semantics

`count()`:
- MUST return the total number of records in the datastore.

`keys()`:
- MUST return all distinct keys in datastore comparator ascending order.
- MUST NOT include duplicate keys.
- MUST NOT load payloads.

## 4. Key Model and Ordering

- records are ordered by `key` ascending, then insertion-order ascending for key ties.
- range retrieval is inclusive (`start <= key <= end`) using datastore key comparator.
- if `start` or `end` does not exist as an exact stored key, range selection MUST still use comparator boundaries for the inclusive interval.

Default key behavior:
- default mode is string key mode.
- default key comparator is lexicographic ascending.
- default comparator ordering is locale-insensitive and deterministic (Unicode code point order via `<` / `>` semantics).
- `put()` input MUST include `key`; `timestamp` field alias is not supported.

### 4.1 Key Definition Contract (`config.key`)

When `config.key` is provided, all are required:
- `normalize(value, fieldName) => key`
- `compare(left, right) => number`
- `serialize(key) => string`
- `deserialize(serialized) => key`

Validation rules:
- datastore construction MUST fail with `ConfigurationError` when any required callback is missing or not a function.

Runtime callback behavior:
- if `normalize`, `compare`, or `serialize` throws during normal operations, the active operation MUST fail with the thrown value.
- if `serialize` returns a non-string value during normal insert flow, operation MUST fail with `ValidationError`.

### 4.2 Recovery-Time Key Codec Safety

During durable backend initialization:
- if `deserialize(serialized)` throws, initialization MUST fail with `IndexCorruptionError`.
- datastore MUST validate round-trip integrity:
  `serialize(deserialize(serialized)) === serialized`.
- if round-trip serialize throws or returns non-string, initialization MUST fail with `IndexCorruptionError`.
- if round-trip equality fails, initialization MUST fail with `IndexCorruptionError`.

### 4.3 Comparator Safety and Insertion-Order Guard

Comparator safety contract:
- `compare(left, right)` MUST return a finite integer.
- non-integer values (for example `0.5`) and non-finite values (`NaN`, `Infinity`, `-Infinity`) are invalid.
- the key-index adapter MUST reject `NaN` with `IndexCorruptionError` and clamp all other results to `-1`/`0`/`1`.
- boundary-validation APIs (`getRange`) MUST validate via `normalizeComparatorResult` and throw `IndexCorruptionError` for non-finite or non-integer results.
- hot-path loop APIs (`getMany`, `keys`) use lightweight clamping (P14, ADR-0054) and do NOT throw `IndexCorruptionError` for non-integer or non-finite (non-NaN) results; these are silently clamped.

Insertion-order boundary guard:
- internal insertion-order counter MUST remain strictly below
  `MAX_INSERTION_ORDER_SENTINEL = 1n << 64n`.
- `put()` MUST fail with `IndexCorruptionError` when next insertion-order reaches or exceeds this sentinel.

## 5. Mutation and Capacity Semantics

If `capacity.maxSize` is configured:
- `strict`: reject overflow with `QuotaExceededError`.
- `turnover`: evict records from the front of the B+Tree until new record fits.
- eviction order is determined by the B+Tree's key comparator ordering (smallest key first), consistent with the tree being the single source of truth.
- turnover eviction MUST make forward progress each loop; zero/negative reclaim MUST fail with `IndexCorruptionError`.

When `duplicateKeys` is `'replace'` and `put()` targets an existing key:
- capacity enforcement MUST use the size delta `(newEncodedBytes − existingEncodedBytes)` rather than the full new record size.
- if the delta is zero or negative (replacement is same size or smaller), capacity enforcement MUST be skipped entirely.
- `currentSizeBytes` tracking MUST be updated by the delta, not the full new record size.
- turnover eviction MUST NOT evict unrelated records when the replacement fits within the freed space of the old record.
- if turnover eviction removes the target key before replacement, the operation MUST fall back to fresh-insert accounting (full `encodedBytes`), not delta accounting.

### 5.1 ID-based Operation Semantics

`getById(id)`:
- MUST return the `KeyedRecord` matching the given `_id`, or `null` if no record exists with that `_id`.
- returned record MUST include `_id`, `key`, and `payload` fields.
- returned payload is a shared reference to internal state. Callers MUST NOT mutate returned payloads. Payloads are defensively cloned on insert (not on read) for performance. The `KeyedRecord` fields are typed `readonly` at the TypeScript level.
- `_id` used with `getById` MUST be a value previously obtained from a record-returning API (`get`, `getFirst`, `getLast`, `getById`, `getRange`).
- after `deleteById(id)` or `delete(key)` removes the record, `getById` MUST return `null` for that `_id`.

`updateById(id, patch)`:
- MUST use shallow merge semantics: `{ ...existingPayload, ...normalizedPatch }`.
- nested objects in patch replace existing nested objects; deep merge is out of scope.
- payload `undefined` values are rejected; callers MUST NOT treat `undefined` as delete marker.
- MUST return `true` when record was found and updated, `false` when `_id` does not match any record.
- MUST NOT change the record's `key` or `_id`.
- MUST enforce strict max-size boundary checks only when resulting encoded size increases.
- MUST NOT trigger turnover eviction.
- merged payload (existing + patch) MUST satisfy all payload validation constraints (§7) before being stored; if the merged result violates any constraint, the operation MUST fail with `ValidationError` and leave the existing record unchanged.
- successful update MUST forward durability signal bytes to backend controller pending-byte tracking.

`deleteById(id)`:
- MUST return `true` when record was found and removed, `false` when `_id` does not match any record.
- after deletion, the record MUST be inaccessible via both `getById(id)` and key-based operations.
- MUST remove the record from the B+Tree (single source of truth).
- successful delete MUST forward durability signal bytes to backend controller pending-byte tracking.

Backend-limit sentinel (`capacity.maxSize = "backendLimit"`) rules are defined in `02_DurableBackends.md`.

## 6. `_id` and `EntryId`

- `_id` is the B+Tree's ephemeral `EntryId` (a branded number).
- `_id` is included in all record-returning APIs (`get`, `getFirst`, `getLast`, `getById`, `getAll`, `getRange`, `getMany`).
- `put()` does not return `EntryId`; callers discover `_id` from record-returning APIs.
- `EntryId` is ephemeral — it is re-issued on `fromJSON()` restoration and `clear()`.
- after restart (or backend `fromJSON()` restoration), users MUST re-query to obtain new `_id` values.
- `getById`, `updateById`, `deleteById` accept `EntryId` (not the legacy `RecordId` string).
- `RecordId` string format, `createRecordId()`, and `parseRecordId()` are removed from the public API.

## 7. Payload Validation Contract

Payload object keys:
- MUST be non-empty strings.
- MUST NOT be whitespace-only strings.
- MUST NOT use reserved names: `__proto__`, `constructor`, `prototype`.

Payload nesting:
- Payload nesting depth MUST be at most 64 object levels.
- top-level `payload` object is level 1.
- level 64 is valid; level 65 MUST fail with `ValidationError`.

## 8. Close and Error Contract

Close behavior:
- after `close()`, operations MUST fail with `ClosedDatastoreError`.
- datastore MUST enter closing guard at first `close()` start.
- concurrent `close()` calls MUST share a single close sequence and call backend controller close at most once.
- if a concurrent `close()` call joins an in-flight close sequence that fails, the joining caller MUST also receive the error (re-throw). Silently swallowing the close error for joining callers is prohibited.
- if both deferred backend initialization failure and backend close failure happen in same `close()`, `close()` MUST throw `AggregateError` containing both errors in order: init failure first, close failure second.

Public error family:
- all public errors extend `FrostpillarError` (which extends `Error`).
- core exported errors include `ValidationError`, `ConfigurationError`, `InvalidQueryRangeError`, `ClosedDatastoreError`, `UnsupportedBackendError`, `StorageEngineError`, `DatabaseLockedError`, `BinaryFormatError`, `PageCorruptionError`, `IndexCorruptionError`, and `QuotaExceededError`.

## 9. Concurrency Model

### 9.1 Operation Serialization

Within a single Datastore instance, all mutating operations MUST be serialized with respect to each other:

Mutating operations (require exclusive access):
- `put`, `putMany`, `delete`, `deleteMany`, `clear`, `updateById`, `deleteById`

Read operations (allow concurrent access):
- `get`, `getFirst`, `getLast`, `getAll`, `getRange`, `getMany`, `count`, `keys`, `getById`, `has`

Serialization rules:
- mutating operations MUST NOT execute concurrently with any other mutating operation on the same instance.
- read operations MAY execute concurrently with each other.
- read operations MAY observe intermediate state at async yield points within a multi-step mutation (e.g., between individual inserts in `putMany`). In JavaScript's single-threaded runtime, in-memory state is consistent at each yield point, so reads are safe without mutex acquisition.
- implementation SHOULD use an async mutex to enforce write serialization.

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 0.10 | 2026-04-04 | Clarify comparator clamping vs validation per P14 (§4.3). Remove frozen-payload contract per P3-C (§5.1). |
| 0.9 | 2026-04-01 | Add `getLast(key)` as counterpart of `getFirst(key)` (§3). |
| 0.8 | 2026-03-30 | Add concurrency model and write serialization (§9). |
| 0.7 | 2026-03-29 | Add replace-mode capacity delta accounting (§5), frozen payload contract (§5.1). |
| 0.6 | 2026-03-28 | Add duplicate key policy (§2.1), B+Tree eviction order (§5). |
| 0.5 | 2026-03-25 | Replace RecordId with EntryId (§6), remove timestamp alias (§4). |
| 0.4 | 2026-03-22 | Add bulk operation semantics (§3.1), metadata operations (§3.2). |
| 0.3 | 2026-03-21 | Add key definition contract (§4.1), recovery-time codec safety (§4.2). |
| 0.2 | 2026-03-20 | Add comparator safety and insertion-order guard (§4.3). |
| 0.1 | 2026-03-20 | Initial specification. |
