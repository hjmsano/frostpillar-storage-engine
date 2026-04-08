# ADR-0004: BackendLimit Capacity Mode for Browser localStorage

Status: Accepted  
Date: 2026-03-10

## Context

Current capacity policy (`strict`/`turnover`) is backend-agnostic and depends on explicit byte limits.
However, storage backends have different practical limits. In particular, browser `localStorage`
has bounded write capacity and chunk configuration already defines a deterministic envelope in this codebase.

We need a deterministic way to bind `capacity.maxSize` to backend constraints without adding runtime quota probing complexity.

## Decision

1. Add sentinel mode:

- `capacity.maxSize: "backendLimit"`

2. Scope in this baseline:

- Supported only for selected browser backend `localStorage`.
- Resolved value is `localStorage.maxChunkChars * localStorage.maxChunks`.

3. Unsupported backends:

- `memory`, `file`, `indexedDB`, `opfs` reject `"backendLimit"` with `ConfigurationError`.

4. Policy behavior:

- After resolving to bytes, existing `strict`/`turnover` logic is reused unchanged.

## Consequences

Positive:

- Enables backend-aware capacity binding for localStorage with deterministic config.
- Prevents ambiguous "very large explicit maxSize" configs for localStorage usage.
- Keeps implementation simple and testable.

Trade-off:

- `indexedDB` and `opfs` remain explicit-capacity-only in this baseline.
- The resolved localStorage bound is an internal deterministic envelope, not a browser-wide quota oracle.

## References

- MDN: Storage quotas and eviction criteria  
  https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN: Window.localStorage  
  https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- MDN: StorageManager.estimate()  
  https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate
