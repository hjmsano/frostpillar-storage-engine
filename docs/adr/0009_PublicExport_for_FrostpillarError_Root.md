# ADR-0009: Public Export for `FrostpillarError` Root

Status: Accepted  
Date: 2026-03-10

## Context

The Datastore API spec defines `FrostpillarError` as the root class for public
error types. However, the package entrypoint exported only subclasses and did
not export `FrostpillarError` itself.

This made family-wide error handling impossible through the standard JavaScript
pattern `error instanceof FrostpillarError` unless consumers imported internal
paths or enumerated every subclass.

## Decision

- Export `FrostpillarError` from `src/errors/index.ts`.
- Re-export `FrostpillarError` from the package public entrypoint (`src/index.ts`).
- Document this contract in specs and usage docs (EN/JA), including root-level
  catch examples.

## Consequences

Positive:

- Consumers can catch the entire Frostpillar public error family with a single
  `instanceof` check.
- The documented error hierarchy and the actual public API surface are aligned.
- Existing subclass-based handling remains fully compatible.

Trade-off:

- Public API surface increases by one export and must be maintained as a
  compatibility commitment.

## References

- MDN: `Error`  
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
- MDN: `instanceof`  
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/instanceof
