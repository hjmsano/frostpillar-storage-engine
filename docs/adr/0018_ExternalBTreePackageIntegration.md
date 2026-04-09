# ADR-0018: External B-Tree Package Integration

Status: Accepted  
Date: 2026-03-11

## Context

This repository had project-specific key-index B-Tree internals under
`src/storage/btree/*`.

A standalone package `@frostpillar/frostpillar-btree` is now published and
available to this repository. Continuing to maintain two B-Tree
implementations would increase divergence risk and maintenance cost.

## Decision

Adopt `@frostpillar/frostpillar-btree` as the underlying in-memory tree engine for
datastore key indexing.

Keep `src/storage/btree/recordKeyIndexBTree.ts` as an internal adapter that:

- preserves Frostpillar datastore ordering semantics:
  1. key comparator ascending
  2. insertion order ascending for key ties
- preserves inclusive range query behavior for key range queries
- preserves deterministic delete and turnover eviction flows used by datastore
  (`deleteById`, capacity turnover)

Datastore internals continue to call the adapter interface
(`insert` / `remove` / `popOldest` / `rangeQuery` / `clear`) so the package
integration boundary remains localized.

## Consequences

Positive:

- single source of truth for B-Tree mutation/integrity logic
- lower maintenance burden in this repository
- clearer contract for future B-Tree package upgrades

Trade-offs:

- a new dependency/versioning surface is introduced
- adapter tests are required to prevent behavioral drift at the integration
  boundary

## References

- Specification:
  - `docs/specs/03_InternalArchitecture.md`
- Implementation:
  - `src/storage/btree/recordKeyIndexBTree.ts`
  - `src/storage/datastore/Datastore.ts`
- Tests:
  - `tests/storage/time-index-btree-package-adapter.test.mjs`
- External references:
  - npm package: https://www.npmjs.com/package/@frostpillar/frostpillar-btree
  - source repository: https://github.com/hjmsano/frostpillar-btree
