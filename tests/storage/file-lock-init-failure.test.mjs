import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadStorageModule } from '../load-module.mjs';

const createSandboxDirectory = async (name) => {
  const baseDir = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(baseDir, `${name}-${uniqueSuffix}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

const importDistModule = async (relativeDistPath) => {
  await loadStorageModule();
  const moduleHref = pathToFileURL(
    path.resolve(process.cwd(), 'dist', relativeDistPath),
  ).href;
  return await import(moduleHref);
};

test('createFileBackend releases lock file when temp artifact cleanup fails', async () => {
  const { createFileBackend } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('lock-init-failure');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    // Create a subdirectory where a .tmp file is expected, so unlinkSync
    // fails with EPERM/EISDIR during cleanupFileTempArtifacts.
    const sidecarTmpPath = `${filePath}.meta.json.tmp`;
    mkdirSync(sidecarTmpPath, { recursive: true });
    // Place a file inside so it's a non-empty directory (cannot be unlinked).
    writeFileSync(path.join(sidecarTmpPath, 'blocker'), '');

    assert.throws(
      () => createFileBackend({ filePath }),
      (error) => error instanceof Error,
    );

    assert.equal(
      existsSync(lockPath),
      false,
      'Lock file must be released when initialization fails after lock acquisition',
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('createFileBackend retains lock file on successful initialization', async () => {
  const { createFileBackend, releaseFileLock } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('lock-init-success');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    const backend = createFileBackend({ filePath });

    assert.equal(
      existsSync(lockPath),
      true,
      'Lock file must exist after successful initialization',
    );
    assert.equal(backend.lockAcquired, true);

    releaseFileLock(backend);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
