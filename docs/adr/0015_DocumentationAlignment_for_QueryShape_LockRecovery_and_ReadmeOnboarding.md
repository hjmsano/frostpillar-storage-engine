# ADR-0015: Documentation Alignment for Query Shape, Lock Recovery, and README Onboarding

Status: Partially superseded — query row shape and orderBy/distinct decisions moved to `frostpillar-query-engine`; file lock and README onboarding decisions remain active.
Date: 2026-03-10

## Context

The implementation already had stable behavior for:

- default `queryNative` row shape when `select` is omitted
- file lock persistence after abnormal process exit
- `orderBy` + `distinct` execution order

These behaviors were either missing or not explicit in specs and usage docs.
Also, specs remained `Draft` despite milestone-level stability, and `README.md`
lacked installation and quick-start onboarding.

## Decision

- Promote core specs `docs/specs/01..04` from `Draft` to `Active`. (**active**)
- Document default query row shape (**superseded** — see note below):
  - include `key` and all top-level payload fields
  - nested payload objects and arrays are included as-is (further refined in ADR-0047)
  - omit `_id` unless explicitly projected via `select`
- Document file-lock crash behavior (**active**):
  - stale lock file blocks open with `DatabaseLockedError`
  - recovery requires manual `.lock` removal after confirming no active writer
- Document `orderBy` + `distinct` behavior (**superseded** — see note below):
  - sort first, then deduplicate
  - keep first row in sorted order
  - explicitly note difference from standard SQL processing order
- Add README installation instructions and a minimal quick-start example, with
  direct EN/JA usage guide links. (**active**)

## Consequences

Positive:

- Spec/usage/README now reflect actual runtime behavior.
- Onboarding for first-time users is materially improved.
- Operational handling for stale lock files is explicit.

Trade-off:

- The docs now codify a non-SQL `distinct` processing order, so changing that
  behavior later will require a compatibility decision.

## Supersession Note

Query row shape and `orderBy`/`distinct` ordering decisions were removed from this
repository and their responsibility transferred to `frostpillar-query-engine`.
File lock behavior and README onboarding decisions remain active in
`frostpillar-storage-engine`.

## References

- Implementation:
  - `src/storage/drivers/file/fileBackend.ts`
- Documentation:
  - `docs/specs/01_DatastoreAPI.md`
  - `docs/specs/02_DurableBackends.md`
  - `README.md`
  - `README-JA.md`
- External references:
  - Node.js `fs.openSync` flags (`'wx'`): https://nodejs.org/api/fs.html#fsopensyncpath-flags-mode
  - PostgreSQL `SELECT` processing reference: https://www.postgresql.org/docs/current/sql-select.html
