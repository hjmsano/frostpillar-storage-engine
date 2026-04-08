# ADR-0024: Regexp Safety Subset for Query Backtracking DoS Guard

Status: Superseded — query engine responsibility moved to `frostpillar-query-engine`
Date: 2026-03-11

## Context

`queryNative` allowed user-provided regular expressions for `where.operator = "regexp"`.

Existing safeguards already rejected:

- backreferences
- look-around assertions
- nested quantifier groups
- quantified alternation groups

However, adjacent branching quantifier runs without groups (for example long
`a?a?a?...` chains) were still accepted. These patterns can trigger
catastrophic backtracking and degrade query availability.

## Decision

Keep regex matching as a constrained feature and extend safety validation:

- reject patterns with excessive adjacent branching quantifier atoms
- set maximum adjacent branching quantifier run to `8`
- continue rejecting with `QueryValidationError('Unsafe regexp pattern.')`

This guard is enforced before runtime `RegExp` evaluation.

## Consequences

Positive:

- blocks an uncovered catastrophic-backtracking class in user-supplied regex
- keeps query execution availability-focused and deterministic under adversarial input
- preserves current error surface (`QueryValidationError`) without new public error types

Trade-offs:

- some advanced regex patterns are intentionally rejected as unsafe
- the guard is heuristic and favors conservative rejection over permissive acceptance

## Supersession Note

The query engine (`queryNative`, `regexp` operator, and all regex safety validation) was
removed from this repository and its responsibility transferred to `frostpillar-query-engine`.
This ADR's decision is no longer applicable to `frostpillar-storage-engine`.

## References

- Vision and principles:
  - `docs/architecture/vision-and-principles.md`
- Official references:
  - ECMAScript RegExp overview: https://tc39.es/ecma262/#sec-regexp-regular-expression-objects
  - MDN RegExp quantifiers: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Quantifiers
