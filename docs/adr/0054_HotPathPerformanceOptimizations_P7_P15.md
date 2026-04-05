# ADR-0054: Hot-Path Performance Optimizations P7-P15

Status: Accepted
Date: 2026-04-02

## Context

Profiling the storage engine revealed several hot-path inefficiencies in read/write operations. The engine targets "ephemeral, tiny, fast" workloads where per-operation overhead is visible at scale. Building on the P1-P6 optimizations (ADR-0052, ADR-0053), this round addresses nine additional performance bottlenecks.

## Decision

### P7: Synchronous fast-path for read operations

`runWithOpen()` was refactored from `async` to a non-async method with a synchronous fast-path. When `pendingInit === null` (the common case for in-memory datastores), read operations execute without `await` overhead — no microtask scheduling, no unnecessary Promise chain. An `executeWithLifecycle()` helper handles both sync and async operation results, correctly calling `endOperation()` in all four paths (sync success, sync throw, async resolve, async reject).

### P8: Platform-native UTF-8 byte length

`computeUtf8ByteLength()` now dispatches to `Buffer.byteLength(value, 'utf8')` on Node.js (C++ implementation, 3-10x faster for strings > 50 chars). The hand-rolled JS loop is preserved as a fallback for browser environments. Both paths produce byte-identical results for all valid UTF-8 strings and lone surrogates.

### P9: Structural size estimation (no JSON.stringify)

`estimateRecordSizeBytes()` no longer calls `JSON.stringify()`. A new `estimateObjectSizeBytes()` walks the object tree structurally, accumulating JSON byte sizes including escape sequences, quotes, colons, commas, and braces. The `estimateJsonStringBytes()` helper correctly handles all JSON escape sequences (control characters, backslash, double quote, surrogates). Output is verified identical to the old `JSON.stringify` + `computeUtf8ByteLength` approach.

### P10: Unified key size estimation

Added `estimateKeySizeBytes()` which delegates to `estimateObjectSizeBytes()`. Replaced `computeUtf8ByteLength(JSON.stringify(normalizedKey))` in `resolvePayload()` and `validateAndEstimateSize()` — eliminating a `JSON.stringify` allocation per write/update.

### P11: Inline computeReplacedBytes

The `computeReplacedBytes()` private method was inlined directly into `putSingle()`, eliminating one function call per write in the capacity-enforcement path.

### P12: Synchronous loops for in-memory putMany/deleteMany

When `capacityState === null && backendController === null` (pure in-memory, no capacity), `putMany()` uses a tight synchronous loop that directly validates, normalizes, and inserts records without per-record `await` overhead. Similarly, `deleteMany()` uses a synchronous loop when `backendController === null`.

### P13: O(1) mutex dequeue

`AsyncMutex` was refactored from `Array.shift()` (O(n)) to index-based dequeue (O(1)). A `head` pointer tracks the next item to dequeue. Dead entries are nulled for GC. Compaction occurs when `head > 1024` and more than half the array is dead entries.

### P14: Lightweight comparator clamping in hot-path loops

`clampComparatorResult()` (no validation, simple -1/0/1 clamping) is now exported and used in `getMany()` sort/dedup and `keys()` dedup loops. `normalizeComparatorResult()` (with `isFinite`/`isInteger` validation) is retained for `getRange()` boundary check (single call, worth keeping for defense at API boundary).

### P15: Skip JSON.stringify for string keys in batch dedup

`prepareBatchRecord()` uses a type-prefixed string key (`'s' + key`) for string keys instead of `JSON.stringify(key)`, avoiding the stringify allocation. Non-string keys fall back to `JSON.stringify`. The `'s'` prefix prevents collision with JSON-stringified non-string keys.

## Behavioral Changes

1. **P14**: `keys()` and `getMany()` no longer throw `IndexCorruptionError` when the user comparator returns NaN, Infinity, or non-integer values. These are silently clamped. `getRange()` still validates (throws `IndexCorruptionError`). The B-tree itself already used `clampComparatorResult` (without validation) in `buildWrappedComparator` before this change.

2. All other optimizations are purely internal with no behavioral changes.

## Consequences

- Read operations on in-memory datastores avoid unnecessary async/Promise overhead.
- Write operations avoid `JSON.stringify` in the hot path (both for size estimation and key serialization).
- Batch operations on in-memory datastores avoid per-record microtask scheduling.
- Mutex dequeue is O(1) instead of O(n) under write contention.
- All 431 tests pass. Three existing tests were updated to reflect the P14 behavioral change.
