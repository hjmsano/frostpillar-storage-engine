# ADR-0006: Payload Reserved-Key Rejection and Shared Storage Error Normalization

Status: Accepted  
Date: 2026-03-10

## Context

Latest review feedback identified two remaining risks:

1. Payload normalization accepted reserved object keys (`__proto__`, `constructor`, `prototype`), which can enable prototype pollution if cloned into plain objects.
2. File durability modules duplicated identical unknown-error normalization logic (`throwStorageError`), increasing maintenance cost and drift risk.

The project requires explicit security constraints and maintainable internal contracts.

## Decision

1. Reject reserved payload keys

- `validatePayloadKey` now rejects `__proto__`, `constructor`, and `prototype` with `ValidationError`.
- This applies to both top-level and nested payload objects.
- Specs and usage docs (EN/JA) now document this constraint.

2. Centralize storage error normalization

- Add shared `toStorageEngineError(error, fallbackMessage)` in `src/errors/index.ts`.
- Replace per-file duplicated `throwStorageError` helpers in:
  - `src/storage/drivers/file/fileBackend.ts`
  - `src/storage/drivers/file/fileBackendSnapshot.ts`
- File durability spec now requires shared helper-based normalization for unknown thrown values.

## Consequences

Positive:

- Reduces prototype pollution attack surface in payload ingestion paths.
- Makes file durability error-wrapping behavior consistent and easier to maintain.

Trade-off:

- Payloads that previously included reserved keys are now rejected.

## References

- OWASP Prototype Pollution Prevention Cheat Sheet  
  https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html
- MDN JavaScript Guide: Inheritance and the prototype chain  
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Inheritance_and_the_prototype_chain
