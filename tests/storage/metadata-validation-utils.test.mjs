import assert from 'node:assert/strict';
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

test('parseNonNegativeSafeInteger returns safe integer values unchanged', async () => {
  const { parseNonNegativeSafeInteger } = await importDistModule('validation/metadata.js');

  const parsed = parseNonNegativeSafeInteger(42, 'manifest.commitId', 'localStorage');

  assert.equal(parsed, 42);
});

test('parseNonNegativeSafeInteger throws StorageEngineError with backend context', async () => {
  const { StorageEngineError } = await importDistModule('errors/index.js');
  const { parseNonNegativeSafeInteger } = await importDistModule('validation/metadata.js');

  assert.throws(() => {
    parseNonNegativeSafeInteger(-1, 'meta.commitId', 'IndexedDB');
  }, (error) => {
    assert.ok(error instanceof StorageEngineError);
    assert.match(
      error.message,
      /IndexedDB meta\.commitId must be a non-negative safe integer\./,
    );
    return true;
  });
});
