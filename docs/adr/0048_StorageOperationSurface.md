# ADR-0046: Storage Operation Surface

Status: Proposed
Date: 2026-03-20

## Context

The current `Datastore` public API exposes a minimal set of operations oriented
around database conventions (`insert`, `select`). As a **storage engine**, the
naming and operation set should align with storage/KV-store conventions
(`get`, `put`, `delete`, `has`, `clear`, ...).

Additionally, several frequently needed operations are missing entirely. Users
must work around limitations such as:

- No direct key-based lookup (`get`). Must abuse `select({ start: k, end: k })`.
- No key-based delete. Must first query to obtain an internal `_id`.
- No way to retrieve all records, count records, or list keys.
- No batch operations for bulk workloads.

This ADR defines the full operation surface for the storage engine.

## Design Decisions

### Append-oriented storage model

The engine follows an **append store** model, not a traditional KV store model.
Multiple records with the same user-provided key are allowed and managed
separately via an internal `_id`.

This is intentional and supports use cases like logs, events, and time-series
data where duplicate keys are natural (e.g., multiple log entries at the same
timestamp).

A KV-style upsert operation (`set`) was considered but **deferred**. Mixing
append semantics (`put`) and replace semantics (`set`) in the same core API
creates ambiguity about what `get(key)` returns and what `delete(key)` affects.
If upsert is needed in the future, it can be added as `delete(key)` + `put(record)`
sugar once usage patterns are clearer.

### Two access paths: key and ID

The API provides two complementary ways to access records:

- **By key** (user-provided): Broad operations that target **all** records
  sharing a key. Used for lookup, bulk delete, existence checks.
- **By ID** (system-generated `_id`): Precise operations that target **exactly
  one** record. Used when the user needs to update or delete a specific record
  among duplicates.

The typical flow is: `get(key)` to find records, inspect the results, then
`updateById(id, ...)` or `deleteById(id)` to act on a specific one.

### `_id` is visible and read-only

The internal `_id` field is exposed as a **read-only** property on all records
returned by record-returning APIs (`get`, `getFirst`, `getById`, `getAll`,
`getRange`, `getMany`).

Canonical `_id` format:

- `k~${encodeURIComponent(serializedKey)}:${insertionOrder}`

Notes:

- this keeps delimiter parsing unambiguous even when serialized keys include
  reserved characters such as `:`
- parser may continue accepting legacy numeric key segment IDs for backward
  compatibility, but canonical writer output MUST use encoded form

This visibility is required to support single-record operations when keys are
non-unique (append model): callers discover records by key, then target one
record via `_id`.

### Naming conventions

Storage/KV-store naming is used instead of database naming:

| Current (database-style) | New (storage-style) | Reason |
|---|---|---|
| `insert(record)` | `put(record)` | `put` is standard in LevelDB, IndexedDB, lmdb-js |
| `select(query)` | `getRange(start, end)` | Descriptive; `select` implies SQL |

## Operation Surface

### Key-based Operations

Primary interface. These operate on **all records** matching the given key.

| Method | Status | Description |
|--------|--------|-------------|
| `get(key)` | **New** | Retrieve all records with the given key. Always returns `Record[]` (empty array if no match). |
| `getFirst(key)` | **New** | Convenience method. Returns the first matching record, or `null` if not found. Equivalent to `get(key)[0] ?? null`. |
| `put(record)` | **Rename** (was `insert`) | Append a record. Multiple records with the same key are allowed. A new entry is always created regardless of whether the key already exists. |
| `delete(key)` | **New** | Delete **all** records matching the given key. Returns the number of records removed. This is intentionally destructive in append model; use `deleteById` for single-record delete. |
| `has(key)` | **New** | Check whether at least one record with the given key exists. Returns `boolean`. Lightweight — does not load payloads. |

### ID-based Operations

Precise operations that target **exactly one** record by its read-only `_id`.
Useful when multiple records share the same key and the user needs to act on a
specific one.

| Method | Status | Description |
|--------|--------|-------------|
| `getById(id)` | **Existing** | Retrieve a single record by `_id`. |
| `updateById(id, patch)` | **Existing** | Shallow-merge a patch into the record's payload, identified by `_id`. |
| `deleteById(id)` | **Existing** | Remove a single record by `_id`. |

### Bulk Operations

Operations over multiple records or ranges.

| Method | Status | Description |
|--------|--------|-------------|
| `getAll()` | **New** | Return all records in the datastore. Intended for small-to-medium datasets (settings, caches, config). |
| `getRange(start, end)` | **Rename** (was `select`) | Return all records where `start <= key <= end` (inclusive). Unchanged semantics from current `select`. |
| `getMany(keys[])` | **New** | Retrieve records for a discrete set of keys. Unlike `getRange`, the keys do not need to be contiguous. Returns `Record[]` (flattened results across all keys). |
| `putMany(records[])` | **New** | Batch append. Each record follows `put` semantics (always appends, allows duplicate keys). |
| `deleteMany(keys[])` | **New** | Batch delete by keys. Each key follows `delete` semantics (removes all records with that key). |
| `clear()` | **New** | Remove all records from the datastore. |

### Metadata Operations

Lightweight introspection without loading full payloads.

| Method | Status | Description |
|--------|--------|-------------|
| `count()` | **New** | Return the total number of records in the datastore. |
| `keys()` | **New** | Return all distinct keys, without payloads. Useful for enumeration, debugging, and UI rendering. |

### Lifecycle & System

| Method | Status | Description |
|--------|--------|-------------|
| `commit()` | **Existing** | Flush pending in-memory writes to the durable backend immediately. |
| `close()` | **Existing** | Release resources and shut down the datastore. For durable backends, `commit()` remains the explicit persistence boundary. |
| `on(event, listener)` | **Existing** | Subscribe to datastore events (currently `'error'` only). |
| `off(event, listener)` | **Existing** | Unsubscribe from datastore events. |

## Determinism & Batch Semantics

To keep behavior deterministic across backends:

- `get`, `getAll`, `getRange`, `getMany` record order MUST be:
  `key` ascending, then insertion order ascending for key ties
- `keys()` MUST return distinct keys in datastore comparator ascending order
- `putMany(records[])` and `deleteMany(keys[])` execute left-to-right by input
  order
- `putMany(records[])` and `deleteMany(keys[])` are non-atomic by default:
  if an element fails, previously applied elements remain applied

## Usage Example

```ts
// Append multiple records with the same key
await store.put({ key: "2026-03-20T10:00:00Z", payload: { msg: "request started" } });
await store.put({ key: "2026-03-20T10:00:00Z", payload: { msg: "request ended" } });

// Get all records by key → always an array
const logs = await store.get("2026-03-20T10:00:00Z");
// → [
//   { _id: "k~...:0", key: "...", payload: { msg: "request started" } },
//   { _id: "k~...:1", key: "...", payload: { msg: "request ended" } },
// ]

// Update one specific record using its _id
await store.updateById(logs[1]._id, { msg: "request ended (200 OK)" });

// Delete one specific record by _id
await store.deleteById(logs[0]._id);

// Delete ALL records with this key
await store.delete("2026-03-20T10:00:00Z");

// Convenience: get first match only
const latest = await store.getFirst("config:theme");

// Check existence without loading data
if (await store.has("session:abc123")) { /* ... */ }

// Introspection
const total = await store.count();
const allKeys = await store.keys();
```

## Consequences

Positive:

- The API aligns with storage/KV-store conventions that users already know.
- Two clear access paths (key-based broad, ID-based precise) cover all use cases
  without ambiguity.
- Exposing `_id` as read-only enables precise record targeting when keys are
  duplicated — the natural flow is `get(key)` then `updateById`/`deleteById`.
- Deferring `set` (upsert) avoids mixing two competing data models in the core
  API. It can be added later as sugar if demand emerges.

Trade-offs:

- Renaming `insert` to `put` and `select` to `getRange` is a breaking change.
  Migration can be eased with deprecation aliases in one release cycle.
- Including read-only `_id` in record-returning APIs is a type/shape change for
  callers that currently rely on `{ key, payload }` only. Migration can be
  eased by preserving backward-compatible field access and documenting the
  additive shape change.
- `get(key)` always returns an array, which adds a small ergonomic cost for
  single-record use cases. `getFirst(key)` mitigates this.
- `count()` and `keys()` must remain O(n) or be backed by a maintained index;
  the implementation should choose the simplest approach that meets performance
  goals for the expected dataset sizes.

## Deferred

- **`set(record)` / `setMany(records[])`**: Upsert/replace semantics (one record
  per key). Deferred until usage patterns clarify whether this belongs in the
  core API or as a convenience layer. Workaround: `delete(key)` + `put(record)`.
