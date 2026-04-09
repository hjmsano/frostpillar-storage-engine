# ADR-0001: Core Baseline Extraction for Standalone Storage Engine Package

Status: Accepted  
Date: 2026-03-10

## Context

This repository was initialized by extracting core storage-engine assets from Frostpillar.
The extracted set contained mixed maturity artifacts (multiple milestones, browser expansion docs, and transitional plans).
A minimum coherent standalone package baseline was required first.

## Decision

1. Establish a minimum baseline package around storage-engine core behavior.

- Keep `Datastore` API and core modules.
- Keep memory and file backend behavior as first-class tested scope.
- Keep browser implementation files as compatibility code but out of initial expansion scope.

2. Normalize project structure.

- Active source under `src/`.
- Active tests under `tests/`.
- Active docs under `docs/architecture`, `docs/specs`, and `docs/adr`.
- User-facing instructions consolidated in `README.md` (EN) and `README-JA.md` (JA).

3. Enforce spec-first and test-first flow for this repository.

- Update specs first.
- Add tests reflecting specs.
- Implement or migrate code to satisfy tests.

4. Defer external B-tree package integration until GitHub Packages registry/auth setup is available in this repository.

## Consequences

Positive:

- Repository starts from a clear, minimal, testable baseline.
- Historical artifacts are separated from active contract.
- Future refactors can proceed incrementally.

Trade-off:

- Browser-focused feature docs and milestone plans are intentionally not promoted into active baseline docs in this step.
