# ADR-0025: Comparator Output Finite-Integer Guard for B-Tree Key Index

Status: Accepted  
Date: 2026-03-11

## Context

`RecordKeyIndexBTree` delegates key ordering to an injected comparator.

Without runtime validation of comparator output, invalid values like `NaN`,
`Infinity`, or fractional numbers can be passed into B-Tree ordering logic.
That can break strict ordering assumptions and lead to index corruption or
unpredictable query behavior.

## Decision

Enforce a runtime comparator-result contract at the B-Tree adapter boundary.

Key points:
- comparator output MUST be a finite integer
- adapter normalizes valid non-zero integers to ordering sign (`-1` / `1`)
- invalid outputs fail fast with `IndexCorruptionError`
- this validation is applied before comparator output is used by
  `@frostpillar/frostpillar-btree`

## Consequences

Positive:
- prevents silent propagation of invalid comparator outputs into B-Tree state
- converts configuration/logic defects into deterministic explicit failures
- aligns runtime behavior with deterministic-ordering principles

Trade-offs:
- custom key comparator implementations now have a stricter runtime contract
- invalid comparator behavior that was previously tolerated now fails immediately

## References

- Specifications:
  - `docs/specs/01_DatastoreAPI.md`
  - `docs/specs/03_InternalArchitecture.md`
- Usage:
  - `README.md`
  - `README-JA.md`
- Implementation:
  - `src/storage/btree/recordKeyIndexBTree.ts`
- Tests:
  - `tests/storage/time-index-btree-package-adapter.test.mjs`
