# ADR-0014: Close Single-Flight and File Test Hook Isolation

Status: Accepted  
Date: 2026-03-10

## Context

Two reliability gaps were identified:

1. `Datastore.close()` set `closed = true` only after awaited steps, so
   concurrent `close()` calls could run overlapping close bodies.
2. File backend test hooks were injected through a type cast on
   `FileDatastoreConfig` via `config.__testHooks`, creating a non-type-safe
   config back-door.

## Decision

- Make `Datastore.close()` single-flight:
  - first caller starts the close sequence
  - concurrent callers await the same in-flight close sequence
  - backend controller `close()` executes at most once per datastore instance
- Introduce a closing guard at close-start time so operations that begin after
  close has started fail with `ClosedDatastoreError`.
- Track active operations and drain them before state clearing to avoid races
  between close and in-flight data operations.
- Remove config-cast test-hook injection.
  - `FileBackendController.create()` now accepts explicit optional
    `testHooks` in create options.
  - `config.__testHooks` is rejected with `ConfigurationError`.

## Consequences

Positive:

- Close behavior is deterministic under concurrency.
- New operations cannot mutate datastore state once close starts.
- File backend test hooks are explicit and type-safe.

Trade-off:

- Tests that used `config.__testHooks` must move to explicit `testHooks`
  option wiring.

## References

- `src/storage/datastore/Datastore.ts`
- `src/storage/drivers/file/fileBackendController.ts`
- `tests/storage/datastore-close-error-aggregation.test.mjs`
- `tests/storage/backend-controller-architecture.test.mjs`
- `docs/specs/01_DatastoreAPI.md`
- `docs/specs/03_InternalArchitecture.md`
