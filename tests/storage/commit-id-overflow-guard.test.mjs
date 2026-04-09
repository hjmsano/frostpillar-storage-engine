import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

test('localStorage commit rejects when commitId reaches MAX_SAFE_INTEGER', async () => {
  const { commitLocalStorageSnapshot, createLocalStorageBackendState } =
    await importDistModule(
      'storage/drivers/localStorage/localStorageBackend.js',
    );

  const store = new Map();
  const state = createLocalStorageBackendState(
    {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    { keyPrefix: 'fp', databaseKey: 'test' },
  );
  state.commitId = Number.MAX_SAFE_INTEGER;

  assert.throws(
    () => commitLocalStorageSnapshot(state, [], 0n),
    (error) => {
      assert.ok(error.message.includes('MAX_SAFE_INTEGER'));
      return true;
    },
  );
});

test('localStorage commit rejects when activeGeneration reaches MAX_SAFE_INTEGER', async () => {
  const { commitLocalStorageSnapshot, createLocalStorageBackendState } =
    await importDistModule(
      'storage/drivers/localStorage/localStorageBackend.js',
    );

  const store = new Map();
  const state = createLocalStorageBackendState(
    {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    { keyPrefix: 'fp', databaseKey: 'test' },
  );
  state.activeGeneration = Number.MAX_SAFE_INTEGER;

  assert.throws(
    () => commitLocalStorageSnapshot(state, [], 0n),
    (error) => {
      assert.ok(error.message.includes('MAX_SAFE_INTEGER'));
      return true;
    },
  );
});

test('file backend commit rejects when commitId reaches MAX_SAFE_INTEGER', async () => {
  const { commitFileBackendSnapshot } = await importDistModule(
    'storage/drivers/file/fileBackendSnapshot.js',
  );

  const backend = {
    commitId: Number.MAX_SAFE_INTEGER,
    baseFileName: 'test',
    directoryPath: '/tmp/frostpillar-test-overflow',
    sidecarPath: '/tmp/frostpillar-test-overflow/test.sidecar.json',
    activeDataFile: 'test.g.0',
    rootPageId: 0,
    nextPageId: 1,
    freePageHeadId: null,
  };

  assert.throws(
    () => commitFileBackendSnapshot(backend, [], 0n),
    (error) => {
      assert.ok(error.message.includes('MAX_SAFE_INTEGER'));
      return true;
    },
  );
});

test('syncStorage commit rejects when commitId reaches MAX_SAFE_INTEGER', async () => {
  const { commitSyncStorageSnapshot, createSyncStorageBackendState } =
    await importDistModule('storage/drivers/syncStorage/syncStorageBackend.js');

  const store = new Map();
  const state = createSyncStorageBackendState(
    {
      get: async (keys) => {
        const result = {};
        for (const key of keys) {
          const value = store.get(key);
          if (value !== undefined) result[key] = value;
        }
        return result;
      },
      set: async (items) => {
        for (const [key, value] of Object.entries(items)) {
          store.set(key, value);
        }
      },
      remove: async (keys) => {
        for (const key of keys) store.delete(key);
      },
    },
    { keyPrefix: 'fp', databaseKey: 'test' },
  );
  state.commitId = Number.MAX_SAFE_INTEGER;

  await assert.rejects(
    () => commitSyncStorageSnapshot(state, [], 0n),
    (error) => {
      assert.ok(error.message.includes('MAX_SAFE_INTEGER'));
      return true;
    },
  );
});
