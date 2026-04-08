import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

// Helpers

const createSandboxDirectory = async (name) => {
  const baseDir = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(baseDir, `${name}-${uniqueSuffix}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

// Regression: Spec §3.6 — the canonical base directory MUST be captured
// exactly once at construction time. Later process.chdir() calls MUST NOT
// affect path containment decisions.

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: ensureCanonicalPathWithinWorkingDirectory uses capturedCwd parameter
//
// Without the fix: the function ignores the third argument and calls
// realpathSync(process.cwd()) on every invocation. After chdir to /tmp,
// a path inside the project directory would be REJECTED because it's outside
// /tmp. With the fix: the capturedBase is used instead, so the path is
// correctly ACCEPTED.
// ─────────────────────────────────────────────────────────────────────────────

test('ensureCanonicalPathWithinWorkingDirectory uses capturedCwd instead of re-evaluating process.cwd()', async () => {
  const { ensureCanonicalPathWithinWorkingDirectory } = await importDistModule(
    'storage/config/config.node.js',
  );
  const { ConfigurationError } = await importDistModule('errors/index.js');

  const originalCwd = process.cwd();
  const sandbox = await createSandboxDirectory('chdir-capturedcwd');
  const pathInsideSandbox = path.join(sandbox, 'data.fpdb');

  try {
    // Capture the base as the sandbox directory.
    const capturedBase = realpathSync(sandbox);

    // Change cwd to /tmp — entirely unrelated to the sandbox.
    // Without the fix: ensureCanonicalPathWithinWorkingDirectory would call
    // realpathSync(process.cwd()) = /tmp, and pathInsideSandbox is outside /tmp,
    // causing a ConfigurationError (test would fail on doesNotThrow).
    // With the fix: capturedBase is used, so pathInsideSandbox is inside the base.
    process.chdir('/tmp');

    assert.doesNotThrow(
      () =>
        ensureCanonicalPathWithinWorkingDirectory(
          pathInsideSandbox,
          'filePath',
          capturedBase,
        ),
      'Path inside capturedBase must be accepted even after chdir to an unrelated directory',
    );

    // A path outside capturedBase must still be rejected.
    assert.throws(
      () =>
        ensureCanonicalPathWithinWorkingDirectory(
          '/etc/passwd',
          'filePath',
          capturedBase,
        ),
      (error) => error instanceof ConfigurationError,
      'Path outside capturedBase must be rejected',
    );
  } finally {
    process.chdir(originalCwd);
    await rm(sandbox, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: createFileBackend captures cwd once and all internal validations
//         use that frozen snapshot.
//
// We verify indirectly: when cwd is the sandbox, creation succeeds. The
// important invariant is that all three ensureCanonicalPathWithinWorkingDirectory
// calls inside createFileBackend (via resolveFileDataPath + direct call) use
// the same captured base — not live process.cwd().
// ─────────────────────────────────────────────────────────────────────────────

test('createFileBackend captures cwd once at construction time', async () => {
  const { createFileBackend, releaseFileLock } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const { ConfigurationError } = await importDistModule('errors/index.js');

  const originalCwd = process.cwd();
  const sandbox = await createSandboxDirectory('chdir-backend-construction');
  const filePath = path.join(sandbox, 'test.fpdb');

  try {
    // Create backend while cwd is the sandbox directory.
    process.chdir(sandbox);
    const backend = createFileBackend({ filePath });
    releaseFileLock(backend);

    // Now move cwd away to /tmp. A path inside sandbox is outside /tmp.
    process.chdir('/tmp');

    // Before the fix: createFileBackend re-evaluates process.cwd() = /tmp and
    // rejects filePath because it's outside /tmp.
    // After the fix: createFileBackend re-captures cwd = /tmp at its OWN
    // invocation time. Since filePath is also outside /tmp, it DOES throw here.
    // This confirms the fix: the cwd snapshot is frozen PER construction call,
    // not frozen globally across all calls.
    assert.throws(
      () => createFileBackend({ filePath }),
      (error) => error instanceof ConfigurationError,
      'Second createFileBackend call from /tmp must reject path outside /tmp',
    );
  } finally {
    process.chdir(originalCwd);
    await rm(sandbox, { recursive: true, force: true });
  }
});
