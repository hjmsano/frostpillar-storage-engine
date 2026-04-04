# ADR-0050: B+Tree-Centric Storage Architecture and Duplicate Key Policy

Status: Proposed
Date: 2026-03-29

Supersedes (partially): 0018, 0020, 0021, 0023, 0025, 0031, 0038, 0040, 0048

## Context

The `frostpillar-btree` package (v0.3.0) now provides comprehensive B+Tree
capabilities including:

- Configurable `DuplicateKeyPolicy` (`'allow'`, `'replace'`, `'reject'`)
- `EntryId`-based O(1) lookups (`peekById`, `updateById`, `removeById`)
- Bulk operations (`insertMany`, `deleteRange`, `count`)
- Serialization (`toJSON` / `fromJSON`) with automatic sequence re-issue
- Concurrent support (`ConcurrentInMemoryBTree`)
- Auto-scaling node capacity

The storage engine currently maintains **dual data structures** that must stay
in sync:

1. `recordsByInsertionOrder` (`Map<bigint, PersistedRecord>`) — O(1) ID lookups
2. `keyIndex` (`RecordKeyIndexBTree`) — key-ordered access via composite key
   `{ key: TKey, insertionOrder: bigint }`

This duplication causes:

- Every mutation must touch both structures
- Integrity guards (`IndexCorruptionError`) at every sync point
- Custom `insertionOrder` tracking and `RecordId` format (`k~<key>:<order>`)
- Manual snapshot/seed logic for persistence
- The composite key workaround prevents leveraging the btree's native
  duplicate key handling

Since there are no existing users, breaking changes are acceptable.

## Design Decisions

### 1. B+Tree as single source of truth

The btree becomes the sole data structure. The `recordsByInsertionOrder` Map
and all sync guards are removed.

**Before:**
```
User API → Datastore → Map (ID lookup) + BTree (key lookup) → Backend Driver
```

**After:**
```
User API → Datastore (validation, capacity) → BTree (all data ops) → Backend Driver
```

### 2. Plain user key with configurable `DuplicateKeyPolicy`

The composite key `{ key, insertionOrder }` is replaced by the plain user key
`TKey`. Duplicate key handling is delegated to the btree's native policy.

New `DatastoreConfig` option:

```ts
interface DatastoreConfig<TKey, TInput> {
  duplicateKeys?: 'allow' | 'replace' | 'reject'; // default: 'allow'
  // ... existing options
}
```

| Policy | Behavior | Use case |
|--------|----------|----------|
| `'allow'` | Multiple records per key, insertion-order preserved | Logs, events, time-series |
| `'replace'` | One record per key, last-write-wins | Config, settings, cache |
| `'reject'` | One record per key, throws on duplicate | Unique constraints |

### 3. Ephemeral `EntryId` replaces `RecordId`

The btree's `EntryId` (a branded number, O(1) via `enableEntryIdLookup`)
replaces the persistent `RecordId` string format.

**Key properties:**

- `EntryId` is ephemeral — re-issued on `fromJSON()` and `clear()`
- Users obtain `EntryId` from query results within the same instance
- After restart (or `fromJSON()`), users must re-query to obtain new IDs
- This is the intended access pattern: query by key, then act by ID

**Removed:**

- `RecordId` canonical format (`k~<key>:<insertionOrder>`)
- `createRecordId()` / `parseRecordId()` utilities
- `insertionOrder: bigint` field on `PersistedRecord`
- `MAX_INSERTION_ORDER_SENTINEL`

### 4. Persistence via `toJSON()` / `fromJSON()`

Backend drivers write `tree.toJSON()` output and restore via
`InMemoryBTree.fromJSON()`.

**Properties of `fromJSON()`:**

- Validates JSON structure, config, and entry sort order
- Re-issues internal sequence numbers from 0 (order preserved by array position)
- Re-issues `EntryId`s from 0
- Rebuilds tree via `insertMany()` (O(n) bulk load)

**Removed:**

- Custom snapshot/encoding/seeding logic (`getRecordsSnapshot`, `seedRecordIndex`)
- `computeRecordEncodedBytes` for per-record byte tracking
- Stable JSON stringification / UTF-8 byte counting on the storage engine side

### 5. Capacity enforcement adapts to byte-level tracking

Capacity tracking shifts from per-record `encodedBytes` to the serialized
`BTreeJSON` size. The engine tracks total serialized size at commit boundaries
rather than maintaining incremental per-record byte counts.

## Work Items

### Phase 1: Core restructure — btree adapter and types

#### 1.1 Update `DatastoreConfig` types
- Add `duplicateKeys?: 'allow' | 'replace' | 'reject'` to config
- Update config validation to accept the new option
- Default to `'allow'` for backward compatibility with append-store model

#### 1.2 Rewrite `RecordKeyIndexBTree` adapter
- Remove `RecordKeyIndexEntryKey<TKey>` composite type
- Use plain `TKey` as btree key
- Pass `duplicateKeys` policy to btree config
- Enable `enableEntryIdLookup: true`
- Remove `createRangeStartKey`, `createRangeEndKey`, `MAX_INSERTION_ORDER_SENTINEL`
- Retain `normalizeComparatorResult` as a safety wrapper that validates user-provided comparator results (rejects `NaN`, `Infinity`, non-integer values)
- Expose `EntryId` from insert operations
- Expose `toJSON()` / `fromJSON()` through the adapter

#### 1.3 Simplify `PersistedRecord` type
- Remove `insertionOrder: bigint`
- Remove `encodedBytes: number`
- Remove `keySerialized: string` (btree stores the key natively)
- Remove `key: TKey` (redundant with btree entry key; see ADR-0051)
- Record becomes: `{ payload: RecordPayload, sizeBytes: number }`

#### 1.4 Replace `RecordId` with `EntryId`
- Replace `_id: RecordId` with `_id: EntryId` on public `KeyedRecord`
- Remove `createRecordId()` / `parseRecordId()`
- Remove `src/storage/record/recordId.ts`
- Update `getById`, `updateById`, `deleteById` to accept `EntryId`

#### 1.5 Remove `recordsByInsertionOrder` Map
- Remove from `Datastore` internal state
- Remove all Map/BTree sync guards — `IndexCorruptionError` checks in
  `datastoreStateOps.ts` and `mutationById.ts`
- `evictOldestRecordAndReturnBytes` → `tree.popFirst()`
- `seedRecordIndex` → `fromJSON()` (no manual seeding)

### Phase 2: Persistence simplification — backend drivers

#### 2.1 Define `BTreeJSON`-based persistence contract
- Backend drivers receive `tree.toJSON()` output as the persistence payload
- Backend drivers return the stored JSON for `fromJSON()` on init
- Define the interface between Datastore and backend controllers around
  `BTreeJSON`

#### 2.2 Update file backend driver
- Replace dual-generation file content with `BTreeJSON` serialization
- Sidecar metadata (`.meta.json`) may be simplified or absorbed into `BTreeJSON`
- Maintain atomic write semantics (generation rollover)

#### 2.3 Update browser backend drivers
- localStorage: Store `BTreeJSON` as chunked JSON (existing chunking applies)
- IndexedDB: Store `BTreeJSON` in object store
- OPFS: Store `BTreeJSON` via dual-file strategy
- SyncStorage: Store `BTreeJSON` via sync storage adapter

#### 2.4 Update capacity enforcement
- Replace per-record `encodedBytes` tracking with total serialized size
- Evaluate capacity at commit boundaries using `JSON.stringify(tree.toJSON()).length`
  or a lightweight size estimator
- `turnover` eviction: `tree.popFirst()` until under capacity
- `strict` policy: reject before insert if over capacity

### Phase 3: Leverage remaining btree capabilities

#### 3.1 Delegate bulk operations to btree
- `delete(key)` in `'allow'` mode → `tree.deleteRange(key, key, { lowerBound: 'inclusive', upperBound: 'inclusive' })`
- `deleteMany(keys[])` → batch `deleteRange` calls
- `count()` → `tree.size()`
- Range count → `tree.count(start, end)`

#### 3.2 Delegate iteration to btree
- `getAll()` → `tree.snapshot()` or `tree.values()`
- `keys()` → `tree.keys()` with deduplication
- `getRange(start, end)` → `tree.range(start, end)`

#### 3.3 Adapt mutation paths per policy
- `put()` in `'reject'` mode: surface btree's `BTreeValidationError` as
  storage engine error
- `put()` in `'replace'` mode: btree handles overwrite natively
- `updateById()`: use `tree.updateById(entryId, value)` directly
- `deleteById()`: use `tree.removeById(entryId)` directly

#### 3.4 Adapt concurrent btree adapter
- Update `ConcurrentRecordKeyIndexBTree` to match new plain-key design
- Pass `duplicateKeys` policy through concurrent config
- Or evaluate if the concurrent adapter is still needed given the simplified
  architecture

### Phase 4: Cleanup and documentation

#### 4.1 Remove dead code
- `src/storage/datastore/datastoreStateOps.ts` — fully replaced
- `src/storage/datastore/mutationById.ts` — replaced by direct btree ops
- `src/storage/record/recordId.ts` — `RecordId` format removed
- `src/storage/record/ordering.ts` — `toPublicRecord` simplified
- `src/storage/backend/encoding.ts` — `computeRecordEncodedBytes` removed

#### 4.2 Update specs
- `01_DatastoreAPI.md` — new `duplicateKeys` config, `EntryId` replaces `RecordId`
- `02_DurableBackends.md` — `BTreeJSON`-based persistence contract
- `03_InternalArchitecture.md` — single data structure, btree adapter boundary

#### 4.3 Update tests
- Remove all `RecordId` format tests (`record-id-canonical.test.mjs`, etc.)
- Remove `insertionOrder`-related tests
- Add `duplicateKeys` policy tests for all three modes
- Add `EntryId` ephemeral lifecycle tests (invalid after restart)
- Update backend integration tests for `BTreeJSON` persistence
- Update capacity tests for new byte tracking approach

#### 4.4 Update public type exports
- Remove `RecordId` from public types
- Export `EntryId` (re-export from `@frostpillar/frostpillar-btree`)
- Update `KeyedRecord` type (`_id: EntryId`)
- Add `DuplicateKeyPolicy` to public config types

## Consequences

Positive:

- **Single source of truth** eliminates an entire class of desync bugs
- **~40% less internal code** — dual data structure, sync guards, composite key
  machinery, custom serialization all removed
- **Configurable duplicate key policy** unlocks KV-store and unique-constraint
  use cases that were previously impossible
- **Persistence simplification** — `toJSON()`/`fromJSON()` replaces custom
  snapshot/seed/encode pipeline
- **Leverage btree investment** — storage engine focuses on storage management,
  not re-implementing tree operations

Trade-offs:

- **Breaking change** on `_id` — `RecordId` (persistent string) becomes
  `EntryId` (ephemeral number). Users must re-query after restart.
- **Breaking change** on `PersistedRecord` — `insertionOrder`, `encodedBytes`,
  `keySerialized` removed.
- **Capacity tracking granularity** — per-record byte tracking replaced with
  commit-boundary total size. Slightly less precise for mid-transaction checks.
- **Backward-incompatible persistence format** — existing stored data cannot
  be loaded without migration. Acceptable given no existing users.
