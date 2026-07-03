# Spec: Durable Backends and Capacity Resolution

Status: Active
Version: 0.4
Last Updated: 2026-07-03

## 1. Scope

This spec defines durable-backend behavior across file and browser drivers.

In scope:

- file durability commit/recovery/lock lifecycle
- backend-limit capacity resolution by driver capability
- browser durable metadata validation and load safety
- browser `syncStorage` adapter and commit robustness requirements

Out of scope:

- public Datastore selection/payload/key contract (see `01_DatastoreAPI.md`)
- repository internal source layout policy (see `03_InternalArchitecture.md`)

## 2. Durable Driver Surface

Durable drivers covered in this baseline:

- `fileDriver`
- `localStorageDriver`
- `indexedDBDriver`
- `opfsDriver`
- `syncStorageDriver`

`new Datastore({})` remains in-memory mode and is not a durable backend.

## 2.1 BTreeJSON-Based Persistence Contract

All durable drivers MUST use `BTreeJSON` as the persistence payload format.

Snapshot contract:

- `getSnapshot()` callback MUST return `BTreeJSON` from `tree.toJSON()`.
- `DatastoreDriverSnapshot` type is `{ treeJSON: BTreeJSON<unknown, unknown> }`.

Initialization contract:

- `DatastoreDriverInitResult` MUST include `initialTreeJSON: BTreeJSON<unknown, unknown> | null`.
- when `initialTreeJSON` is not null, Datastore MUST restore via `RecordKeyIndexBTree.fromJSON()`.
- when restoring via `fromJSON()`, Datastore MUST pass its configured `duplicateKeys` policy to the adapter config so the restored tree enforces the same duplicate key semantics as the original.
- when `initialTreeJSON` is null (empty/new store), Datastore MUST start with an empty tree.
- `initialCurrentSizeBytes` MUST be the UTF-8 byte length of `JSON.stringify(initialTreeJSON)` (or 0 for null).
- `initialRecords` and `initialNextInsertionOrder` are removed from the init result.

> **NOTE:** `String.prototype.length` returns the UTF-16 character count, which is NOT equivalent to UTF-8 byte length for content containing multi-byte characters (for example, characters outside the Basic Multilingual Plane encode to 4 bytes in UTF-8 but count as a surrogate pair of length 2 in UTF-16). All backend implementations MUST compute UTF-8 byte length using a `TextEncoder` or equivalent UTF-8–aware byte counter. Using `.length` directly on the JSON string is prohibited and will produce incorrect size tracking for multi-byte content.

Capacity tracking:

- total size is estimated incrementally per mutation.
- `PersistedRecord` no longer carries `encodedBytes`, `keySerialized`, `insertionOrder`, or `key`.
- record type stored as B+Tree value is `{ payload: RecordPayload, sizeBytes: number }`. The key is stored only as the B+Tree entry key, not duplicated inside the value. The `sizeBytes` field is a runtime-computed cache for capacity accounting; it is NOT part of the persisted format and is backfilled from `estimateRecordSizeBytes` on restore when absent.
- `estimateRecordSizeBytes(key, payload)` estimates the full B+Tree entry contribution as `utf8ByteLength(JSON.stringify([key, { payload }]))`, accounting for JSON structural overhead.

Removed from persistence pipeline:

- `SerializablePersistedRecord` type
- `toSerializableRecord` / `decodeSerializableRecord` functions
- per-record `computeRecordEncodedBytes` for capacity (replaced by JSON size estimation)

## 2.2 treeJSON Structural Validation

All durable backends MUST validate the parsed `treeJSON` value before passing it to `RecordKeyIndexBTree.fromJSON()`.

Validation rules:

- `treeJSON` MUST be a non-null plain object (i.e., `typeof treeJSON === 'object' && treeJSON !== null && !Array.isArray(treeJSON)`).
- if `treeJSON` is null, an array, a string, a number, a boolean, or any other non-plain-object type, backend initialization MUST fail with `PageCorruptionError`.
- deep structural validation of the B+Tree internal format (node layout, key ordering, etc.) is delegated to `@frostpillar/frostpillar-btree`'s `fromJSON()` and MUST NOT be duplicated in backend code.

## 3. File Backend Durability and Locking

### 3.1 Initial Snapshot Generation

When creating a new file backend (no existing sidecar), `writeInitialFileSnapshot` MUST generate the empty B-Tree JSON dynamically by instantiating an empty `RecordKeyIndexBTree` and calling `.toJSON()`. Hardcoding the serialization format is prohibited — the canonical representation MUST always come from the library.

### 3.2 Commit Protocol

File commit MUST use generation files plus sidecar metadata in this order:

1. write next generation temp data file (`*.g.<n>.tmp`)
2. persist temp data
3. atomic rename to committed generation file (`*.g.<n>`)
4. write sidecar temp (`*.meta.json.tmp`) with new active generation pointer
5. persist sidecar temp
6. atomic replace sidecar (`*.meta.json`)
7. fsync the parent directory so the rename metadata itself survives power loss (POSIX platforms only — see platform note)

`commit()` durable boundary is sidecar activation.

Platform note (directory fsync):

- on POSIX platforms (Linux, macOS), step 7 MUST be performed after sidecar activation.
- on Windows (`process.platform === 'win32'`), step 7 MUST be skipped and the skip MUST NOT fail the commit. Windows has no directory-sync API: `FlushFileBuffers` operates only on file handles, and Node.js `fs.fsync` on a directory handle fails with `EPERM`. Rename metadata durability is delegated to NTFS metadata journaling.
- file-content fsync (steps 2 and 5) applies on all platforms.
- rationale and references: ADR-0057.

### 3.3 Recovery Contract

On open:

- sidecar metadata is source of truth for active committed generation.
- interrupted temp files MAY be ignored/cleaned.
- sidecar pointing to missing generation MUST fail with `PageCorruptionError`.
- reopen after successful commit MUST restore committed records.

### 3.4 Lock Lifecycle

- lock file path is `${resolvedDataFilePath}.lock`.
- lock is acquired on open and released on close.
- lock conflict (EEXIST on exclusive create) MUST trigger stale lock detection before failing:
  1. the engine MUST attempt to read the PID from the lock file.
  2. if the lock file contains a valid JSON object with a `pid` field and the recorded PID is no longer alive (verified via `process.kill(pid, 0)` — signal 0 does not kill the process but checks existence), the engine MUST remove the stale lock file and retry acquisition once.
  3. if the PID is still alive, the engine MUST fail with `DatabaseLockedError`.
  4. if the lock file content is unreadable or malformed (not valid JSON, missing `pid` field, non-integer `pid`), the engine MUST fail with `DatabaseLockedError` (conservative default — do not remove a lock whose owner cannot be identified).
- if process exits without `close()`, lock file remains; later open calls MUST apply stale lock detection as described above before failing.

### 3.5 File Storage Error Normalization

File backend I/O paths MUST normalize unknown thrown values to `StorageEngineError` using shared conversion helpers.

### 3.6 Working Directory Capture

- the file path containment check MUST resolve `process.cwd()` exactly once, at construction time of the file backend.
- the resolved base directory MUST be stored and reused for all subsequent path validation.
- the resolved base directory MUST NOT be re-evaluated on each operation; later `process.chdir()` calls MUST NOT affect which paths are accepted or rejected.

## 4. Backend-Limit Capacity Mode

`capacity.maxSize` supports sentinel value `"backendLimit"`.

Resolution rules:

- datastore construction MUST fail with `ConfigurationError` when `driver` is not set.
- datastore construction MUST fail with `ConfigurationError` when selected driver has no backend-limit resolver.
- for `localStorageDriver`, resolved limit MUST be `localStorage.maxChunkChars * localStorage.maxChunks`.
- for `syncStorageDriver`, resolved limit MUST be `syncStorage.maxTotalBytes`.
- backend-limit defaults MUST come from shared config defaults used by config parsing.

Policy interaction:

- after resolving sentinel to numeric value, existing capacity policy (`strict`/`turnover`) applies unchanged.
- strict overflow MUST surface as `QuotaExceededError`.

## 5. Browser Durable Metadata Validation

Browser durable backends MUST validate metadata numeric fields before mutating in-memory backend state.

Required non-negative safe-integer checks:

- `localStorage` manifest: `activeGeneration`, `commitId`, `chunkCount`
- `syncStorage` manifest: `activeGeneration`, `commitId`, `chunkCount`
- `indexedDB` metadata: `commitId`
- `opfs` metadata: `commitId`

If violated, backend initialization MUST fail with `StorageEngineError` and MUST NOT continue with corrupted internal counters.

Key namespace isolation:

- `localStorage` keys MUST use driver-prefixed format: `${keyPrefix}:ls:${databaseKey}:...`.
- `syncStorage` keys MUST use driver-prefixed format: `${keyPrefix}:sync:${databaseKey}:...`.
- driver-specific prefixes (`ls:`, `sync:`) prevent namespace collisions when both drivers share the same `keyPrefix` and `databaseKey` values.

Chunk integrity and cleanup:

- `localStorage` and `syncStorage` load MUST require all manifest-declared chunk indices to exist.
- browser chunk cleanup loops MUST be bounded by known chunk count or explicit backend chunk limits.

## 6. Browser `syncStorage` Robustness

Adapter dispatch:

- when both APIs are available, implementation MUST prefer `browser.storage.sync` Promise API.
- `chrome.storage.sync` callback API MUST be fallback only.

Commit robustness:

- generation cleanup with unknown chunk count MUST run in bounded batches.
- snapshot chunking derives from JSON array serialization and chunk count is always at least 1 (`"[]"` for empty dataset).
- pre-write cleanup MAY run best-effort and MUST NOT fail commit by itself.
- non-quota commit failures MUST throw `StorageEngineError` and preserve original error as `cause` when available.

## Revision History

| Version | Date       | Summary                                                                                                  |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| 0.4     | 2026-07-03 | Document directory-fsync step (§3.2 step 7) and Windows skip contract (ADR-0057).                        |
| 0.3     | 2026-03-30 | Add treeJSON structural validation (§2.2), stale lock recovery (§3.4), working directory capture (§3.6). |
| 0.2     | 2026-03-25 | Switch to BTreeJSON persistence (§2.1), simplify PersistedRecord, add size estimation contract.          |
| 0.1     | 2026-03-20 | Initial specification.                                                                                   |
