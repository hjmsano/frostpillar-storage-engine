# ADR-0013: Payload Depth Level Counting and Browser Overview Alignment

Status: Accepted  
Date: 2026-03-10

## Context

Two documentation/contract mismatches were identified:

1. Payload validation used a zero-based `depth` counter while error text stated
   `<= 64`, which effectively allowed 65 object levels.
2. Architecture overview still described browser runtime as compatibility-only,
   but `localStorage`, `indexedDB`, and `opfs` backends are implemented with
   controllers and baseline coverage.

## Decision

- Define payload nesting depth as level-based:
  - top-level payload object is level 1
  - maximum allowed level is 64
  - level 65 fails with `ValidationError`
- Update runtime validation logic to enforce this level-based contract.
- Align architecture and usage docs with current runtime reality:
  - architecture overview now states browser runtime is fully implemented with
    `localStorage`, `indexedDB`, and `opfs`
  - usage docs (EN/JA) now document payload depth counting and boundary

## Consequences

Positive:

- Runtime behavior now matches documented payload depth boundary.
- Client expectations are clearer because depth counting semantics are explicit.
- Architecture documentation no longer understates implemented browser scope.

Trade-off:

- Payload shapes that previously depended on 65 object levels are now rejected.

## References

- `src/validation/payload.ts`
- `tests/storage/datastore-payload-validation.test.mjs`
- `docs/specs/01_DatastoreAPI.md`
- `docs/architecture/overview.md`
- `README.md`
- `README-JA.md`
