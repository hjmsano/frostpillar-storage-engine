# ADR-0051: Remove Key from PersistedRecord and Fix Size Estimation

Status: Proposed
Date: 2026-03-30

Relates to: 0050

## Context

The B+Tree stores entries as `[key, value]` pairs, where `value` is
`PersistedRecord`. The current `PersistedRecord` type includes a `key` field:

```typescript
interface PersistedRecord<TKey = unknown> {
  key: TKey;
  payload: RecordPayload;
  sizeBytes: number;
}
```

This creates two problems:

1. **Redundant key storage**: The key is stored twice -- once as the B+Tree
   entry key and once inside the `PersistedRecord` value. This wastes memory
   and increases serialized size.

2. **Inaccurate size estimation**: `estimateRecordSizeBytes` computes
   `JSON.stringify(key) + JSON.stringify(payload)`, which underestimates the
   actual entry size because it ignores JSON structural overhead (array
   brackets, object braces) of the B+Tree entry format.

## Design Decisions

### 1. Remove `key` from `PersistedRecord`

The `key` field and the `TKey` generic parameter are removed:

```typescript
interface PersistedRecord {
  payload: RecordPayload;
  sizeBytes: number;
}
```

Functions that previously read `record.key` now receive the key from the
B+Tree entry (`entry.key`) as a separate parameter.

### 2. Update `toPublicRecord` signature

`toPublicRecord` accepts `key` as a separate parameter sourced from the
B+Tree entry:

```typescript
toPublicRecord(entryId: EntryId, key: unknown, record: PersistedRecord): KeyedRecord<unknown>
```

### 3. Fix size estimation to include structural overhead

`estimateRecordSizeBytes` now estimates the full B+Tree entry contribution:

```typescript
estimateRecordSizeBytes(key, payload) = utf8ByteLength(
  JSON.stringify([key, { payload }]),
);
```

This accounts for:

- Array brackets and comma separating key from value
- Object braces and property name overhead for payload
- No longer needs to account for duplicated key

The `sizeBytes` field itself is excluded from the estimation to avoid
circularity. This produces a small consistent underestimate (~15-20 bytes
per entry) which is acceptable for capacity enforcement.

## Consequences

Positive:

- **Eliminates redundant key storage** in both memory and serialized form
- **More accurate capacity tracking** prevents exceeding limits before
  turnover/rejection triggers
- **Simpler `PersistedRecord` type** -- no generic parameter needed

Trade-offs:

- **Breaking change** on public `PersistedRecord` type (acceptable per
  ADR-0050: no existing users)
- **Size estimation values change** -- existing capacity thresholds in tests
  must be recalculated
