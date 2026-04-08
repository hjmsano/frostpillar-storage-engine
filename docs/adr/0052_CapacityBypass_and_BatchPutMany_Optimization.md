# ADR-0052: Capacity Bypass and Batch putMany Optimization

Status: Accepted
Date: 2026-04-02

## Context

After the P1–P3 hot-path optimizations (ADR series, Spec 05), profiling shows that the remaining overhead gap between raw `@frostpillar/frostpillar-btree` performance and `Datastore.put()`/`putMany()` is dominated by per-record capacity enforcement and size tracking. Specifically:

1. **In-memory datastores without capacity config** still compute `encodedBytes` (via `JSON.stringify(normalizedKey)` + `computeUtf8ByteLength`) and call `enforceCapacityPolicy()` — which immediately returns because `capacityState === null`. The size calculation and function call are pure waste.

2. **Durable backends without capacity config** need `encodedBytes` for auto-commit threshold tracking (`handleRecordAppended`), but still call the no-op `enforceCapacityPolicy()`.

3. **`putMany()` with capacity** calls `putSingle()` in a loop, performing per-record capacity enforcement. For `strict` policy, a single pre-check of remaining budget suffices.

## Decision

### D1: Capacity-bypass fast path in `putSingle()`

When `capacityState === null`:

- **Pure in-memory** (`backendController === null`): skip key-byte computation (`JSON.stringify(normalizedKey)` + `computeUtf8ByteLength`), skip `enforceCapacityPolicy()` call, skip `currentSizeBytes` accumulation. The `PersistedRecord.sizeBytes` field is set to `0` since it is only consumed by capacity enforcement and turnover eviction — neither of which apply.
- **Durable backend** (`backendController !== null`): compute `encodedBytes` for auto-commit tracking, but skip the `enforceCapacityPolicy()` call and `currentSizeBytes` tracking.

### D2: Batch capacity pre-check in `putMany()`

Introduce a dedicated `putManyBatch()` internal method that replaces the current sequential `putSingle()` loop:

**When `capacityState === null`**: loop records calling the fast-path `putSingle()`. No batch overhead.

**When `capacityState !== null` and policy is `strict`**:

1. Compute `remainingCapacity = capacityState.maxSizeBytes - currentSizeBytes` once.
2. For each record: validate, compute `encodedBytes`, compute `capacityDelta` (accounting for replace), accumulate `totalBatchDelta`.
3. If at any point `totalBatchDelta > remainingCapacity`: throw `QuotaExceededError` **without partial insertion** (all-or-nothing for strict batch).
4. After all records pass the budget check: insert all into B-tree in a second pass, update `currentSizeBytes` once at the end, signal backend once with total bytes.

**When `capacityState !== null` and policy is `turnover`**: fall back to per-record `putSingle()` because eviction order depends on insertion order and intermediate tree state.

### D3: All-or-nothing batch semantics for strict putMany

Current `putMany()` inserts records one by one. If record N fails capacity check, records 1..N-1 are already inserted. This is a silent partial-write.

With D2, `putMany()` under `strict` policy becomes atomic: either all records fit within remaining capacity, or none are inserted. This is a behavioral improvement, not a regression — users of `strict` policy expect deterministic quota enforcement.

For `turnover` and `allow` (no capacity) policies, per-record insertion is retained (turnover requires intermediate eviction state).

## Consequences

- In-memory write throughput approaches raw B-tree speed for the no-capacity case.
- `putMany()` with `strict` policy becomes all-or-nothing (behavioral change, but strictly better).
- `PersistedRecord.sizeBytes` may be `0` for in-memory-only datastores without capacity — this is safe because `sizeBytes` is only consumed by capacity enforcement and turnover eviction.
- Durable backends still track bytes for auto-commit thresholds.
- `turnover` policy `putMany()` is unchanged (per-record eviction required).
