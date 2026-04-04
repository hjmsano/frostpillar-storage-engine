# ADR-0017: Storage Source Responsibility Layout

Status: Partially superseded by ADR-0047 (query directory removed)
Date: 2026-03-11

## Context

`src/storage` previously mixed datastore orchestration, backend wiring,
driver implementations, B-Tree internals, query engine helpers, and
storage-scoped record helpers in a mostly flat structure.

This made it harder to:
- identify module ownership quickly,
- isolate impact for backend- or query-specific changes,
- prepare for planned replacement of the current in-repo B-Tree
  implementation with an external package.

## Decision

Adopt a responsibility-based `src/storage` layout:

- `src/storage/datastore/*`: datastore orchestration and lifecycle
- `src/storage/backend/*`: backend-agnostic orchestration primitives
- `src/storage/config/*`: config parsing and runtime-specific path logic
- `src/storage/drivers/file/*`: file backend implementation + controller
- `src/storage/drivers/localStorage/*`: localStorage backend implementation + controller
- `src/storage/drivers/IndexedDB/*`: IndexedDB backend implementation + controller
- `src/storage/drivers/opfs/*`: OPFS backend implementation + controller
- ~~`src/storage/query/*`~~: removed in query module extraction (see ADR-0047)
- `src/storage/btree/*`: key-index B-Tree internals
- `src/storage/record/*`: storage-scoped record ordering and record-id helpers

Additional rules:
- move storage-only record helpers from `src/records/*` to
  `src/storage/record/*`.
- keep public package exports unchanged (`src/index.ts` still exports only
  supported public API).
- update tests to assert new source layout contract.

## Consequences

Positive:
- clear mapping from concern to directory.
- easier targeted refactors (especially upcoming B-Tree replacement).
- less cross-concern coupling in navigation and code review.

Trade-offs:
- many relative import paths become deeper and require coordinated updates.
- historical ADR references may point to pre-relocation paths.

## References

- Specification:
  - `docs/specs/03_InternalArchitecture.md`
- Implementation:
  - `src/storage/datastore/Datastore.ts`
  - `src/storage/backend/backendBootstrap.ts`
  - `src/storage/drivers/file/fileBackendController.ts`
  - ~~`src/storage/query/query.ts`~~ (removed; see ADR-0047)
  - `src/storage/btree/recordKeyIndexBTree.ts`
  - `src/storage/record/recordId.ts`
- Tests:
  - `tests/specs/storage-source-layout.test.mjs`
- External references:
  - TypeScript Modules Handbook: https://www.typescriptlang.org/docs/handbook/modules/introduction.html
  - Node.js ECMAScript Modules: https://nodejs.org/api/esm.html
