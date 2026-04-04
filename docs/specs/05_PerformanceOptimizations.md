# Spec: Performance Optimizations (P1/P2 Hot-Path)

Status: Implemented
Version: 1.0
Last Updated: 2026-03-31

## 1. Scope

This spec defines internal performance optimizations targeting hot-path allocation and redundant B-tree traversals.

In scope:

- B-tree lookup consolidation in `putSingle()` write path
- non-allocating UTF-8 byte length computation
- TextEncoder instance consolidation
- load-time re-stringify elimination
- config parser constant hoisting

Out of scope:

- public API changes (none; all optimizations are internal)
- backend format changes (none; on-disk/storage formats are unchanged)
- query-language or query-API changes (handled by `frostpillar-query-interface`)

## 2. Motivation

The storage engine targets "ephemeral, tiny, fast" workloads. Profiling reveals several unnecessary costs in the write and load paths:

1. **Redundant B-tree traversals**: `putSingle()` performs 2-3 separate tree lookups (`hasKey`, `hasKey`, `rangeQuery`) for duplicate key handling. Each traversal is O(log n). A single `findFirst()` call achieves the same result.
2. **Allocating UTF-8 measurement**: `TextEncoder.encode()` allocates a `Uint8Array` on every call. `estimateRecordSizeBytes()` is called on every `put()` and `updateById()`, making this a per-record allocation in the hot path.
3. **Load-time re-stringify**: File and IndexedDB backends re-serialize parsed JSON to measure byte size, producing a throwaway string and `Uint8Array`.

These are pure waste with no behavioral impact -- fixing them preserves identical semantics.

## 3. P1-A: Single B-tree Lookup in `putSingle()`

### 3.1 Current Behavior

`Datastore.putSingle()` (`src/storage/datastore/Datastore.ts`, lines 331-390) performs up to three separate B-tree traversals for a single insert:

1. `this.keyIndex.hasKey(normalizedKey)` -- checks existence for `'reject'` policy.
2. `this.keyIndex.hasKey(normalizedKey)` -- checks existence for `'replace'` policy.
3. `this.keyIndex.rangeQuery(normalizedKey, normalizedKey)` -- retrieves existing record to read `sizeBytes` for capacity delta calculation.

Each traversal walks the tree from root to leaf. For `'replace'` policy, all three execute.

### 3.2 Problem

Three O(log n) tree walks where one suffices. `rangeQuery` additionally allocates an array of results when only the first entry is needed.

### 3.3 Solution

The upstream `@frostpillar/frostpillar-btree` package exposes `findFirst(key): BTreeEntry | null` on `InMemoryBTree`. This method performs a single root-to-leaf traversal and returns the first matching entry (or `null` if the key does not exist).

**Step 1**: Add `findFirst(key)` to the `RecordKeyIndexBTree` adapter.

In `src/storage/btree/recordKeyIndexBTree.ts`, add:

```typescript
public findFirst(key: TKey): BTreeEntry<TKey, TValue> | null {
  return this.tree.findFirst(key);
}
```

**Step 2**: Replace the multi-lookup sequence in `putSingle()`.

Replace the current `hasKey` + `hasKey` + `rangeQuery` block with:

```typescript
let replacedBytes = 0;
if (this.duplicateKeyPolicy !== 'allow') {
  const existing = this.keyIndex.findFirst(normalizedKey);
  if (existing !== null && this.duplicateKeyPolicy === 'reject') {
    throw new ValidationError(
      'Duplicate key rejected: a record with this key already exists.',
    );
  }
  if (existing !== null && this.duplicateKeyPolicy === 'replace') {
    replacedBytes = existing.value.sizeBytes;
  }
}
```

The post-eviction `hasKey` check (line 382) also becomes `findFirst`:

```typescript
if (replacedBytes > 0 && this.keyIndex.findFirst(normalizedKey) === null) {
  replacedBytes = 0;
}
```

### 3.4 Affected Files

| File                                       | Change                                                  |
| ------------------------------------------ | ------------------------------------------------------- |
| `src/storage/btree/recordKeyIndexBTree.ts` | Add `findFirst()` method                                |
| `src/storage/datastore/Datastore.ts`       | Refactor `putSingle()` to use single `findFirst()` call |

## 4. P1-B: Non-Allocating UTF-8 Byte Length

### 4.1 Current Behavior

Two separate `utf8ByteLength` functions allocate a `Uint8Array` via `TextEncoder.encode()`:

- `src/storage/backend/encoding.ts` (line 5-7): used by `estimateRecordSizeBytes()`, called on every `put()` and `updateById()`.
- `src/validation/payload.ts` (line 21-23): used by payload validation for key byte length and string byte length checks, called on every `put()` and `updateById()`.

### 4.2 Problem

`TextEncoder.encode(value)` allocates a new `Uint8Array` on every call. For the `estimateRecordSizeBytes()` hot path, this produces a throwaway buffer whose only purpose is reading `.byteLength`. For payload validation, the same pattern repeats for every string key and string value in the payload.

### 4.3 Solution

Replace both `utf8ByteLength` implementations with arithmetic UTF-8 byte counting that performs zero allocations:

```typescript
const computeUtf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate of a surrogate pair → 4-byte UTF-8 sequence
      bytes += 4;
      i++; // Skip low surrogate
    } else {
      bytes += 3;
    }
  }
  return bytes;
};
```

For JSON strings (predominantly ASCII in typical storage-engine payloads), this loop is a tight integer-only scan with no memory allocation.

### 4.4 Affected Files

| File                              | Change                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `src/storage/backend/encoding.ts` | Replace `utf8ByteLength` with `computeUtf8ByteLength`; export for reuse by backends |
| `src/validation/payload.ts`       | Replace `utf8ByteLength` with `computeUtf8ByteLength`                               |

## 5. P1-C: Consolidate TextEncoder Instances

### 5.1 Current Behavior

Six separate `TextEncoder` instances exist across the codebase:

- `src/storage/backend/encoding.ts` (line 3)
- `src/validation/payload.ts` (line 13, exported as `UTF8_ENCODER`)
- `src/storage/drivers/IndexedDB/indexedDBBackend.ts` (line 15)
- `src/storage/drivers/localStorage/localStorageBackend.ts` (line 21)
- `src/storage/drivers/opfs/opfsBackend.ts` (line 14)
- `src/storage/drivers/syncStorage/syncStorageBackend.ts` (line 22)

### 5.2 Problem

Unnecessary object proliferation. After P1-B, two of these (`encoding.ts` and `payload.ts`) are no longer needed at all.

### 5.3 Solution

After P1-B is applied:

1. **`encoding.ts`**: Remove the `TextEncoder` instance entirely. The `computeUtf8ByteLength` function uses no encoder.
2. **`payload.ts`**: Remove the `TextEncoder` instance. Replace `UTF8_ENCODER.encode(value).byteLength` calls with `computeUtf8ByteLength(value)`.
3. **`UTF8_ENCODER` export migration**: `payload.ts` exports `UTF8_ENCODER`, which is imported by `src/storage/drivers/syncStorage/syncStorageQuota.ts`. Since `syncStorageQuota.ts` is not a hot path (called only during quota enforcement), it MUST create its own module-level `TextEncoder` instance rather than importing from `payload.ts`.
4. **Backend driver modules**: Each backend driver that still needs `TextEncoder` (for load-time UTF-8 measurement) keeps its own module-level instance. These are used at load/commit time only, not in the hot path.

### 5.4 Affected Files

| File                                                  | Change                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `src/storage/backend/encoding.ts`                     | Remove `TextEncoder` instance                                   |
| `src/validation/payload.ts`                           | Remove `UTF8_ENCODER` export; use `computeUtf8ByteLength`       |
| `src/storage/drivers/syncStorage/syncStorageQuota.ts` | Create own `TextEncoder` instead of importing from `payload.ts` |

## 6. P2-A: Eliminate Re-Stringify at Load Time

### 6.1 Current Behavior

**File backend** (`src/storage/drivers/file/fileBackendSnapshot.ts`, lines 186-187):
`loadFileSnapshot` calls `JSON.stringify(treeJSON)` to re-serialize the already-parsed tree, then `utf8Encoder.encode(treeJsonString).byteLength` to measure it. The raw file text was available in `loadAndValidateGenerationFile()` (line 164, `readFileSync` returns the string) but is discarded.

**IndexedDB backend** (`src/storage/drivers/IndexedDB/indexedDBBackend.ts`, line 148):
Same pattern: `utf8Encoder.encode(JSON.stringify(treeJSON)).byteLength`. However, IndexedDB stores objects natively -- there is no raw string available at load time.

### 6.2 Problem

Re-serializing a parsed JSON object produces a throwaway string (potentially large for big datasets) and then a throwaway `Uint8Array`. For the file backend, this is entirely avoidable because the raw source text exists.

### 6.3 Solution

**File backend**: Modify `loadAndValidateGenerationFile()` to capture the byte length of the raw `treeJSON` portion and return it alongside the parsed generation. Specifically:

1. `loadAndValidateGenerationFile()` already reads the file as a UTF-8 string (`generationSource`). Compute `computeUtf8ByteLength(generationSource)` for the whole file, then subtract the non-treeJSON envelope overhead. Alternatively, re-serialize `treeJSON` once inside `loadAndValidateGenerationFile` and return the byte length with the result.
2. The simpler approach: since `generationSource` is the full file content and `treeJSON` is one field within it, use `JSON.stringify(parsedGeneration.treeJSON)` inside `loadAndValidateGenerationFile` where it is already local, measure with `computeUtf8ByteLength`, and return `{ generation, treeJsonSizeBytes }`.
3. `loadFileSnapshot` then uses the returned `treeJsonSizeBytes` directly, eliminating its own re-stringify + encode.

**IndexedDB backend**: No raw string is available. Replace the allocating measurement:

```typescript
// Before
const currentSizeBytes = utf8Encoder.encode(
  JSON.stringify(treeJSON),
).byteLength;

// After
const currentSizeBytes = computeUtf8ByteLength(JSON.stringify(treeJSON));
```

This still re-stringifies (unavoidable for IndexedDB) but eliminates the `Uint8Array` allocation. Since this executes once at load time, it is acceptable.

### 6.4 Affected Files

| File                                                | Change                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/storage/drivers/file/fileBackendSnapshot.ts`   | Return `treeJsonSizeBytes` from `loadAndValidateGenerationFile()`; remove re-stringify in `loadFileSnapshot` |
| `src/storage/drivers/IndexedDB/indexedDBBackend.ts` | Use `computeUtf8ByteLength()` instead of `TextEncoder.encode().byteLength`                                   |

## 7. P4: Hoist Config Parser Constants

### 7.1 Current Behavior

`src/storage/config/config.shared.ts` creates regex objects and multiplier `Record<string, number>` maps inside function bodies:

- `normalizeByteSizeInput()` (line 56): `/^(\d+)(B|KB|MB|GB)$/` created per call.
- `normalizeByteSizeInput()` (lines 71-76): `multiplierByUnit` record created per call.
- `parseFrequencyString()` (line 104): `/^(\d+)(ms|s|m|h)$/` created per call.
- `parseFrequencyString()` (lines 118-123): `multiplierByUnit` record created per call.

### 7.2 Problem

These are pure constants recreated as new objects on every invocation. While these functions are only called at init time (not hot path), hoisting is free and keeps the code consistent with the project's style of module-level constants.

### 7.3 Solution

Hoist all four to module-level constants:

```typescript
const BYTE_SIZE_REGEX = /^(\d+)(B|KB|MB|GB)$/;
const BYTE_SIZE_MULTIPLIER: Readonly<Record<string, number>> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const FREQUENCY_REGEX = /^(\d+)(ms|s|m|h)$/;
const FREQUENCY_MULTIPLIER: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};
```

Reference these constants inside `normalizeByteSizeInput()` and `parseFrequencyString()`.

### 7.4 Affected Files

| File                                  | Change                                               |
| ------------------------------------- | ---------------------------------------------------- |
| `src/storage/config/config.shared.ts` | Hoist regex and multiplier constants to module level |

## 8. Invariants

All optimizations MUST preserve existing behavior exactly. The following invariants MUST hold after implementation:

1. **`estimateRecordSizeBytes()` output**: MUST return identical values to the current implementation (UTF-8 byte length of `JSON.stringify([key, { payload }])`). The non-allocating `computeUtf8ByteLength` MUST produce byte-identical results to `TextEncoder.encode().byteLength` for all valid UTF-8 strings.
2. **`putSingle()` semantics**: Behavior MUST be identical for all three duplicate key policies (`'allow'`, `'replace'`, `'reject'`). Error messages, error types, capacity accounting, and insertion order MUST not change.
3. **Payload validation limits**: Maximum key byte length, string byte length, nesting depth, and total byte limits MUST remain unchanged.
4. **Backend load `currentSizeBytes`**: MUST produce identical values to the current implementation for all backend types.
5. **All existing tests**: MUST continue to pass without modification (test changes are additive only).
6. **No public API changes**: No new exports, no removed exports, no signature changes on public types.
7. **No storage format changes**: On-disk, localStorage, IndexedDB, and OPFS formats are unchanged.

## 9. Test Plan

### 9.1 P1-A: `findFirst()` Adapter and `putSingle()` Refactor

New unit tests in B-tree adapter test file:

- `findFirst()` returns `BTreeEntry` when key exists (single entry).
- `findFirst()` returns `BTreeEntry` for first match when duplicate keys exist (`'allow'` policy).
- `findFirst()` returns `null` when key does not exist.
- `findFirst()` returns `null` on empty tree.

Existing `putSingle()` tests cover all three duplicate key policies. Verify they pass unchanged. No new `putSingle()` tests required (behavior is identical).

### 9.2 P1-B: Non-Allocating UTF-8 Byte Length

New unit tests for `computeUtf8ByteLength`:

- ASCII-only string returns correct byte count.
- 2-byte characters (e.g., `\u00e9`, Latin Extended) return correct byte count.
- 3-byte characters (e.g., CJK ideographs `\u4e16`) return correct byte count.
- 4-byte characters (surrogate pairs, e.g., emoji `\uD83D\uDE00`) return correct byte count.
- Mixed ASCII + multibyte string matches `TextEncoder.encode().byteLength`.
- Empty string returns 0.

Cross-validation test:

- For a representative set of strings, assert `computeUtf8ByteLength(s) === new TextEncoder().encode(s).byteLength`.

### 9.3 P1-C: TextEncoder Consolidation

No new tests. Verify existing tests pass after removing `UTF8_ENCODER` export from `payload.ts` and updating `syncStorageQuota.ts`.

### 9.4 P2-A: Load-Time Re-Stringify Elimination

Existing backend load tests cover `currentSizeBytes` correctness. Verify they pass unchanged. No new tests required (behavior is identical; only internal data flow changes).

### 9.5 P4: Config Parser Constant Hoisting

No new tests. Pure refactor of constant placement. Existing config parsing tests cover all branches.

### 9.6 Regression

Run full test suite (`pnpm test`) to confirm all existing tests pass. No test modifications expected.

## 10. P3-A: Inline Size Estimation into Validation

### 10.1 Current Behavior

`putSingle()` calls `validateAndNormalizePayload(payload)` which traverses the entire payload computing `totalValidationBytes`, then separately calls `estimateRecordSizeBytes()` which does `JSON.stringify([key, {payload}])` + `computeUtf8ByteLength()`. This is a full duplicate traversal.

### 10.2 Solution

`validateAndNormalizePayload` now returns `PayloadValidationResult { payload, sizeBytes }`. JSON structural overhead is accumulated during validation: object braces (2 bytes), key overhead (3 bytes: 2 quotes + colon), comma separators, string value quotes (2 bytes), and a root wrapper overhead (15 bytes for `[key,{"payload":...}]`).

Callers compute: `validationResult.sizeBytes + computeUtf8ByteLength(JSON.stringify(normalizedKey))`.

`estimateRecordSizeBytes` is retained for `backfillMissingSizeBytes` (persisted data loading).

### 10.3 Size Estimation Constants

| Primitive | Estimation Bytes                                              | JSON Actual          | Notes                                                        |
| --------- | ------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| string    | JSON-escaped UTF-8 + 2 (quotes) via `estimateJsonStringBytes` | exact                | Accounts for JSON escaping (`\"`, `\\`, `\n`, control chars) |
| number    | 8                                                             | 1–21                 | Conservative worst-case for typical numbers                  |
| boolean   | 5                                                             | 4–5 (`true`/`false`) | Worst-case (`false`)                                         |
| null      | 4                                                             | 4                    | Exact match                                                  |

### 10.4 Affected Files

| File                                    | Change                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/validation/payload.ts`             | Return `PayloadValidationResult`; use `estimateJsonStringBytes` for JSON-escape-aware size estimation |
| `src/storage/datastore/Datastore.ts`    | Use validation sizeBytes instead of `estimateRecordSizeBytes`                                         |
| `src/storage/datastore/mutationById.ts` | Same pattern for `updateRecordById`                                                                   |

## 11. P3-B: Lightweight Comparator Clamping in Hot Path

### 11.1 Solution

`buildWrappedComparator` now uses `clampComparatorResult` (simple -1/0/1 clamping) instead of `normalizeComparatorResult` (which includes `isFinite`/`isInteger` guards). `normalizeComparatorResult` remains exported and unchanged for Datastore API boundary validation (`getRange`, `getMany`, `keys`).

### 11.2 Behavioral Change

BTree operations no longer throw `IndexCorruptionError` for non-integer/non-finite comparator results. Invalid results are silently clamped. Datastore-level APIs still validate via `normalizeComparatorResult`.

## 12. P3-C: Remove `deepFreezePayload` from Hot Path

### 12.1 Solution

`validateAndNormalizePayload` no longer calls `deepFreezePayload`. Payloads are still defensively cloned but not frozen. `deepFreezePayload` remains exported.

### 12.2 Behavioral Change

`record.payload` is no longer frozen after `put()`/`get()`. Callers mutating returned payloads will not get `TypeError`. The storage engine is performance-first; immutability enforcement is not a correctness guarantee at this layer.

## 13. P5-A: Capacity-Bypass Fast Path in `putSingle()`

### 13.1 Current Behavior

`putSingle()` always computes `encodedBytes` (via `JSON.stringify(normalizedKey)` + `computeUtf8ByteLength`), calls `enforceCapacityPolicy()`, and tracks `currentSizeBytes` — even when `capacityState === null` (no capacity configured). The enforcement function returns immediately when `capacityState` is `null`, but the surrounding size computation is pure overhead.

### 13.2 Problem

For in-memory datastores without capacity config (the primary "ephemeral, tiny, fast" use case), every `put()` pays for:

1. `JSON.stringify(normalizedKey)` — allocates a string.
2. `computeUtf8ByteLength()` on the serialized key — a loop over the string.
3. `enforceCapacityPolicy()` function call — returns immediately but still called.
4. `currentSizeBytes += effectiveDelta` — arithmetic on a field never read.

### 13.3 Solution

Add a fast-path branch at the top of `putSingle()`:

**When `capacityState === null` AND `backendController === null`** (pure in-memory, no capacity):

- Skip key-byte computation entirely.
- Skip `enforceCapacityPolicy()` call.
- Skip `currentSizeBytes` accumulation.
- Set `PersistedRecord.sizeBytes` to `0` (this field is only consumed by capacity enforcement and turnover eviction — neither applies).
- Proceed directly to validation → B-tree insertion.

**When `capacityState === null` AND `backendController !== null`** (durable, no capacity):

- Compute `encodedBytes` (needed for `handleRecordAppended()` auto-commit threshold).
- Skip `enforceCapacityPolicy()` call.
- Skip `currentSizeBytes` tracking (never read without capacity).

**When `capacityState !== null`**: no change; full enforcement path as before.

### 13.4 Affected Files

| File                                 | Change                                |
| ------------------------------------ | ------------------------------------- |
| `src/storage/datastore/Datastore.ts` | Add fast-path branch in `putSingle()` |

## 14. P5-B: Batch Capacity Pre-Check in `putMany()`

### 14.1 Current Behavior

`putMany()` loops over records and calls `putSingle()` sequentially. Each record performs its own capacity enforcement. For `strict` policy, this means N separate budget checks for N records — and partial insertion if record K fails (records 1..K-1 are already committed to the B-tree).

### 14.2 Problem

1. Per-record `enforceCapacityPolicy()` calls in a batch are redundant when a single pre-check suffices (strict policy).
2. Partial insertion under strict policy is surprising — users expect deterministic quota behavior.
3. Individual `currentSizeBytes` updates per record are unnecessary when a single post-batch update achieves the same result.

### 14.3 Solution

Replace the `putSingle()` loop in `putMany()` with policy-aware batch logic:

**No capacity (`capacityState === null`)**: loop records calling fast-path `putSingle()` (P5-A). No batch overhead.

**Strict policy**:

1. Compute `remainingCapacity = capacityState.maxSizeBytes - currentSizeBytes` once.
2. **Prepare phase**: for each record, validate payload, compute `encodedBytes`, compute `capacityDelta` (accounting for replace), accumulate `totalBatchDelta`. If any single record exceeds `maxSizeBytes`, throw `QuotaExceededError`. If `totalBatchDelta > remainingCapacity`, throw `QuotaExceededError` — no partial insertion.
3. **Insert phase**: for each prepared record, insert into B-tree.
4. Update `currentSizeBytes += totalBatchDelta` once.
5. Signal backend controller once with total encoded bytes.

This makes strict-policy `putMany()` all-or-nothing: either all records fit, or none are inserted. This is a behavioral improvement — not a regression.

**Turnover policy**: fall back to per-record `putSingle()`. Eviction order depends on intermediate tree state; batch pre-check is not possible.

### 14.4 Behavioral Change

`putMany()` under `strict` policy changes from partial-insert-on-overflow to all-or-nothing. If the batch exceeds remaining capacity, `QuotaExceededError` is thrown and no records are inserted. Previously, records before the overflow point would have been silently committed.

### 14.5 Affected Files

| File                                 | Change                                             |
| ------------------------------------ | -------------------------------------------------- |
| `src/storage/datastore/Datastore.ts` | Refactor `putMany()` with policy-aware batch logic |

## 15. P5 Invariants

1. **Pure in-memory fast path**: when `capacityState === null` and `backendController === null`, `putSingle()` MUST NOT call `JSON.stringify(normalizedKey)` for size measurement, MUST NOT call `enforceCapacityPolicy()`, and MUST NOT accumulate `currentSizeBytes`.
2. **Durable no-capacity path**: when `capacityState === null` and `backendController !== null`, `putSingle()` MUST still compute `encodedBytes` and call `handleRecordAppended()`.
3. **Strict batch atomicity**: `putMany()` under `strict` policy MUST reject the entire batch if total delta exceeds remaining capacity. No partial insertion.
4. **Turnover fallback**: `putMany()` under `turnover` policy MUST fall back to per-record `putSingle()` to preserve eviction ordering.
5. **Existing semantics preserved**: single `put()`, `updateById()`, `deleteById()`, and all read operations MUST behave identically.
6. **`PersistedRecord.sizeBytes`**: MAY be `0` when capacity is not configured AND no durable backend is present. All consumers of `sizeBytes` (capacity enforcement, turnover eviction) are already guarded by `capacityState !== null`.

## 16. P5 Test Plan

### 16.1 P5-A: Capacity-Bypass Fast Path

- **In-memory, no capacity**: `put()` succeeds; `currentSizeBytes` remains `0` after insertions.
- **In-memory, no capacity**: `putMany()` succeeds for large batches; performance delta vs. raw B-tree is minimal.
- **Durable, no capacity**: `put()` succeeds; backend `handleRecordAppended()` is still called with correct `encodedBytes`.
- **With capacity**: existing behavior unchanged; all current capacity tests pass without modification.

### 16.2 P5-B: Batch putMany Strict Atomicity

- **Strict policy, batch fits**: `putMany()` inserts all records; `count()` reflects total.
- **Strict policy, batch overflows**: `putMany()` throws `QuotaExceededError`; `count()` is `0` (no partial insertion).
- **Strict policy, single oversized record in batch**: `putMany()` throws `QuotaExceededError`; `count()` is `0`.
- **Turnover policy, batch**: `putMany()` inserts records with eviction; existing turnover tests pass.
- **No capacity, batch**: `putMany()` inserts all records without capacity overhead.

### 16.3 Regression

Run full test suite (`pnpm test`) to confirm all existing tests pass unchanged.

## 17. P6: `skipPayloadValidation` — Trusted Input Mode

### 17.1 Current Behavior

Every `put()` and `updateById()` call invokes `validateAndNormalizePayload()`, which performs a recursive walk of the entire payload object: type checking, security guards (`__proto__`), resource limit enforcement, deep cloning, and byte size estimation. This is the single most expensive operation in the write path.

### 17.2 Problem

For trusted callers that construct known-good payloads (e.g., `frostpillar-db` which validates at the database layer, or application code inserting well-typed data), this per-record validation is redundant. Benchmark shows `validateAndNormalizePayload` accounts for the majority of the ~4x gap between raw B-tree and Datastore `put()`.

### 17.3 Solution

Add `skipPayloadValidation?: boolean` to `DatastoreConfig` (default `false`).

When `skipPayloadValidation` is `true`:

**`putSingle()` behavior:**

- Skip `validateAndNormalizePayload()` entirely.
- Store `record.payload` by reference (no deep clone).
- For **in-memory no-capacity** (P5-A): `sizeBytes = 0`. No size computation.
- For **capacity or durable backends**: compute `encodedBytes` via `estimateRecordSizeBytes(normalizedKey, payload)`.

**`prepareBatchRecord()` behavior (P5-B strict batch):**

- Same skip logic as `putSingle()`.

**`updateById()` behavior:**

- Skip `validateAndNormalizePayload()` on the merged payload.
- Store merged payload directly (no clone, no validation).
- Compute size via `estimateRecordSizeBytes()` when capacity is configured.

### 17.4 Invariants

1. **Default behavior unchanged**: when `skipPayloadValidation` is `false` (default) or omitted, all validation runs as before.
2. **Capacity enforcement still works**: `estimateRecordSizeBytes()` provides byte sizes for capacity tracking when validation is skipped.
3. **Durable backends still work**: `encodedBytes` is computed for `handleRecordAppended()` when a backend controller is present.
4. **`PersistedRecord.sizeBytes`**: MAY be `0` only when `capacityState === null && backendController === null` (pure in-memory, no capacity).
5. **No deep clone**: when `skipPayloadValidation` is `true`, the stored payload is a reference to the caller's object. Mutations to the original object after `put()` WILL affect stored data.

### 17.5 Affected Files

| File                                    | Change                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `src/types.ts`                          | Add `skipPayloadValidation?: boolean` to `DatastoreCommonConfig`              |
| `src/storage/datastore/Datastore.ts`    | Branch on `skipPayloadValidation` in `putSingle()` and `prepareBatchRecord()` |
| `src/storage/datastore/mutationById.ts` | Branch on `skipPayloadValidation` in `buildMergedPayload()`                   |

### 17.6 Test Plan

- **skipPayloadValidation=true, in-memory, no capacity**: `put()` succeeds, record retrievable, payload stored by reference.
- **skipPayloadValidation=true, with capacity**: `put()` succeeds, capacity enforcement works correctly.
- **skipPayloadValidation=true, putMany strict batch**: all-or-nothing behavior preserved.
- **skipPayloadValidation=true, updateById**: update succeeds, size tracking correct.
- **skipPayloadValidation=false (default)**: all existing validation tests pass unchanged.

## 18. P7: Synchronous Fast-Path for Read Operations

### 18.1 Current Behavior

`runWithOpen()` always returns a `Promise` and uses `await operation()`. Read operations (`get`, `getFirst`, `getLast`, `has`, `count`, `keys`, `getAll`, `getRange`, `getMany`, `getById`) are fundamentally synchronous when `pendingInit === null`.

### 18.2 Problem

Every read operation pays for:

1. A microtask tick from `await` — forces at least one event loop iteration even when the operation is synchronous.
2. `Promise` allocation + GC pressure from `Promise.resolve()`.

Under high-QPS read workloads (the primary use case for an in-memory storage engine), this is significant overhead per operation.

### 18.3 Solution

Add a synchronous fast-path in `runWithOpen()`:

```typescript
private runWithOpen<T>(operation: () => T): T;
private runWithOpen<T>(operation: () => Promise<T>): Promise<T>;
private runWithOpen<T>(operation: () => T | Promise<T>): T | Promise<T> {
  if (this.pendingInit !== null) {
    return this.pendingInit.then(() => {
      if (this.pendingInitError !== null) throw this.pendingInitError;
      this.lifecycle.beginOperation();
      try { return operation(); } finally { this.lifecycle.endOperation(); }
    });
  }
  if (this.pendingInitError !== null) {
    throw this.pendingInitError;
  }
  this.lifecycle.beginOperation();
  try { return operation(); } finally { this.lifecycle.endOperation(); }
}
```

Public read methods remain `async` in their signatures for API backward compatibility, but the internal fast-path avoids unnecessary microtask scheduling.

**Important**: `runWithOpenExclusive` (write path) keeps its async nature since mutex acquisition is inherently async.

### 18.4 Affected Files

| File                                 | Change                                            |
| ------------------------------------ | ------------------------------------------------- |
| `src/storage/datastore/Datastore.ts` | Refactor `runWithOpen()` to synchronous fast-path |

## 19. P8: Platform-Native UTF-8 Byte Length

### 19.1 Current Behavior

`computeUtf8ByteLength()` in `encoding.ts` is a hand-rolled JS loop with `charCodeAt()` + surrogate pair detection. Called on every `put()`/`update()`.

### 19.2 Problem

V8's `Buffer.byteLength(str, 'utf8')` is implemented in C++ and is 3-10x faster than JS-level byte counting for strings > 50 chars. The hand-rolled loop is a correct fallback but suboptimal for Node.js (the primary target).

### 19.3 Solution

Use platform-conditional implementation:

- **Node.js**: `Buffer.byteLength(value, 'utf8')` — single native call.
- **Browser fallback**: retain the existing hand-rolled loop.

```typescript
const hasBuffer =
  typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function';

export const computeUtf8ByteLength: (value: string) => number = hasBuffer
  ? (value: string): number => Buffer.byteLength(value, 'utf8')
  : (value: string): number => {
      /* existing hand-rolled loop */
    };
```

### 19.4 Invariants

- MUST produce byte-identical results to the current implementation for all valid UTF-8 strings.
- MUST produce byte-identical results for lone surrogates (both `Buffer.byteLength` and the hand-rolled loop count 3 bytes per lone surrogate, matching `TextEncoder`).
- MUST NOT break in browser environments where `Buffer` is not available.

### 19.5 Affected Files

| File                              | Change                                       |
| --------------------------------- | -------------------------------------------- |
| `src/storage/backend/encoding.ts` | Platform-conditional `computeUtf8ByteLength` |

## 20. P9: Structural Size Estimation (No JSON.stringify)

### 20.1 Current Behavior

`estimateRecordSizeBytes(key, payload)` calls `JSON.stringify([key, { payload }])` then `computeUtf8ByteLength()` on the result. The JSON string is immediately discarded — only its byte length is used.

This is called on every `put()` when `skipPayloadValidation=true`, and in `backfillMissingSizeBytes()` at load time.

### 20.2 Problem

`JSON.stringify` is the dominant cost in the `putSingle` hot path for trusted-input mode. For a payload with 10 keys, it allocates a temporary string of hundreds of bytes that is immediately measured and discarded.

### 20.3 Solution

Add `estimateObjectSizeBytes(value)` — a structural walker that accumulates JSON byte size without materializing the string:

```typescript
export const estimateObjectSizeBytes = (value: unknown): number => {
  if (value === null) return 4; // "null"
  if (typeof value === 'string') return computeUtf8ByteLength(value) + 2; // quotes
  if (typeof value === 'number') return numberByteLength(value);
  if (typeof value === 'boolean') return value ? 4 : 5; // "true"/"false"
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    let bytes = 2; // braces
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) bytes += 1; // comma
      bytes += computeUtf8ByteLength(entries[i][0]) + 3; // key: quotes + colon
      bytes += estimateObjectSizeBytes(entries[i][1]);
    }
    return bytes;
  }
  return 0;
};
```

For numbers, use actual stringified length rather than worst-case estimate:

```typescript
const numberByteLength = (value: number): number => {
  if (value === 0) return 1; // "0"
  if (Number.isInteger(value)) {
    // Floor(log10(abs(value))) + 1 + (sign ? 1 : 0)
    const abs = Math.abs(value);
    const digits = Math.floor(Math.log10(abs)) + 1;
    return value < 0 ? digits + 1 : digits;
  }
  // Fallback for floats: use String() which matches JSON.stringify for finite numbers
  return String(value).length;
};
```

Then replace `estimateRecordSizeBytes`:

```typescript
export const estimateRecordSizeBytes = (
  key: unknown,
  payload: RecordPayload,
): number => {
  // Structural equivalent of: computeUtf8ByteLength(JSON.stringify([key, { payload }]))
  // [key,{"payload":value}] = "[" + key + "," + '{"payload":' + value + "}" + "]"
  return (
    1 +
    estimateObjectSizeBytes(key) +
    1 +
    12 +
    estimateObjectSizeBytes(payload) +
    1 +
    1
  );
};
```

Wait — the current format is `JSON.stringify([key, { payload }])` where `{ payload }` means `{ payload: actualPayload }`. So the structure is: `[key,{"payload":{...}}]`.

Breaking down: `[` + key_json + `,` + `{"payload":` + payload_json + `}` + `]` = key + payload + 15 bytes overhead. This matches `JSON_ROOT_WRAPPER_OVERHEAD = 15` from `payload.ts`.

### 20.4 Affected Files

| File                              | Change                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `src/storage/backend/encoding.ts` | Add `estimateObjectSizeBytes`, `numberByteLength`; refactor `estimateRecordSizeBytes` |

## 21. P10: Unify resolvePayload Paths

### 21.1 Current Behavior

`resolvePayload()` in `Datastore.ts` has two paths:

- `skipPayloadValidation=true`: calls `estimateRecordSizeBytes(normalizedKey, payload)` (full JSON.stringify before P9).
- `skipPayloadValidation=false`: calls `validateAndNormalizePayload()` (returns `sizeBytes` via structural estimation) then adds `computeUtf8ByteLength(JSON.stringify(normalizedKey))` for the key portion.

### 21.2 Problem

The validation path still calls `JSON.stringify(normalizedKey)` for key byte measurement. For simple string keys (the default), this is `'"' + key + '"'` which can be computed as `computeUtf8ByteLength(key) + 2`.

### 21.3 Solution

Add `estimateKeySizeBytes(key)` for computing the JSON-serialized key's byte length without stringify:

```typescript
export const estimateKeySizeBytes = (key: unknown): number => {
  return estimateObjectSizeBytes(key);
};
```

Update `resolvePayload`:

- `skipPayloadValidation=true`: use `estimateObjectSizeBytes(payload) + estimateKeySizeBytes(key) + JSON_ROOT_WRAPPER_OVERHEAD` (from P9).
- `skipPayloadValidation=false`: use `validationResult.sizeBytes + estimateKeySizeBytes(normalizedKey)` (replaces `computeUtf8ByteLength(JSON.stringify(normalizedKey))`).

### 21.4 Affected Files

| File                                    | Change                                             |
| --------------------------------------- | -------------------------------------------------- |
| `src/storage/backend/encoding.ts`       | Export `estimateKeySizeBytes`                      |
| `src/storage/datastore/Datastore.ts`    | Use `estimateKeySizeBytes` in `resolvePayload`     |
| `src/storage/datastore/mutationById.ts` | Use `estimateKeySizeBytes` in `buildMergedPayload` |

## 22. P11: Reduce B-tree Lookup Redundancy in putSingle (Replace + Capacity)

### 22.1 Current Behavior

When `duplicateKeyPolicy === 'replace'` with capacity configured, `putSingle()` performs:

1. `computeReplacedBytes()` → `findFirst(normalizedKey)` — 1st B-tree traversal
2. After capacity enforcement → `findFirst(normalizedKey)` at line 417 — 2nd traversal (re-checks if eviction removed the existing record)
3. `keyIndex.put(normalizedKey, ...)` — 3rd traversal (insert/replace)

### 22.2 Problem

Three O(log n) traversals for a single put when one lookup + one insert suffices in most cases.

### 22.3 Solution

Cache the initial `findFirst` result and reuse it:

```typescript
const existingEntry =
  this.duplicateKeyPolicy === 'replace'
    ? this.keyIndex.findFirst(normalizedKey)
    : null;
let replacedBytes = existingEntry !== null ? existingEntry.value.sizeBytes : 0;
```

After capacity enforcement (which may evict entries), the post-eviction check only needs to verify the **specific entry** wasn't evicted. Since turnover eviction uses `popFirst()` (removes the oldest entry from the tree), the existing entry at `normalizedKey` can only be evicted if it was the first entry in sorted order. We can check this efficiently:

```typescript
if (replacedBytes > 0 && this.keyIndex.findFirst(normalizedKey) === null) {
  replacedBytes = 0;
}
```

This is already the current code. The improvement is to eliminate the separate `computeReplacedBytes()` method and inline the logic to avoid the redundant traversal when `duplicateKeyPolicy !== 'replace'`.

Actually, looking more carefully, the main savings is removing `computeReplacedBytes` as a method (which always calls `findFirst`) and instead only calling it when `duplicateKeyPolicy === 'replace'` AND capacity is configured — which is already guarded. The real optimization is that for the **reject** case with capacity, we already have the `findFirst` result from the early-reject check at line 368, but `computeReplacedBytes` at line 396 calls `findFirst` again (returning 0 since policy is 'reject'). We should skip `computeReplacedBytes` entirely when policy is not 'replace'.

### 22.4 Affected Files

| File                                 | Change                                                      |
| ------------------------------------ | ----------------------------------------------------------- |
| `src/storage/datastore/Datastore.ts` | Inline `computeReplacedBytes` logic, skip unnecessary calls |

## 23. P12: Synchronous Loop for In-Memory putMany/deleteMany

### 23.1 Current Behavior

`putMany()` with no capacity loops with `await this.putSingle(record)`. When there's no backend controller, `putSingle` is synchronous but still wrapped in a Promise chain. For 1000 records, that's 1000 unnecessary microtask yields.

`deleteMany()` has the same issue: `await this.deleteSingle(key)` per key.

### 23.2 Problem

For pure in-memory datastores (the primary "fast" use case), batch operations are artificially throttled by microtask scheduling.

### 23.3 Solution

Detect the pure in-memory case and run tight synchronous loops:

For `putMany`:

```typescript
if (this.capacityState === null && this.backendController === null) {
  for (const record of records) {
    this.putSingleSync(record); // synchronous fast path
  }
  return;
}
```

For `deleteMany`:

```typescript
if (this.backendController === null) {
  let totalRemoved = 0;
  for (const key of keys) {
    totalRemoved += this.deleteSingleSync(key);
  }
  return totalRemoved;
}
```

Extract synchronous versions of `putSingle` and `deleteSingle` that skip the `await backendController?.handleRecordAppended()` call (since there's no backend).

### 23.4 Affected Files

| File                                 | Change                                             |
| ------------------------------------ | -------------------------------------------------- |
| `src/storage/datastore/Datastore.ts` | Add sync loops for pure in-memory batch operations |

## 24. P13: O(1) Mutex Dequeue

### 24.1 Current Behavior

`AsyncMutex.queue` uses `Array.shift()` for FIFO dequeue. `Array.shift()` is O(n) because V8 must shift all remaining elements down by one index.

### 24.2 Problem

Under write-heavy workloads with contention, the mutex becomes a bottleneck as queue length grows.

### 24.3 Solution

Replace with an index-based approach:

```typescript
export class AsyncMutex {
  private queue: (() => void)[] = [];
  private head = 0;
  private locked = false;

  acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(this.createRelease());
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(this.createRelease()));
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.head < this.queue.length) {
        const next = this.queue[this.head];
        this.queue[this.head] = undefined!; // allow GC
        this.head += 1;
        // Compact when more than half the array is dead entries
        if (this.head > 1024 && this.head > this.queue.length >>> 1) {
          this.queue = this.queue.slice(this.head);
          this.head = 0;
        }
        next();
      } else {
        this.queue.length = 0;
        this.head = 0;
        this.locked = false;
      }
    };
  }
}
```

### 24.4 Affected Files

| File                                | Change                                             |
| ----------------------------------- | -------------------------------------------------- |
| `src/storage/backend/asyncMutex.ts` | Replace shift-based queue with index-based dequeue |

## 25. P14: Drop Comparator Validation in Public API Loops

### 25.1 Current Behavior

`normalizeComparatorResult()` calls `Number.isFinite()` + `Number.isInteger()` on every invocation. It's called from `getRange`, `getMany`, `keys` — these are public API methods where comparisons happen in loops.

The B-tree internally uses `clampComparatorResult()` (no validation) for its hot path.

### 25.2 Problem

The validation is defense-in-depth at the Datastore public API level. However, the comparator is provided at construction time and is trusted after that. Running validation on every comparison inside these methods is pure overhead.

### 25.3 Solution

Replace `normalizeComparatorResult` calls in `getRange`, `getMany`, and `keys` with the lightweight `clampComparatorResult`:

- `getRange` (line 166): replace `normalizeComparatorResult(this.keyDefinition.compare(...))` with `clampComparatorResult(this.keyDefinition.compare(...))`
- `getMany` (line 180, 185): same replacement
- `keys` (line 251): same replacement

Export `clampComparatorResult` from `recordKeyIndexBTree.ts` for use in `Datastore.ts`.

### 25.4 Invariants

- `normalizeComparatorResult` remains exported and unchanged for boundary validation.
- Internal comparisons within Datastore methods use the lightweight clamp.
- The comparator is still validated during B-tree construction (via `buildWrappedComparator`).

### 25.5 Affected Files

| File                                       | Change                                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| `src/storage/btree/recordKeyIndexBTree.ts` | Export `clampComparatorResult`                               |
| `src/storage/datastore/Datastore.ts`       | Use `clampComparatorResult` in `getRange`, `getMany`, `keys` |

## 26. P15: Skip JSON.stringify for String Keys in Batch Dedup

### 26.1 Current Behavior

`prepareBatchRecord()` (line 434) and `getMany()` (line 185) use `JSON.stringify(normalizedKey)` to create string keys for `Map` dedup and comparison.

### 26.2 Problem

For the default string key type, `JSON.stringify(key)` produces `'"key"'` — wrapping in quotes. This is unnecessary allocation when the key is already a string.

### 26.3 Solution

Add a key-to-string helper that bypasses stringify for strings:

```typescript
private keyToString(key: unknown): string {
  return typeof key === 'string' ? key : JSON.stringify(key);
}
```

Replace `JSON.stringify(normalizedKey)` calls in `prepareBatchRecord()` with `this.keyToString(normalizedKey)`.

### 26.4 Invariants

- String keys: dedup uses the string directly (no collision with non-string keys since the type is fixed per Datastore instance).
- Non-string keys: falls back to `JSON.stringify` (same as before).

### 26.5 Affected Files

| File                                 | Change                                             |
| ------------------------------------ | -------------------------------------------------- |
| `src/storage/datastore/Datastore.ts` | Add `keyToString()`, use in `prepareBatchRecord()` |

## 27. P7-P15 Invariants

All optimizations MUST preserve existing behavior exactly:

1. **All existing tests**: MUST pass without modification.
2. **No public API changes**: No new exports, no removed exports, no signature changes on public types.
3. **`estimateRecordSizeBytes`** output: MUST return identical values for all inputs. Structural estimation MUST match JSON.stringify-based measurement.
4. **`computeUtf8ByteLength`** output: MUST return byte-identical results when using native `Buffer.byteLength` vs the hand-rolled loop.
5. **Read operation semantics**: Results MUST be identical regardless of sync vs async execution path.
6. **Mutex fairness**: FIFO ordering MUST be preserved. All waiters MUST eventually be served.
7. **Batch operation semantics**: `putMany`/`deleteMany` results MUST be identical to sequential single operations.

## 28. P7-P15 Test Plan

### 28.1 P7: Sync Read Fast-Path

- Verify `get()`, `has()`, `count()`, `keys()`, `getAll()` return correct results on pure in-memory datastore.
- Verify these methods still work correctly when `pendingInit` is present (async backend).
- Verify `ClosedDatastoreError` is still thrown after `close()`.

### 28.2 P8: Native UTF-8 Byte Length

- Cross-validate: for representative strings, `computeUtf8ByteLength(s)` using native path matches `new TextEncoder().encode(s).byteLength`.
- Lone surrogate handling matches.

### 28.3 P9: Structural Size Estimation

- `estimateObjectSizeBytes` for primitives: string, number, boolean, null.
- `estimateObjectSizeBytes` for nested objects matches `computeUtf8ByteLength(JSON.stringify(obj))`.
- `estimateRecordSizeBytes` produces identical values before and after refactor.

### 28.4 P10: Unified resolvePayload

- `put()` with `skipPayloadValidation=true`: sizeBytes matches original computation.
- `put()` with `skipPayloadValidation=false`: sizeBytes matches original computation.
- `updateById()`: sizeBytes delta matches original.

### 28.5 P11: B-tree Lookup Reduction

- All duplicate-key policy behaviors preserved (existing tests cover this).

### 28.6 P12: Sync Batch Loop

- `putMany()` on pure in-memory datastore: all records inserted.
- `deleteMany()` on pure in-memory datastore: all records deleted, correct count returned.

### 28.7 P13: O(1) Mutex

- Acquire/release under no contention works.
- Multiple concurrent acquires are served in FIFO order.
- Queue compaction occurs when threshold is reached.

### 28.8 P14: Comparator Clamping

- `getRange` with valid range: correct results.
- `getMany` with duplicate keys: dedup works correctly.
- `keys()`: returns distinct keys in order.

### 28.9 P15: String Key Dedup

- `putMany` with string keys and `strict` policy: all-or-nothing behavior preserved.
- `putMany` with `reject` policy: intra-batch duplicates rejected.

### 28.10 Regression

Run full test suite (`pnpm test`).

## Revision History

| Version | Date       | Summary                                                                                                                                                                                             |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | 2026-03-30 | Initial specification.                                                                                                                                                                              |
| 1.0     | 2026-03-31 | Implemented. Added lone surrogate handling in `computeUtf8ByteLength`.                                                                                                                              |
| 1.1     | 2026-03-31 | Per-driver config split for ESM tree-shaking. Early reject in `putSingle()`. `getFirst()` uses `findFirst()`.                                                                                       |
| 2.0     | 2026-04-02 | P3-A: inline size estimation. P3-B: lightweight comparator clamping. P3-C: remove deepFreeze from hot path.                                                                                         |
| 3.0     | 2026-04-02 | P5-A: capacity-bypass fast path. P5-B: batch putMany with strict atomicity.                                                                                                                         |
| 4.0     | 2026-04-02 | P6: skipPayloadValidation trusted input mode.                                                                                                                                                       |
| 5.0     | 2026-04-02 | P7-P15: sync read fast-path, native UTF-8, structural size estimation, unified resolvePayload, B-tree lookup reduction, sync batch loops, O(1) mutex, comparator clamping in API, string key dedup. |
| 5.1     | 2026-04-02 | P3-A fix: payload string size estimation now uses `estimateJsonStringBytes` to account for JSON escaping overhead.                                                                                  |
