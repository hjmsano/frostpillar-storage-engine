# ADR-0046: Frostpillar Package Family and Runtime Dependency Policy

Status: Accepted
Date: 2026-03-20

## Context

`frostpillar-storage-engine` is one component within a broader Frostpillar project family:

- `frostpillar-db`: Database management and orchestration
  - `frostpillar-query-interface`: Native/SQL-like/Lucene-like query interface and API
  - `frostpillar-storage-engine`: core storage management and chunk handling
    - `frostpillar-btree`: B+ tree implementation for indexing
- `frostpillar-http-api`: RESTful API layer for access over HTTP
- `frostpillar-mcp`: MCP interface for AI agent integration
- `frostpillar-cli`: Command-line interface

The general dependency policy restricts runtime `dependencies` to prevent
unnecessary third-party bundle weight in consumer applications. However,
sibling packages in the Frostpillar family are purpose-built companions
with aligned versioning, semantics, and maintenance ownership — they are
not independent third-party libraries.

ADR-0018 introduced `@frostpillar/frostpillar-btree` as the first Frostpillar
family runtime dependency. This ADR generalizes that decision into a
standing policy.

## Decision

Frostpillar family packages (published under `@frostpillar/frostpillar-*`) are
permitted in `dependencies`. All other third-party packages remain restricted
to `devDependencies`.

## Consequences

Positive:

- shared logic across the Frostpillar family can be extracted into dedicated
  packages without violating the dependency policy
- reviewers have a documented rationale for exceptions to the "devDependencies
  only" rule

Trade-offs:

- each new Frostpillar family dependency still introduces a versioning surface
  and must be explicitly justified at integration time (see ADR-0018 as the
  precedent)

## References

- ADR-0018: `docs/adr/0018_ExternalBTreePackageIntegration.md`
- Architecture Overview: `docs/architecture/overview.md`
- AGENTS.md — Mandatory Development Workflow, rule 2
