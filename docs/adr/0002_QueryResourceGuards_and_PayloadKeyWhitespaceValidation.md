# ADR-0002: Query Resource Guards and Payload Key Whitespace Validation

Status: Partially superseded — query resource guards moved to `frostpillar-query-engine`; payload key whitespace validation remains active.
Date: 2026-03-10

## Context

Code review identified two availability and contract-hardening gaps:

1. Native query execution allowed high-cost patterns to scale to large scanned-row counts.
2. Payload key validation allowed whitespace-only keys.

This project prioritizes a light, fast, tiny core runtime. Defensive limits must remain simple and low-overhead.

## Decision

1. Add low-overhead query resource guards (**superseded** — see note below)
- Bound filter depth and filter node count.
- Keep a bounded scanned-row limit per query.
- Apply a stricter scanned-row limit when `like` or `regexp` predicates exist.
- Bound `distinct` intermediate working-set bytes.

2. Harden payload-key contract (**active**)
- Reject payload keys that are empty after trim.

3. Keep implementation small (**active**)
- Use simple counters/limits and canonical key generation.
- Avoid heavyweight runtime dependencies.

## Consequences

Positive:
- Reduces risk of single-query CPU and memory exhaustion.
- Makes payload key rules explicit and deterministic.
- Preserves small, dependency-light implementation.

Trade-off:
- Some previously accepted queries/payloads now fail with `QueryValidationError` or `ValidationError`.

## Supersession Note

Query resource guards (decision 1) were removed from this repository and their
responsibility transferred to `frostpillar-query-engine`. Payload key whitespace
validation (decision 2) remains active in `src/validation/payload.ts`.
