# ADR-0053: skipPayloadValidation — Trusted Input Mode

Status: Accepted
Date: 2026-04-02

## Context

After P5 optimizations (ADR-0052), the dominant remaining cost in the `put()` hot path is `validateAndNormalizePayload()`. This function performs:

1. **Type restriction**: rejects arrays, bigint, NaN/Infinity, class instances, functions, undefined.
2. **Security guards**: blocks `__proto__`, `constructor`, `prototype` keys.
3. **Resource limit guards**: max depth (64), max key bytes (1KB), max string bytes (64KB), max keys per object (256), max total keys (4096), max total bytes (1MB), circular reference detection.
4. **Deep clone + size estimation**: defensive copy + byte size accumulation.

For trusted callers — such as `frostpillar-db` (which validates input at the database layer) or application code that constructs known-good payloads — this per-record overhead is redundant. Benchmark shows a ~4x gap between raw B-tree `put()` and Datastore `put()`, dominated by validation.

## Decision

Add `skipPayloadValidation?: boolean` to `DatastoreConfig` (default `false`).

When `true`:

1. **No validation**: type checks, security guards, and resource limits are all skipped.
2. **No deep clone**: payload is stored by reference. Caller must not mutate the object after `put()`.
3. **Size estimation**: when capacity or durable backend requires `encodedBytes`, `estimateRecordSizeBytes()` is used as a fallback (JSON.stringify-based). When neither is needed (pure in-memory, no capacity — P5-A), `sizeBytes` is `0`.
4. **`updateById`**: merged payload also skips validation when the flag is set. Size is computed via `estimateRecordSizeBytes()` when needed.

The caller accepts responsibility for:
- Providing JSON-serializable plain objects only.
- Avoiding `__proto__` / `constructor` / `prototype` keys.
- Not mutating the payload object after insertion.
- Keeping payloads within reasonable size bounds.

## Consequences

- In-memory no-capacity write throughput approaches raw B-tree speed.
- Payload type safety is the caller's responsibility when enabled.
- No deep clone means shared references — mutations to the original object after `put()` will affect stored data.
- Durable backends still work (size is computed for commit threshold tracking).
- Capacity enforcement still works (size is computed for quota checks).
