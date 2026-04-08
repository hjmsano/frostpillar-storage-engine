# ADR-0003: Auto-Commit Controller Reuse and Error Throw Contract

Status: Accepted  
Date: 2026-03-10

## Context

Review feedback highlighted two maintainability/robustness issues:

1. `FileBackendController` and `LocalStorageBackendController` duplicated auto-commit state-machine logic already implemented in `AsyncDurableAutoCommitController`.
2. Lint did not enforce throwing `Error` instances, which allowed non-Error values to escape foreground commit and deferred error paths.

The project principles require deterministic behavior, spec-driven/test-driven changes, and typed/clear failure modes.

## Decision

1. Reuse shared auto-commit orchestration

- `FileBackendController` extends `AsyncDurableAutoCommitController`.
- `LocalStorageBackendController` extends `AsyncDurableAutoCommitController`.
- Backend-specific logic remains in `executeSingleCommit()` and close hooks.

2. Enforce Error-only throwing

- Enable `@typescript-eslint/only-throw-error` as `error`.
- Normalize unknown caught values to `Error` before rethrowing in foreground/deferred paths.

3. Guard with tests and spec

- Add architecture-focused tests that assert controller inheritance and Error-instance rethrow behavior.
- Add/maintain spec text for controller architecture and throwing contract.

## Consequences

Positive:

- Removes duplicated commit loop logic and centralizes maintenance.
- Makes thrown values predictable for callers and debugging.
- Tightens static guarantees with lint + tests.

Trade-off:

- Additional indirection through base controller.
- Non-Error thrown values are wrapped, so exact original throw value is no longer propagated.

## References

- TypeScript-ESLint rule docs: `@typescript-eslint/only-throw-error`
- Internal spec: `docs/specs/03_InternalArchitecture.md`
