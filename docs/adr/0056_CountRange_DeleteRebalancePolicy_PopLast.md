# ADR-0056: CountRange API, DeleteRebalancePolicy Config, and PopLast Adapter Method

Status: Accepted
Date: 2026-04-09

## Context

frostpillar-btree 0.2.7 exposes new capabilities that the storage engine can leverage:

1. `tree.count(start, end)` — O(log n) range counting without materializing entries.
2. `deleteRebalancePolicy: 'lazy'` — skips post-delete rebalancing for better bulk-delete throughput.
3. `tree.popLast()` — removes and returns the largest-key entry (reverse of `popFirst()`).

These were identified as WI-2, WI-3, and WI-5 in the btree 0.2.7 capability review.

## Decision

### WI-2: `countRange(start, end)`

- Add `count(start, end): number` to `RecordKeyIndexBTree` — thin delegation to `tree.count()`.
- Add `countRange(start, end): Promise<number>` to `Datastore` as a public read operation.
- `countRange` normalizes both keys, validates `start <= end` (same as `getRange`), and returns the count without materializing records.
- This is a read operation — no exclusive lock required.

### WI-3: `deleteRebalancePolicy`

- Add `deleteRebalancePolicy?: 'standard' | 'lazy'` to `IndexConfig` in `types.ts`.
- Add `DeleteRebalancePolicy` type alias exported from `types.ts` and package root.
- Parse and validate in `parseIndexConfig()` — default `'standard'`, throw `ConfigurationError` for invalid values.
- Forward through `RecordKeyIndexBTreeConfig`, constructor, and `fromJSON()` restoration path.
- The Datastore constructor already spreads `...this.indexConfig`, so no constructor changes were needed.

### WI-5: `popLast()`

- Add `popLast(): BTreeEntry | null` to `RecordKeyIndexBTree` — thin delegation to `tree.popLast()`.
- No Datastore-level exposure yet — available at the adapter level for future capacity policy enhancements (e.g., LIFO eviction).

## Consequences

- `countRange` enables efficient "how many records match?" queries for capacity planning and query optimization without the allocation cost of `getRange`.
- `deleteRebalancePolicy: 'lazy'` gives users an opt-in performance knob for write-heavy workloads with frequent deletions (e.g., turnover eviction, batch cleanup).
- `popLast` is available for future reverse-eviction strategies without requiring another btree wrapper update.
- No breaking changes — all additions are optional with backwards-compatible defaults.
