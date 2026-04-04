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

const createSampleTreeJSON = () => ({
  version: 1,
  config: {},
  entries: [['k', { key: 'k', payload: { value: 'v' } }]],
});

const createEmptyTreeJSON = () => ({
  version: 1,
  config: {},
  entries: [],
});

test('syncStorage unknown-generation cleanup probes and removes in batches', async () => {
  const { cleanupGenerationChunks } = await importDistModule(
    'storage/drivers/syncStorage/syncStorageChunkMaintenance.js',
  );
  const getKeysCalls = [];
  const removeKeysCalls = [];
  const existingKeys = new Set(['g:7:0', 'g:7:2']);

  const state = {
    adapter: {
      getItems: async (keys) => {
        getKeysCalls.push([...keys]);
        const result = {};
        for (const key of keys) {
          if (existingKeys.has(key)) {
            result[key] = 'stale';
          }
        }
        return result;
      },
      removeItems: async (keys) => {
        removeKeysCalls.push([...keys]);
      },
    },
    maxChunks: 4,
  };

  await cleanupGenerationChunks(state, 7, null, (generation, index) => {
    return `g:${generation}:${index}`;
  });

  assert.equal(getKeysCalls.length, 1);
  assert.deepEqual(getKeysCalls[0], ['g:7:0', 'g:7:1', 'g:7:2', 'g:7:3']);
  assert.equal(removeKeysCalls.length, 1);
  assert.deepEqual(removeKeysCalls[0], ['g:7:0', 'g:7:2']);
});

test('syncStorage commit keeps write path when next-generation pre-cleanup fails', async () => {
  const { commitSyncStorageSnapshot, createSyncStorageBackendState } = await importDistModule(
    'storage/drivers/syncStorage/syncStorageBackend.js',
  );

  const cleanupFailure = new Error('cleanup transient failure');
  let setItemsCallCount = 0;
  const state = createSyncStorageBackendState(
    {
      getItems: async (keys) => {
        const result = {};
        for (const key of keys) {
          if (key.includes(':g:1:chunk:0')) {
            result[key] = 'stale';
          }
        }
        return result;
      },
      setItems: async () => {
        setItemsCallCount += 1;
      },
      removeItems: async () => {
        throw cleanupFailure;
      },
    },
    'frostpillar',
    'cleanup-best-effort',
    128,
    8,
    8192,
    102400,
    512,
  );

  await commitSyncStorageSnapshot(
    state,
    createSampleTreeJSON(),
  );

  assert.equal(setItemsCallCount, 1);
  assert.equal(state.commitId, 1);
  assert.equal(state.activeGeneration, 1);
});

test('syncStorage commit write failure preserves original cause', async () => {
  const { commitSyncStorageSnapshot, createSyncStorageBackendState } = await importDistModule(
    'storage/drivers/syncStorage/syncStorageBackend.js',
  );

  const originalWriteError = new Error('adapter write failed');
  const state = createSyncStorageBackendState(
    {
      getItems: async () => {
        return {};
      },
      setItems: async () => {
        throw originalWriteError;
      },
      removeItems: async () => {
      },
    },
    'frostpillar',
    'commit-cause',
    128,
    8,
    8192,
    102400,
    512,
  );

  await assert.rejects(
    commitSyncStorageSnapshot(state, createSampleTreeJSON()),
    (error) => {
      assert.equal(error.name, 'StorageEngineError');
      assert.equal(error.message, 'syncStorage write failed during commit.');
      assert.equal(error.cause, originalWriteError);
      return true;
    },
  );
});

test('syncStorage commit with empty records writes exactly one chunk', async () => {
  const { commitSyncStorageSnapshot, createSyncStorageBackendState } = await importDistModule(
    'storage/drivers/syncStorage/syncStorageBackend.js',
  );

  let writtenItems = null;
  const state = createSyncStorageBackendState(
    {
      getItems: async () => {
        return {};
      },
      setItems: async (items) => {
        writtenItems = items;
      },
      removeItems: async () => {
      },
    },
    'frostpillar',
    'empty-snapshot',
    256,
    8,
    8192,
    102400,
    512,
  );

  await commitSyncStorageSnapshot(state, createEmptyTreeJSON());

  assert.notEqual(writtenItems, null);
  const keys = Object.keys(writtenItems);
  const chunkKeys = keys.filter((key) => key.includes(':chunk:'));
  assert.equal(chunkKeys.length, 1);
  assert.deepEqual(chunkKeys, ['frostpillar:sync:empty-snapshot:g:1:chunk:0']);
  assert.equal(
    writtenItems['frostpillar:sync:empty-snapshot:manifest'].chunkCount,
    1,
  );
  assert.equal(
    typeof writtenItems['frostpillar:sync:empty-snapshot:g:1:chunk:0'],
    'string',
  );
});
