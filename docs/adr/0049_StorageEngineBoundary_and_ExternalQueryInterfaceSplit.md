# ADR-0049: Storage Engine Boundary and External Query Interface Split

Status: Accepted
Date: 2026-03-20

## Context

This repository previously included query-related components alongside storage
engine behavior. Frostpillar now separates responsibilities across dedicated
packages to keep each layer focused and maintainable.

The storage layer must remain lightweight, deterministic, and reusable across
Node.js and browser runtimes, while query-language/API evolution proceeds
independently outside this repository.

## Decision

1. This repository scope is Frostpillar's storage engine only.
- It provides CRUD-oriented record storage/retrieval primitives.
- It does not provide query-language parsing/execution APIs.

2. B+Tree core remains outside this repository.
- This repository uses external package `frostpillar-btree`
  (`@frostpillar/frostpillar-btree`) as the B+Tree core.
- This repository owns only adapter and integration boundaries.

3. Query engine/API remains outside this repository.
- Native/SQL-like/Lucene-like query capabilities are handled by
  `frostpillar-query-interface`.
- Integration with that query layer is performed outside this repository.

4. Storage targets supported in this repository are:
- in-memory mode (no persistence),
- file backend (Node.js),
- browser `localStorage`,
- browser `indexedDB`,
- browser `opfs`.

5. Concurrency and redundancy policy:
- support synchronous and asynchronous storage flows,
- include practical redundancy and recovery safeguards,
- intentionally avoid hyper-redundant designs to keep the engine light and fast.

## Consequences

Positive:
- Clear package boundaries reduce responsibility overlap.
- Storage engine can evolve with a focused API/architecture contract.
- Query-interface package can evolve independently without forcing storage-layer
  churn.

Trade-offs:
- End-to-end query features now require integration across repositories.
- Cross-package version compatibility must be managed explicitly.

## References

- `README.md`
- `README-JA.md`
- `docs/architecture/vision-and-principles.md`
- `docs/architecture/overview.md`
- `docs/specs/01_DatastoreAPI.md`
- `docs/specs/03_InternalArchitecture.md`
