# 36. Auto-Commit Driver Guard and Config Default Consolidation

Date: 2026-03-12

## Status

Accepted

## Context

After dependency-injected drivers were introduced, `Datastore` accepted
`autoCommit` even when no durable `driver` was configured and silently ignored it.
This masked configuration mistakes in memory-only mode.

The same change set also revealed cleanup opportunities:

- `BrowserStorageType` remained in `src/types.ts` but had no internal consumers.
- backend-limit resolution in driver modules duplicated default literals already
  defined by shared config parsing.
- internal code still imported `parseCapacityConfig` through `config.ts`, a barrel
  re-export of `config.shared.ts`, adding avoidable indirection.

## Decision

1. Datastore construction now rejects `autoCommit` without `driver` by throwing
   `ConfigurationError`.
2. Dead internal type `BrowserStorageType` is removed from `src/types.ts`.
3. Backend-limit resolution defaults are centralized as shared config constants
   and reused by both config parsing and driver resolver paths.
4. Internal imports use `config.shared.ts` directly for shared parsing functions;
   `config.ts` remains only as a compatibility shim.
5. Promise detection for driver initialization uses a thenable-safe check instead
   of `instanceof Promise` to support cross-realm or custom thenables.

## Consequences

- **Positive:** Misconfigured `autoCommit` fails fast and deterministically.
- **Positive:** Default drift risk between parsing and backend-limit resolution is removed.
- **Positive:** Internal config import graph is clearer and less misleading.
- **Positive:** Third-party drivers returning thenables are handled safely.
- **Negative:** Memory-mode callers that previously passed `autoCommit` must
  remove it or provide a durable `driver`.
