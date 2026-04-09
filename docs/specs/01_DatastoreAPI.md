# Spec: Datastore API (Core Baseline)

Status: Active
Version: 0.16
Last Updated: 2026-04-09

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
import {
  Datastore,
  FrostpillarError,
} from '@frostpillar/frostpillar-storage-engine';
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

| Policy              | Behavior                                            | Use case                  |
| ------------------- | --------------------------------------------------- | ------------------------- |
| `'allow'` (default) | Multiple records per key, insertion-order preserved | Logs, events, time-series |
| `'replace'`         | One record per key, last-write-wins                 | Config, settings, cache   |
| `'reject'`          | One record per key, throws on duplicate             | Unique constraints        |

Validation rules:

- when `duplicateKeys` is omitted or `undefined`, MUST default to `'allow'`.
- when `duplicateKeys` is not one of the three valid string values, construction MUST fail with `ConfigurationError`.
- the resolved policy value is stored internally for forwarding to the B+Tree adapter (see §6 B-Tree Adapter Boundary in `03_InternalArchitecture.md`).

When the resolved policy is `'reject'` and a `put`/`putMany` operation targets an already-existing key, the operation MUST throw `DuplicateKeyError` (which extends `ValidationError`). The thrown message MUST be the stable string `"Duplicate key rejected: a record with this key already exists."`. Consumers SHOULD prefer `instanceof DuplicateKeyError` over message matching; `instanceof ValidationError` MUST continue to match for back-compat.

### 2.2 Index Configuration (`config.index`)

`DatastoreConfig` accepts an optional `index` field:

```typescript
index?: {
  autoScale?: boolean;
  maxLeafEntries?: number;
  maxBranchChildren?: number;
  deleteRebalancePolicy?: 'standard' | 'lazy';
};
```

- when `index` is omitted or `undefined`, MUST default to `{ autoScale: true }`.
- `autoScale` (default `true`): when `true`, the B+Tree index automatically increases node capacity as the entry count grows.
- `maxLeafEntries` and `maxBranchChildren`: optional fixed node capacities forwarded to frostpillar-btree. Only valid when `autoScale` is `false` or omitted as `false`.
- when `autoScale` is `true` and `maxLeafEntries` or `maxBranchChildren` is also set, construction MUST fail with `ConfigurationError`.
- `deleteRebalancePolicy` (default `'standard'`): controls whether the B+Tree rebalances on delete. `'lazy'` skips rebalancing for better bulk-delete throughput.
- when `deleteRebalancePolicy` is not `'standard'` or `'lazy'`, construction MUST fail with `ConfigurationError`.
- all resolved values are forwarded to the B+Tree adapter (see §6 B-Tree Adapter Boundary in `03_InternalArchitecture.md`).

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
- `replaceById(id, payload): Promise<boolean>`
- `deleteById(id): Promise<boolean>`

Bulk operations:

- `getAll(): Promise<KeyedRecord[]>`
- `getRange(start, end): Promise<KeyedRecord[]>`
- `getMany(keys[]): Promise<KeyedRecord[]>`
- `putMany(records[]): Promise<void>`
- `deleteMany(keys[]): Promise<number>`
- `deleteByIds(ids[]): Promise<number>`
- `clear(): Promise<void>`

Range counting:

- `countRange(start, end): Promise<number>`

Metadata operations:

- `count(): Promise<number>`
- `keys(): Promise<unknown[]>`

Lifecycle and system:

- `commit(): Promise<void>`
- `close(): Promise<void>`
- `on('error', listener): () => void`
- `off('error', listener): void`
  All record-returning APIs (`get`, `getFirst`, `getLast`, `getById`, `getAll`, `getRange`, `getMany`) MUST include read-only `_id` field in returned `KeyedRecord`.

`put(record)`:

- MUST throw `ValidationError` with a stable descriptive message when the `record` argument is `null`, not an object (e.g. a primitive), or does not include a `key` property.
- Stable messages: `"Record must be a non-null object"` (null or non-object), `'Record must include "key".'` (missing key property).

`putMany(records[])` (record-level validation):

- each element of the array MUST satisfy the same guard as `put`: MUST throw `ValidationError` when an element is `null`, not an object, or missing a `key` property.

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

`countRange(start, end)`:

- MUST return the number of records where `start <= key <= end` (inclusive) using datastore key comparator.
- MUST fail with `InvalidQueryRangeError` when `start > end`.
- MUST NOT materialize records — delegates to B+Tree `count()` for zero-allocation counting.
- this is a read operation (no exclusive lock required).

`getMany(keys[])`:

- MUST retrieve records for a discrete set of keys.
- keys do not need to be contiguous.
- MUST return `KeyedRecord[]` (flattened results across all keys).
- result order MUST be key ascending, then insertion order ascending (same as `getAll`/`getRange`).

`putMany(records[])`:

- each record follows `put` semantics (always appends, allows duplicate keys).
- each element MUST be a non-null object with a `key` property; otherwise MUST throw `ValidationError` (see `put` validation above).
- atomicity depends on capacity policy:
  - `strict`: atomic batch — all records are validated before any insertion. If validation or capacity check fails, no records are inserted.
  - `turnover` or no capacity configured: non-atomic, left-to-right. If an element fails, previously applied elements remain applied.

`deleteMany(keys[])`:

- each key follows `delete` semantics (removes all records with that key).
- executes left-to-right by input order.
- non-atomic: if an element fails, previously applied elements remain applied.
- MUST return the total number of records removed across all keys.

`deleteByIds(ids[])`:

- MUST delete records by their `EntryId` values (not by key).
- MUST return the total number of records actually deleted (some ids may not exist).
- if the array is empty, MUST return 0 (no-op).
- each deletion follows the same semantics as `deleteById` (remove from B+Tree, update size tracking).
- all deletions MUST execute within a single mutex acquisition for atomicity with respect to other operations.
- MUST forward a single aggregated durability signal (total freed bytes) to backend controller after all deletions, rather than per-deletion signals.
- non-atomic with respect to partial progress: if the array contains both valid and invalid ids, valid ids are deleted and invalid ids are skipped.

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

- `compare(left, right)` SHOULD return a negative integer, zero, or positive integer.
- `NaN` is the only truly invalid return value: it MUST be rejected with `IndexCorruptionError` in all code paths — the key-index adapter wrapped comparator, lightweight clamping, and boundary validation.
- Non-NaN values (including non-integer floats such as `0.5` and non-finite values `Infinity`/`-Infinity`) are accepted and clamped to `-1`, `0`, or `+1` in the hot path. This is by design for performance (P14, ADR-0054) — no throw is raised.
- boundary-validation APIs (`getRange`) MUST validate via `normalizeComparatorResult` and throw `IndexCorruptionError` for non-finite or non-integer results.
- hot-path loop APIs (`getMany`, `keys`, internal `put`/comparator wrapping) use lightweight clamping and do NOT throw for non-integer or non-finite (non-NaN) results; these are silently clamped to `-1`/`0`/`+1`.

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
- returned payload is a shared reference to internal state. Callers MUST NOT mutate returned payloads. Payloads are defensively cloned on insert (not on read) for performance. When `skipPayloadValidation` is `true`, insert-time cloning is also skipped and the payload is stored by reference; the caller MUST NOT mutate the object after insertion. The `KeyedRecord` fields are typed `readonly` at the TypeScript level.
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

`replaceById(id, payload)`:

- MUST fully replace the payload of the record matching the given `_id`.
- unlike `updateById` (shallow merge), `replaceById` treats the provided payload as the complete new document — existing fields not present in the new payload are removed.
- MUST return `true` when record was found and replaced, `false` when `_id` does not match any record.
- MUST NOT change the record's `key` or `_id`.
- MUST enforce strict max-size boundary checks only when resulting encoded size increases.
- MUST NOT trigger turnover eviction.
- the new payload MUST satisfy all payload validation constraints (§7) before being stored; if the new payload violates any constraint, the operation MUST fail with `ValidationError` and leave the existing record unchanged.
- successful replace MUST forward durability signal bytes to backend controller pending-byte tracking.
- atomic — the record is never removed from the B+Tree; only its payload is swapped in-place (no TOCTOU window).

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

### 7.1 Payload Limits Configuration (`config.payloadLimits`)

`DatastoreConfig` accepts an optional `payloadLimits` field to override default validation thresholds:

```typescript
interface PayloadLimitsConfig {
  maxDepth?: number; // default: 64
  maxKeyBytes?: number; // default: 1024
  maxStringBytes?: number; // default: 65535
  maxKeysPerObject?: number; // default: 256
  maxTotalKeys?: number; // default: 4096
  maxTotalBytes?: number; // default: 1048576
}
```

Configuration rules:

- when `payloadLimits` is omitted or `undefined`, all limits MUST use their default values.
- each field within `payloadLimits` is independently optional; omitted fields MUST use the default value.
- each provided value MUST be a positive safe integer; otherwise construction MUST fail with `ConfigurationError`.
- when `skipPayloadValidation` is `true`, `payloadLimits` are still validated at construction time (invalid values throw `ConfigurationError`), but are not applied at runtime validation — all runtime payload checks are skipped.

### 7.2 Payload Structural Rules

Payload object keys:

- MUST be non-empty strings.
- MUST NOT be whitespace-only strings.
- MUST NOT use reserved names: `__proto__`, `constructor`, `prototype`.

Payload nesting:

- Payload nesting depth MUST be at most `payloadLimits.maxDepth` (default 64) object levels.
- top-level `payload` object is level 1.
- level equal to `maxDepth` is valid; level exceeding `maxDepth` MUST fail with `ValidationError`.

## 8. Close and Error Contract

Close behavior:

- after `close()`, operations MUST fail with `ClosedDatastoreError`.
- datastore MUST enter closing guard at first `close()` start.
- concurrent `close()` calls MUST share a single close sequence and call backend controller close at most once.
- if a concurrent `close()` call joins an in-flight close sequence that fails, the joining caller MUST also receive the error (re-throw). Silently swallowing the close error for joining callers is prohibited.
- if both deferred backend initialization failure and backend close failure happen in same `close()`, `close()` MUST throw `AggregateError` containing both errors in order: init failure first, close failure second.

Public error family:

- all public errors extend `FrostpillarError` (which extends `Error`).
- core exported errors include `ValidationError`, `ConfigurationError`, `InvalidQueryRangeError`, `ClosedDatastoreError`, `UnsupportedBackendError`, `StorageEngineError`, `DatabaseLockedError`, `BinaryFormatError`, `PageCorruptionError`, `IndexCorruptionError`, `QuotaExceededError`, and `DuplicateKeyError`.

`DuplicateKeyError` extends `ValidationError` and is thrown by `put`/`putMany` under `duplicateKeys: 'reject'` when a duplicate key is encountered (see §2.1).

## 9. Concurrency Model

### 9.1 Operation Serialization

Within a single Datastore instance, all mutating operations MUST be serialized with respect to each other:

Mutating operations (require exclusive access):

- `put`, `putMany`, `delete`, `deleteMany`, `deleteByIds`, `clear`, `updateById`, `replaceById`, `deleteById`

Read operations (allow concurrent access):

- `get`, `getFirst`, `getLast`, `getAll`, `getRange`, `getMany`, `count`, `countRange`, `keys`, `getById`, `has`

Serialization rules:

- mutating operations MUST NOT execute concurrently with any other mutating operation on the same instance.
- read operations MAY execute concurrently with each other.
- read operations MAY observe intermediate state at async yield points within a multi-step mutation (e.g., between individual inserts in `putMany`). In JavaScript's single-threaded runtime, in-memory state is consistent at each yield point, so reads are safe without mutex acquisition.
- implementation SHOULD use an async mutex to enforce write serialization.

## Revision History

| Version | Date       | Summary                                                                                                                                                                   |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.16    | 2026-04-09 | Add typed `DuplicateKeyError` (extends `ValidationError`) thrown under `duplicateKeys: 'reject'` (§2.1, §8).                                                              |
| 0.15    | 2026-04-09 | Add `countRange(start, end)` range counting API (§3, §3.1). Add `deleteRebalancePolicy` index config (§2.2). Add `countRange` to read operations concurrency list (§9).   |
| 0.14    | 2026-04-08 | Specify `ValidationError` for `put`/`putMany` when record is null, non-object, or missing `key` (§3).                                                                     |
| 0.13    | 2026-04-07 | Clarify `putMany` atomicity by capacity policy (§3.1). Clarify `payloadLimits` with `skipPayloadValidation` (§7.1). Require NaN rejection in all comparator paths (§4.3). |
| 0.12    | 2026-04-05 | Add `replaceById` (§5.1) and `deleteByIds` (§3.1) operations.                                                                                                             |
| 0.11    | 2026-04-05 | Add configurable payload limits (§7.1). Restructure §7 into §7.1/§7.2.                                                                                                    |
| 0.10    | 2026-04-04 | Clarify comparator clamping vs validation per P14 (§4.3). Remove frozen-payload contract per P3-C (§5.1).                                                                 |
| 0.9     | 2026-04-01 | Add `getLast(key)` as counterpart of `getFirst(key)` (§3).                                                                                                                |
| 0.8     | 2026-03-30 | Add concurrency model and write serialization (§9).                                                                                                                       |
| 0.7     | 2026-03-29 | Add replace-mode capacity delta accounting (§5), frozen payload contract (§5.1).                                                                                          |
| 0.6     | 2026-03-28 | Add duplicate key policy (§2.1), B+Tree eviction order (§5).                                                                                                              |
| 0.5     | 2026-03-25 | Replace RecordId with EntryId (§6), remove timestamp alias (§4).                                                                                                          |
| 0.4     | 2026-03-22 | Add bulk operation semantics (§3.1), metadata operations (§3.2).                                                                                                          |
| 0.3     | 2026-03-21 | Add key definition contract (§4.1), recovery-time codec safety (§4.2).                                                                                                    |
| 0.2     | 2026-03-20 | Add comparator safety and insertion-order guard (§4.3).                                                                                                                   |
| 0.1     | 2026-03-20 | Initial specification.                                                                                                                                                    |
