# ADR-0055: Contract Clarifications and Deferred Items

Status: Accepted
Date: 2026-04-07

## Context

A comprehensive repository review identified seven work items (W1–W7) covering
documentation/spec gaps, behavioral inconsistencies, and maintenance concerns.
This ADR records the decisions made for each item.

## Decisions

### Addressed (W1–W4, W7)

**W1 — `putMany` atomicity by capacity policy:**
Spec and README now document that `strict` policy uses atomic batch semantics
(all-or-nothing) while `turnover` and no-capacity paths are non-atomic
(left-to-right). Contract tests added for both semantics.

**W2 — `payloadLimits` with `skipPayloadValidation`:**
Constructor always validates `payloadLimits` configuration (invalid values throw
`ConfigurationError`), even when `skipPayloadValidation` is `true`. The limits
are simply not applied at runtime. Spec/README updated from "ignored" to "not
applied at runtime, but still validated at construction."

**W3 — Comparator NaN behavior normalization:**
`clampComparatorResult` now includes a NaN check (`result !== result`), making
NaN rejection consistent across all code paths — `keys()`, `getMany()` sort/dedup,
B-tree wrapped comparator, and `getRange()` boundary validation. The NaN check
adds negligible overhead (single CPU comparison). Non-NaN non-finite values
(Infinity) remain silently clamped in hot paths per ADR-0054 P14.

**W4 — Architecture overview read semantics:**
Updated `docs/architecture/overview.md` to state reads return shared references
(not independent copies), matching README and implementation.

**W7 — `RecordPayload` array documentation:**
Removed arrays from `RecordPayload` description in both README.md and
README-JA.md. Arrays are rejected at runtime by the payload validator.

### Deferred (W5, W6)

**W5 — File lock stale-recovery PID reuse risk (P3):**
The current `isProcessAlive(pid)` check has a theoretical PID reuse race
condition. Deferring because:
- The race window is extremely narrow (between liveness check and `unlinkSync`).
- In-memory ephemeral-first design means file locking is an opt-in edge case.
- Proper fix requires lock identity strengthening (PID + start-time token +
  hostname) and stale-timeout policy, which is non-trivial and low priority.

**W6 — localStorage/syncStorage chunk logic duplication (P3):**
Both backends share similar chunk/manifest patterns. Deferring because:
- Extracting shared helpers requires careful abstraction of backend-specific
  I/O adapters and quota policies.
- Current duplication is manageable and has not caused divergence bugs.
- Over-abstracting risks coupling backends that may diverge intentionally.

## Consequences

- Spec version bumped to 0.13.
- All public-facing documentation is now consistent with implementation behavior.
- NaN comparator bugs are caught consistently across all APIs.
- W5 and W6 remain as known technical debt to revisit if lock contention or
  backend maintenance cost becomes a problem.
