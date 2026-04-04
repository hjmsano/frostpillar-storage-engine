# Architecture Overview

Status: Active
Last Updated: 2026-03-31

## Design Philosophy

Frostpillar is a fast, lightweight, tiny-footprint database for Node.js and browsers. The storage engine is **ephemeral by default** — all data lives in memory for maximum speed. Durable backends are opt-in and must not degrade the in-memory fast path. The engine trades full redundancy for speed and simplicity; see [vision-and-principles.md](vision-and-principles.md) for the complete rationale.

## Ecosystem Context

`frostpillar-storage-engine` is one component in the Frostpillar project family:

- `frostpillar-db`: Database management and orchestration
  - `frostpillar-query-interface`: Native/SQL-like/Lucene-like query interface and API
  - `frostpillar-storage-engine`: **this repository** — core storage management and chunk handling
    - `frostpillar-btree`: B+ tree implementation for indexing
- `frostpillar-http-api`: RESTful API layer for access over HTTP
- `frostpillar-mcp`: MCP interface for AI agent integration
- `frostpillar-cli`: Command-line interface

Frostpillar family packages (`@frostpillar/frostpillar-*`) are permitted as runtime
`dependencies`. All other third-party packages are restricted to `devDependencies`.
See ADR-0046.

## Repository Layout

- `src/`: TypeScript implementation.
- `tests/`: executable tests (runtime behavior).
- `docs/specs/`: normative behavior specs.
- `docs/adr/`: architectural decisions and rationale.
- `README.md` / `README-JA.md`: user-facing usage documentation.

## Runtime Model

`Datastore` is the public entry point.

Core responsibilities:
- validate and normalize input
- maintain insertion-order and key-range selectable records via B+Tree (single source of truth)
- enforce duplicate key policy (`allow` / `replace` / `reject`)
- enforce capacity policy (`strict` / `turnover`)
- defensively clone payloads at insertion time (reads return independent copies)
- delegate persistence to backend controllers

External boundaries in this repository:
- B+Tree core is externalized to `frostpillar-btree` (`@frostpillar/frostpillar-btree`).
- Query-language/query-API concerns are externalized to `frostpillar-query-interface`.

Backends in this baseline:
- memory mode: omit `driver` and use in-memory only behavior.
- durable modes: pass an explicit `driver` factory output to `Datastore`:
  - `fileDriver` for Node.js sidecar + lock-file durability
  - `localStorageDriver`
  - `indexedDBDriver`
  - `opfsDriver`
  - `syncStorageDriver` (browser extension sync storage, e.g. `browser.storage.sync` or `chrome.storage.sync`)
  Durable backend controllers remain implementation-specific modules under
  `storage/drivers/*`.

## Internal Modules

- `validation/*`: key and payload checks.
- `storage/datastore/*`: datastore orchestration and lifecycle flow.
- `storage/backend/*`: backend-agnostic orchestration utilities.
- `storage/config/*`: runtime config parsing and path resolution.
- `drivers/*`: public driver factory modules (tree-shakable subpath entrypoints).
- `storage/drivers/*`: durable backend implementations and controllers by runtime.
- `storage/btree/*`: adapter layer for record-key index B-Tree operations backed by
  `@frostpillar/frostpillar-btree` (`InMemoryBTree`).
- `storage/record/*`: storage-scoped record ordering and record-id helpers.
- `errors/index.ts`: typed error hierarchy.
- `types.ts`: public configuration and storage contracts.

## Design Constraints

- Named exports only.
- Strict TypeScript type safety.
- No implicit runtime fallback when explicit backend is selected.
- File backend uses single-writer lock for process safety.
- Durable backend controllers share auto-commit orchestration via `AsyncDurableAutoCommitController`.
- Engine-generated runtime paths throw typed `FrostpillarError` subclasses (all extending `Error`); user-provided callbacks (for example `config.key.*`) may propagate their own thrown errors as-is.

## Distribution Model

- npm package delivery is ESM-first from `dist/` entrypoints and subpath driver modules.
- npm package metadata uses `sideEffects: false` so consumer bundlers can tree-shake unused modules.
- release pipeline also publishes browser IIFE bundle `dist/frostpillar-storage-engine.min.js` for script-tag integration.
- release pipeline excludes `dist/frostpillar-storage-engine.min.js` from npm publish payload.
- browser bundle exports runtime root API from `src/index.ts` via `window.FrostpillarStorageEngine`.
