# ADR-0026: Recovery-Time Key Codec Corruption Guard

Status: Accepted  
Date: 2026-03-11

## Context

Datastore supports custom key codecs via `config.key.serialize` and
`config.key.deserialize`.

During durable backend recovery, persisted records are hydrated from
`keySerialized`.
Without explicit recovery-time guards:
- a throwing `deserialize` can propagate ambiguous errors during initialization
- a non-canonical codec pair can return a key that re-serializes to a different
  value, silently drifting from persisted identity

Both cases can trigger reopen instability and corruption-like behavior for
custom key codecs.

## Decision

Enforce strict key codec validation during backend initialization hydration.

Key points:
- if `deserialize(keySerialized)` throws, initialization fails with
  `IndexCorruptionError`
- datastore validates `serialize(deserialize(keySerialized)) === keySerialized`
  for each restored record
- round-trip mismatch fails initialization with `IndexCorruptionError`
- serializer/deserializer non-`Error` throws are normalized to deterministic
  corruption errors

## Consequences

Positive:
- prevents silent key identity drift on reopen
- converts recovery-time codec faults into deterministic, typed failures
- reduces denial-of-service risk from repeated crash/reopen loops caused by
  malformed persisted keys

Trade-offs:
- custom codecs must satisfy stricter round-trip stability on persisted keys
- previously tolerated but ambiguous recovery behavior now fails fast

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
- Usage:
  - `README.md`
  - `README-JA.md`
- Implementation:
  - `src/storage/datastore/Datastore.ts`
- Tests:
  - `tests/storage/datastore-core-baseline.test.mjs`
