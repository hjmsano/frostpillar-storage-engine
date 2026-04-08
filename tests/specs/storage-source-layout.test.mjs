import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const resolveFromRepo = (relativePath) => {
  return path.resolve(process.cwd(), relativePath);
};

const assertPathExists = async (relativePath) => {
  const absolutePath = resolveFromRepo(relativePath);
  await assert.doesNotReject(async () => {
    await access(absolutePath);
  }, `Expected path to exist: ${relativePath}`);
};

const assertPathMissing = async (relativePath) => {
  const absolutePath = resolveFromRepo(relativePath);
  await assert.rejects(async () => {
    await access(absolutePath);
  }, `Expected path to be missing: ${relativePath}`);
};

test('storage sources are organized by responsibility directories', async () => {
  await assertPathExists('src/storage/datastore/Datastore.ts');
  await assertPathExists('src/storage/config/config.ts');
  await assertPathExists('src/storage/btree/recordKeyIndexBTree.ts');
  await assertPathExists('src/storage/drivers/file/fileBackend.ts');
  await assertPathExists(
    'src/storage/drivers/localStorage/localStorageBackend.ts',
  );
  await assertPathExists('src/storage/drivers/IndexedDB/indexedDBBackend.ts');
  await assertPathExists('src/storage/drivers/opfs/opfsBackend.ts');
  await assertPathExists(
    'src/storage/drivers/syncStorage/syncStorageBackend.ts',
  );
  await assertPathMissing('src/storage/record/recordId.ts');

  await assertPathMissing('src/storage/Datastore.ts');
  await assertPathMissing('src/storage/backend/backendBootstrap.ts');
  await assertPathMissing('src/storage/backend/browserBackendInit.ts');
  await assertPathMissing('src/storage/backendBootstrap.ts');
  await assertPathMissing('src/storage/query.ts');
  await assertPathMissing('src/storage/timeIndexBTree.ts');
  await assertPathMissing('src/storage/fileBackend.ts');
  await assertPathMissing('src/records/recordId.ts');
});
