# Vision and Principles

Status: Active
Last Updated: 2026-03-31

## Project Goal

Frostpillar is a **fast, lightweight, tiny-footprint database** that runs on Node.js servers and browsers, written entirely in TypeScript.

The project is decomposed into focused modules — B+Tree indexing (`frostpillar-btree`), storage engine (this repository), query interface (`frostpillar-query-interface`), and database orchestration (`frostpillar-db`) — so that each layer stays small, testable, and independently shippable.

## Vision

The storage engine is **ephemeral by default**: all data lives in memory for maximum speed and minimal overhead. Durable backends (file, localStorage, IndexedDB, OPFS, syncStorage) are opt-in — they add persistence without changing the API or sacrificing the lightweight core.

This is a deliberate trade-off. The engine does not aim to be a fully redundant, crash-proof database. Instead, it seeks the **best practical balance between the speed and simplicity of an ephemeral system and the safety of durable persistence**. Users choose how much durability they need, and the engine keeps everything else as fast and light as possible.

## Principles

1. Fast and light over full redundancy
- Speed, memory efficiency, and small bundle size are primary constraints.
- Persistence is additive — it must not degrade the in-memory fast path.
- Hyper-redundant designs (WAL, journaling, multi-replica) are intentionally out of scope; practical single-writer durability is sufficient.

2. Deterministic behavior first
- Read order, retention behavior, and commit semantics must be deterministic for the same input.

3. Spec-driven and test-driven delivery
- Public behavior is documented before implementation.
- Tests are added before implementation changes.

4. Clear durability boundaries
- For durable backends, `commit()` completion is the boundary for persisted state.
- Crash recovery behavior must be explicit in specs.

5. Small, composable modules
- Core datastore orchestration, validation, encoding, capacity policy, and backend control are separated.
- Each module has a single responsibility and a clear API boundary.

6. Typed API and typed errors
- Public API and failure modes are explicit and versionable.

7. Incremental scope
- This repository baseline prioritizes storage-engine core stability.
- Additional runtime-specific enhancements are layered after core tests and docs are stable.

8. Explicit ecosystem boundaries
- B+Tree core behavior is provided by external package `frostpillar-btree` (`@frostpillar/frostpillar-btree`), while this repository owns adapter and storage integration behavior.
- Query-language/query-API behavior (Native/SQL-like/Lucene-like) is provided by external package `frostpillar-query-interface` and is out of scope for this repository.
