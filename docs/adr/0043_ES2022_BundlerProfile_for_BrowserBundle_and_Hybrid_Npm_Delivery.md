# 43. ES2022 Bundler Profile for Browser Bundle and Hybrid npm Delivery

Date: 2026-03-13

## Status

Superseded by ADR 0044

## Context

Frostpillar delivers two distribution channels:

- npm package modules for Node.js and bundler consumers
- browser release asset (`frostpillar-storage-engine.min.js`) for script-tag usage

The existing release bundle contract did not explicitly define:

- JavaScript target level for minified browser bundle output
- TypeScript module resolution profile used to validate bundle entry compatibility
- the relationship between "all project features" and hybrid npm + browser delivery

Without explicit contracts, release output compatibility and package tree-shaking
can drift between CI updates.

## Decision

1. Define browser bundle target as `ES2022` for both type-check profile and
   esbuild output target.
2. Add dedicated bundle TypeScript profile with `moduleResolution = Bundler`
   and `target = ES2022` for browser bundle entry validation.
3. Keep hybrid delivery:
   - npm package remains the full module distribution (root + subpath exports)
   - browser minified bundle is a runtime root-entry distribution
4. Keep tree-shaking contract on npm package (`sideEffects: false`, named
   export entrypoints).

## Consequences

- **Positive:** Browser release target is explicit and reproducible.
- **Positive:** Bundle compatibility checks use bundler-oriented module
  resolution semantics.
- **Positive:** Hybrid delivery remains clear: npm modules for full composable
  imports, browser bundle for global script usage.
- **Trade-off:** Build/release scripts gain one more profile and validation
  step.
