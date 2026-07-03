# 57. Windows Directory-Fsync Skip for File Backend Commit

Date: 2026-07-03

## Status

Accepted

## Context

The file backend commit protocol ends by fsyncing the parent directory of the
data files. On POSIX filesystems this is required for full crash consistency:
`rename()` updates the directory's entry table, and fsyncing the renamed file
alone does not guarantee the rename itself survives power loss. Established
storage engines (SQLite, LevelDB) apply the same pattern.

Windows cannot perform this step at all:

- `FlushFileBuffers` operates only on file handles; Windows exposes no API to
  sync a directory (see WebAssembly/wasi-filesystem#79).
- Node.js `fs.fsync` on a directory handle therefore fails with `EPERM`
  (see nodejs/node#3879).

Because `fsyncDirectory` ran unconditionally inside the commit `try` block,
the `EPERM` was wrapped into `StorageEngineError('File commit failed')`, so on
Windows every `commit()`, auto-commit, and the `close()` flush failed —
`fileDriver` could never persist anything. CI runs on `ubuntu-latest` only
(spec 04 §3), so the failure was never exercised.

## Decision

1. `fileBackendSnapshot.ts` exports `isDirectoryFsyncSupported(platform)`
   returning `false` for `'win32'` and `true` otherwise.
2. `fsyncDirectory` returns without touching the filesystem when
   `isDirectoryFsyncSupported(process.platform)` is `false`. POSIX behavior is
   unchanged.
3. File-content fsync (generation and sidecar writes) remains unconditional on
   all platforms; only the directory-entry sync is skipped. Rename metadata
   durability on Windows is delegated to NTFS metadata journaling, matching
   industry practice.
4. Spec 02 §3.2 documents the commit protocol's directory-fsync step and the
   Windows skip contract. Tests lock the predicate and the skip-branch commit
   flow.

## Consequences

- **Positive:** `fileDriver` commits can succeed on Windows instead of failing
  on every persistence attempt.
- **Positive:** POSIX crash-consistency behavior is untouched.
- **Negative:** Windows behavior is not exercised in CI (single-`ubuntu-latest`
  policy per spec 04); the guard is based on documented platform behavior
  rather than an in-repo Windows test run.
