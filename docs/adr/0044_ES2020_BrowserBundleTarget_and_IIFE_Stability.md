# 44. ES2020 Browser Bundle Target and IIFE Stability

Date: 2026-03-13

## Status

Accepted

## Context

Browser script-tag consumers execute the release bundle directly in runtime
environments where ESM `export` handling is not guaranteed.

The existing browser bundle contract already used IIFE output, but target level
was `ES2022`. A lower compatibility target is required for browser bundle
distribution while keeping npm module delivery unchanged.

## Decision

1. Set browser bundle TypeScript profile target to `ES2020`.
2. Set esbuild browser bundle target to `es2020`.
3. Keep browser bundle module format as `iife` with global name
   `FrostpillarStorageEngine`.
4. Keep npm module build profile unchanged
   (`tsconfig.json` remains NodeNext +`ES2022` target).

## Consequences

- **Positive:** Browser release bundle is compatible with a wider set of
  script-tag runtime environments.
- **Positive:** IIFE global contract remains stable for
  `window.FrostpillarStorageEngine`.
- **Positive:** npm package delivery semantics stay unchanged for Node.js and
  bundler consumers.
- **Trade-off:** Browser bundle target differs from npm module target, so both
  contracts must stay explicitly documented and tested.
