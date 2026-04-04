# Specs Index

Status: Active
Last Updated: 2026-03-31

Normative specifications are organized as:

- `01_DatastoreAPI.md`: public API contract, key-range selection/payload/key behavior, and error/close semantics.
- `02_DurableBackends.md`: durable backend behavior, file locking/durability, backend-limit capacity, browser metadata validation.
- `03_InternalArchitecture.md`: internal controller architecture, source layout, and implementation guardrails.
- `04_GitHubActionsCIPipeline.md`: CI/release workflow contract, browser bundle target profile, and release artifact rules.
- `05_PerformanceOptimizations.md`: P1/P2 hot-path performance optimizations (B-tree lookup consolidation, non-allocating UTF-8 measurement, load-time re-stringify elimination).

Outdated implementation plan drafts were removed to keep only active normative specs.
