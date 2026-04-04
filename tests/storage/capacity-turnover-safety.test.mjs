import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadStorageModule } from '../load-module.mjs';

const loadCapacityModule = async () => {
  await loadStorageModule();
  return await import(
    pathToFileURL(
      path.resolve(process.cwd(), 'dist/storage/backend/capacity.js'),
    ).href
  );
};

const loadErrorModule = async () => {
  await loadStorageModule();
  return await import(
    pathToFileURL(path.resolve(process.cwd(), 'dist/errors/index.js')).href
  );
};

test('turnover capacity enforcement rejects non-progressing zero-byte evictions', async () => {
  const { enforceCapacityPolicy } = await loadCapacityModule();
  const { IndexCorruptionError } = await loadErrorModule();
  const capacityState = {
    maxSizeBytes: 32,
    policy: 'turnover',
  };

  let evictionCalls = 0;
  const evictOldestRecord = () => {
    evictionCalls += 1;
    if (evictionCalls > 3) {
      throw new Error('sentinel: turnover loop did not stop');
    }
    return 0;
  };

  assert.throws(() => {
    enforceCapacityPolicy(
      capacityState,
      32,
      1,
      () => 1,
      evictOldestRecord,
    );
  }, IndexCorruptionError);
  assert.equal(evictionCalls, 1);
});
