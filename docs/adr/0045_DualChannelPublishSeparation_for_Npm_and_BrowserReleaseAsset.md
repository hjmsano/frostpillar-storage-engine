# 45. Dual-Channel Publish Separation for npm and Browser Release Asset

Date: 2026-03-13

## Status

Accepted

## Context

Frostpillar distributes artifacts in two channels:

- npm package modules for ESM imports
- browser script-tag bundle published as a GitHub Release asset

The release workflow builds both artifacts into `dist/`. Without explicit
separation, `pnpm publish` can include the browser minified bundle in npm
payload because package files include `dist/`.

## Decision

1. Keep npm module TypeScript profile unchanged (`tsconfig.json`):
   - `target = ES2022`
   - `module = NodeNext`
2. Keep browser release bundle profile unchanged:
   - TypeScript bundle profile `target = ES2020`
   - esbuild output `target = es2020`, `format = iife`
3. In release workflow:
   - upload `dist/frostpillar-storage-engine.min.js` to GitHub Release
   - remove `dist/frostpillar-storage-engine.min.js` before `pnpm publish`
4. Specify in specs that npm publish payload must not contain browser release
   bundle artifact.

## Consequences

- **Positive:** npm package remains focused on ESM module distribution.
- **Positive:** browser global bundle remains available as explicit release
  artifact.
- **Positive:** dual-channel delivery behavior is deterministic and testable.
- **Trade-off:** release workflow includes one additional sanitization step
  before publish.
