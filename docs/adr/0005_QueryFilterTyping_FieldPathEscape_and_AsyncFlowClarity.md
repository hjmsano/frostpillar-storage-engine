# ADR-0005: Query Filter Typing, Field-Path Escape Validation, and Async Flow Clarity

Status: Partially superseded — query filter typing and field-path escape validation moved to `frostpillar-query-engine`; async flow clarity decision remains active.
Date: 2026-03-10

## Context

Latest review feedback identified four remaining issues:

1. `NativeFilterExpression` allowed invalid operator/value/range combinations at type level.
2. Field-path parsing accepted a trailing unescaped backslash, which is ambiguous.
3. `Datastore` async orchestration used redundant `Promise.resolve().then(async ...)` wrappers.
4. `AsyncDurableAutoCommitController` used the same wrapper pattern in close/commit-loop paths.

The project principles require deterministic behavior, typed contracts, and maintainable control flow.

## Decision

1. Make native filter typing operator-discriminated (**superseded** — see note below)

- Encode operator-specific required properties in `NativeFilterExpression`.
- Keep recursive logical nodes (`and` / `or` / `not`) unchanged.

2. Reject trailing unescaped backslash in field paths (**superseded** — see note below)

- Treat trailing `\` in query field paths as invalid.
- Fail with `ValidationError` to make malformed path input explicit.

3. Simplify async orchestration paths (**active**)

- Replace redundant wrapper chains with direct `async` function flow in:
  - `Datastore.close`
  - `Datastore.runWithOpen`
  - `AsyncDurableAutoCommitController.close`
  - `AsyncDurableAutoCommitController` commit-loop execution path

4. Guard by spec and tests (**active**)

- Update datastore and backend architecture specs.
- Add tests for architecture constraints.

## Consequences

Positive:

- Stronger compile-time guarantees for query filter construction.
- Clearer runtime behavior for malformed escaped field paths.
- More readable async orchestration with no behavior change in commit semantics.

Trade-off:

- Slightly stricter runtime validation may fail previously accepted malformed queries.
- Type signatures become more verbose.

## Supersession Note

Query filter typing (decision 1) and field-path escape validation (decision 2) were removed
from this repository and their responsibility transferred to `frostpillar-query-engine`.
The async orchestration simplification (decisions 3 and 4) remains active and is reflected
in `src/storage/datastore/Datastore.ts` and `src/storage/backend/asyncDurableAutoCommitController.ts`.

## References

- TypeScript Handbook: Discriminated Unions
  https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
- MDN: `async function`
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function
