# ADR-0010: Browser Metadata Validation for Load Safety

Status: Accepted  
Date: 2026-03-10

## Context

Browser durable backend loaders restore internal counters from persisted
metadata:
- localStorage manifest `activeGeneration` and `commitId`
- IndexedDB meta `commitId`
- OPFS meta `commitId`

`commitId` and generation counters are later used for chunk/file selection and
next-commit sequencing. If corrupted metadata is accepted (for example string,
`NaN`, or negative), runtime state can become inconsistent and subsequent
durability operations can behave unpredictably.

OPFS already validated `commitId`, but localStorage and IndexedDB lacked
equivalent guardrails on load.

## Decision

- Require load-time validation for browser durable metadata counters:
  - localStorage `manifest.activeGeneration`: non-negative safe integer
  - localStorage `manifest.commitId`: non-negative safe integer
  - IndexedDB `meta.commitId`: non-negative safe integer
  - OPFS `meta.commitId`: non-negative safe integer (existing rule retained)
- Fail initialization with `StorageEngineError` when validation fails.
- Do not mutate backend in-memory counters when metadata is invalid.
- Document this behavior in spec and usage docs (EN/JA) and cover with tests.

## Consequences

Positive:
- Corrupted browser metadata is detected deterministically at open/load time.
- Internal counter state remains type-safe and range-safe before commit/chunk
  key calculations.
- Validation behavior is aligned across browser durable backends.

Trade-off:
- Some previously tolerated corrupted persisted states now fail fast during
  initialization.

## References

- MDN: `Number.isSafeInteger()`  
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger
- MDN: Window: `localStorage` property  
  https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- MDN: IndexedDB API  
  https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN: Origin private file system (OPFS)  
  https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
