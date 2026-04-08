# 42. GitHub Actions CI and Tag-Driven Release Pipeline

Date: 2026-03-13

## Status

Accepted

## Context

The repository now includes GitHub Actions workflows for both regular quality
checks and tagged release automation.

Without a documented contract, trigger scope, permissions, and release
sequencing can drift over time, causing:

- duplicated or missing checks between branch pushes and tag pushes
- accidental over-privileged workflow permissions
- inconsistent release artifacts and package publication behavior

## Decision

1. Split automation into two workflows:
   - `ci.yml` for branch push quality checks.
   - `ci-release.yml` for `v*` tag release and publication.
2. Constrain CI trigger scope to non-`main`, non-`release/*`, non-tag pushes.
3. Keep CI permissions read-only (`contents: read`) and release permissions
   write-scoped (`contents: write`, `packages: write`).
4. Standardize both workflows on:
   - Node.js `24.x`
   - pnpm setup + lockfile-frozen install
   - `pnpm check` as required quality gate
5. Require release workflow to produce and publish:
   - browser minified bundle artifact
   - GitHub Release asset attached to the pushed tag
   - GitHub Packages publication with owner-scoped package naming
6. Pin third-party actions by commit SHA for reproducibility and supply-chain
   control.

## Consequences

- **Positive:** Regular development pushes and release pushes have explicit,
  non-overlapping automation intent.
- **Positive:** Permission boundaries are clearer and minimized for non-release
  CI execution.
- **Positive:** Release output contract (build, asset upload, package publish)
  becomes stable and auditable.
- **Trade-off:** Release workflow complexity increases because release,
  artifact, and publish are bundled in one path.
