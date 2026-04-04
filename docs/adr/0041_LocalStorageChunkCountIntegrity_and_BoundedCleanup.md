# 41. Enforce `localStorage` Chunk-Count Integrity and Bounded Cleanup

Date: 2026-03-13

## Status

Accepted

## Context

`localStorage` snapshot load previously reconstructed chunks by probing
`chunk:0`, `chunk:1`, ... until the first missing key.

Because the manifest did not include chunk count metadata, a partial prefix
could still deserialize as valid JSON and be accepted as a complete snapshot.
This created a silent truncation risk.

Chunk cleanup also used an unbounded probe loop (`until first missing key`).
In browser contexts this can be attacker-influenced via same-origin key
injection and can block the main thread with excessive synchronous operations.

## Decision

1. Add `chunkCount` to `localStorage` manifest metadata.
2. Require `manifest.chunkCount` to be a non-negative safe integer during load.
3. Require every chunk key in `0..chunkCount-1` to exist and be a string;
   otherwise fail initialization with `StorageEngineError`.
4. Track `activeChunkCount` in local backend state.
5. Bound cleanup loops by either known chunk count (`activeChunkCount`) or
   `maxChunks` when count is unknown.

## Consequences

- **Positive:** Prevents silent truncation by turning partial snapshot reads
  into explicit initialization failures.
- **Positive:** Aligns `localStorage` integrity signaling with existing
  `syncStorage` chunk-count validation behavior.
- **Positive:** Reduces browser UI-thread DoS exposure from unbounded
  `localStorage` cleanup loops.
- **Trade-off:** Corrupted manifests missing `chunkCount` now fail fast instead
  of attempting best-effort recovery.
