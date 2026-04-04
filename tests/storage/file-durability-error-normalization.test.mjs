import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadStorageModule } from '../load-module.mjs';

const importDistModule = async (relativeDistPath) => {
  await loadStorageModule();
  const moduleHref = pathToFileURL(
    path.resolve(process.cwd(), 'dist', relativeDistPath),
  ).href;
  return await import(moduleHref);
};

test('toStorageEngineError normalizes unknown values without losing StorageEngineError', async () => {
  const { StorageEngineError, toStorageEngineError } = await importDistModule(
    'errors/index.js',
  );

  const existing = new StorageEngineError('already-normalized');
  assert.equal(
    toStorageEngineError(existing, 'fallback'),
    existing,
  );

  const wrappedError = toStorageEngineError(new Error('io failed'), 'File commit failed');
  assert.ok(wrappedError instanceof StorageEngineError);
  assert.equal(wrappedError.message, 'File commit failed: io failed');
  assert.ok(wrappedError.cause instanceof Error);
  assert.equal(wrappedError.cause?.message, 'io failed');

  const wrappedUnknown = toStorageEngineError('non-error', 'File commit failed');
  assert.ok(wrappedUnknown instanceof StorageEngineError);
  assert.equal(wrappedUnknown.message, 'File commit failed');
  assert.equal(wrappedUnknown.cause, 'non-error');
});

test('file durability modules use shared storage error normalization helper', async () => {
  const fileBackendSource = await readFile(
    path.resolve(process.cwd(), 'src/storage/drivers/file/fileBackend.ts'),
    'utf8',
  );
  const snapshotSource = await readFile(
    path.resolve(process.cwd(), 'src/storage/drivers/file/fileBackendSnapshot.ts'),
    'utf8',
  );

  assert.doesNotMatch(fileBackendSource, /const throwStorageError =/);
  assert.doesNotMatch(snapshotSource, /const throwStorageError =/);
  assert.match(fileBackendSource, /toStorageEngineError\(/);
  assert.match(snapshotSource, /toStorageEngineError\(/);
  assert.match(
    snapshotSource,
    /PageCorruptionError already extends StorageEngineError[\s\S]*toStorageEngineError/i,
  );
});
