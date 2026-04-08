import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

const createSandboxDirectory = async (name) => {
  const baseDir = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(baseDir, `${name}-${uniqueSuffix}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

test('stale lock with dead PID is recovered and backend is created successfully', async () => {
  const { createFileBackend, releaseFileLock } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('stale-lock-dead-pid');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    // Write a lock file with a non-existent PID
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999999, createdAt: new Date().toISOString() }),
    );

    // Should succeed: stale lock recovered
    const backend = createFileBackend({ filePath });
    assert.equal(
      backend.lockAcquired,
      true,
      'Backend should have acquired the lock after stale recovery',
    );

    releaseFileLock(backend);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('recovered lock file contains current process PID', async () => {
  const { readFileSync } = await import('node:fs');
  const { createFileBackend, releaseFileLock } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('stale-lock-pid-verify');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    // Write a stale lock with a dead PID
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999999, createdAt: new Date().toISOString() }),
    );

    const backend = createFileBackend({ filePath });
    assert.equal(backend.lockAcquired, true);

    // Verify the lock file now contains our PID
    const lockContent = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(
      lockContent.pid,
      process.pid,
      'Lock file must contain current process PID after recovery',
    );

    releaseFileLock(backend);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('lock with alive PID blocks creation with DatabaseLockedError', async () => {
  const { createFileBackend } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('stale-lock-alive-pid');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    // Write a lock file with the current process PID (alive)
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    );

    assert.throws(
      () => createFileBackend({ filePath }),
      (error) => {
        assert.equal(
          error.name,
          'DatabaseLockedError',
          `Expected DatabaseLockedError, got ${error.name}`,
        );
        return true;
      },
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('malformed lock file causes DatabaseLockedError (conservative)', async () => {
  const { createFileBackend } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('stale-lock-malformed');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    // Write garbage content
    writeFileSync(lockPath, 'garbage-not-json');

    assert.throws(
      () => createFileBackend({ filePath }),
      (error) => {
        assert.equal(
          error.name,
          'DatabaseLockedError',
          `Expected DatabaseLockedError, got ${error.name}`,
        );
        return true;
      },
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('empty lock file causes DatabaseLockedError (conservative)', async () => {
  const { createFileBackend } = await importDistModule(
    'storage/drivers/file/fileBackend.js',
  );
  const sandbox = await createSandboxDirectory('stale-lock-empty');
  const filePath = path.join(sandbox, 'test.fpdb');
  const lockPath = `${filePath}.lock`;

  try {
    // Write empty content
    writeFileSync(lockPath, '');

    assert.throws(
      () => createFileBackend({ filePath }),
      (error) => {
        assert.equal(
          error.name,
          'DatabaseLockedError',
          `Expected DatabaseLockedError, got ${error.name}`,
        );
        return true;
      },
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
