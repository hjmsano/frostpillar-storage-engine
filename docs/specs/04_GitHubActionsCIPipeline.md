# Spec: GitHub Actions CI and Release Pipeline

Status: Active
Version: 0.4
Last Updated: 2026-04-04

## 1. Scope

This spec defines repository CI and release workflow contracts under `.github/workflows/`.

In scope:

- `ci.yml` quality gate behavior
- `ci-release.yml` Release Please-driven publish behavior
- required ordering, permissions, and release artifact contract

Out of scope:

- runtime behavior of storage engine code

## 2. Workflow Inventory

Repository MUST define:

- `.github/workflows/ci.yml`
- `.github/workflows/ci-release.yml`

## 3. CI Workflow Contract (`ci.yml`)

Trigger policy:

- workflow name MUST be `CI`.
- trigger MUST be `push`.
- `release` and `release/*` branches MUST be excluded.
- tags matching `v*` MUST be excluded.

Permission policy:

- top-level permissions MUST include `contents: read`.

Job contract:

- one `lint-and-test` job on `ubuntu-latest`.
- steps run in order:
  1. checkout
  2. setup pnpm (no auto-install)
  3. setup Node.js `24.x` with pnpm cache
  4. `pnpm install --frozen-lockfile`
  5. `pnpm check`

## 4. Release Workflow Contract (`ci-release.yml`)

Trigger policy:

- workflow name MUST be `Release Please Publish`.
- trigger MUST be `push` to `main` branch.

Permission policy:

- top-level permissions MUST include:
  - `contents: write`
  - `pull-requests: write`
  - `id-token: write`

Job contract:

- one `release` job on `ubuntu-latest`.
- steps run in order:
  1. Run Release Please action targeting `main` branch
  2. checkout release tag (conditional: `release_created == 'true'`)
  3. setup pnpm (no auto-install, conditional)
  4. setup Node.js `24.x` with pnpm cache and npm registry (conditional)
  5. `pnpm install --frozen-lockfile` (conditional)
  6. `pnpm check` (conditional)
  7. `pnpm build` (conditional)
  8. `pnpm build:bundle` (conditional)
  9. create GitHub Release for `${GITHUB_REF_NAME}` and upload the minified bundle (conditional)
  10. remove browser release artifact from npm publish payload (conditional)
  11. publish with `pnpm publish --no-git-checks` using OIDC provenance (conditional)

All steps after Release Please action MUST be conditional on `steps.release.outputs.release_created == 'true'`.

## 5. Reproducibility and Supply-Chain Rules

Required:

- external actions MUST be pinned by commit SHA.
- dependency installation in both workflows MUST use `--frozen-lockfile`.
- release/publish behavior MUST be driven by Release Please release creation only.

## 6. Release Artifact, Bundle Target, and Package Contract

Required:

- release asset MUST include `dist/frostpillar-storage-engine.min.js`.
- npm module build MUST use `pnpm build` output from `tsconfig.json` profile:
  - `target = ES2022`
  - `module = NodeNext`
- `pnpm build:bundle` MUST execute browser bundle build script under `scripts/`.
- browser bundle build MUST type-check `src/index.ts` with a bundle profile configured as:
  - `target = ES2020`
  - `moduleResolution = Bundler`
- bundle profile type-check MUST pass without requiring post-ES2020 global type names in source (for example, direct `AggregateError` type references).
- browser bundle build MUST run esbuild with:
  - entrypoint `src/index.ts`
  - `bundle = true`
  - `minify = true`
  - `platform = browser`
  - `format = iife`
  - `globalName = FrostpillarStorageEngine`
  - `target = es2020`
  - `outfile = dist/frostpillar-storage-engine.min.js`
- browser minified bundle MUST expose all runtime root entry exports from `src/index.ts` on `window.FrostpillarStorageEngine`.
- npm module build profile (`tsconfig.json`) MUST remain independent from browser bundle target changes.
- release creation MUST upload `dist/frostpillar-storage-engine.min.js` as a GitHub Release asset.
- workflow MUST remove `dist/frostpillar-storage-engine.min.js` before `pnpm publish`.
- npm publish payload MUST NOT include `dist/frostpillar-storage-engine.min.js`.
- package name MUST be `@frostpillar/frostpillar-storage-engine`.
- publish MUST authenticate via npm Trusted Publisher (OIDC) with `id-token: write` permission.
- npm package delivery MUST remain tree-shakable (`sideEffects: false` + named export entrypoints).

## Revision History

| Version | Date | Summary |
|---------|------|---------|
| 0.4 | 2026-04-04 | Switch publish target from GitHub Packages to npmjs.org (OIDC), release branch from `release` to `main`. |
| 0.3 | 2026-03-20 | Add bundle target and package contract details (§6). |
| 0.2 | 2026-03-20 | Add reproducibility and supply-chain rules (§5). |
| 0.1 | 2026-03-20 | Initial specification. |
