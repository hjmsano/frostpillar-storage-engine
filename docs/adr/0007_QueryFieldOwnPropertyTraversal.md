# ADR-0007: Query Field Traversal Uses Own-Property Access

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-10

## Context

During query review, `readFieldValue` used the `in` operator to test payload path segments.

`in` traverses the prototype chain, so inherited properties can be observed by queries.
This can produce false-positive matches for fields that are not actually stored as own payload data.

Given this engine's security and predictability goals, query evaluation should only inspect persisted own payload properties.

## Decision

- Replace prototype-chain membership checks in field traversal with `Object.hasOwn(...)`.
- Add regression test proving inherited properties are ignored while own properties remain queryable.
- Update Datastore spec and user docs (EN/JA) to define own-property-only traversal semantics.

## Consequences

Positive:
- Prevents inherited-property leakage into query results.
- Aligns runtime behavior with explicit data-model expectations.
- Reduces ambiguity and hard-to-debug query behavior when payload objects have custom prototypes.

Trade-off:
- Some historical payloads relying on inherited property lookup will no longer match queries.

## Supersession Note

The query engine (`queryNative` and related field traversal logic) was removed from this
repository and its responsibility transferred to `frostpillar-query-engine`. This ADR's
decision is no longer applicable to `frostpillar-storage-engine`.

## References

- MDN: `in` operator behavior (includes prototype chain)
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/in
- MDN: `Object.hasOwn()`
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwn
