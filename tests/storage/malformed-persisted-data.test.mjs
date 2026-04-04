import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { importDistModule } from '../load-module.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createSuccessfulIdbRequest = (result) => {
  const request = {
    result,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => {
    request.onsuccess?.({ target: request });
  });
  return request;
};

const createMockIDBFactoryWithPreloadedMeta = (metaRecord) => {
  const databases = new Map();

  return {
    open: (databaseName, version) => {
      const request = {
        result: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      queueMicrotask(() => {
        let dbEntry = databases.get(databaseName);
        const needsUpgrade = !dbEntry || dbEntry.version < version;

        if (!dbEntry) {
          dbEntry = { version, stores: new Map() };
          databases.set(databaseName, dbEntry);
        }

        const objectStoreNames = {
          contains: (name) => dbEntry.stores.has(name),
        };

        const db = {
          objectStoreNames,
          createObjectStore: (name) => {
            const store = new Map();
            if (name === '_meta' && metaRecord !== undefined) {
              store.set('config', metaRecord);
            }
            dbEntry.stores.set(name, store);
          },
          transaction: (storeNames, mode) => {
            const tx = {
              oncomplete: null,
              onerror: null,
              objectStore: (name) => {
                const store = dbEntry.stores.get(name);
                if (!store) {
                  throw new Error(`Object store "${name}" not found.`);
                }
                return {
                  get: (key) => createSuccessfulIdbRequest(store.get(key) ?? undefined),
                  getAll: () => createSuccessfulIdbRequest([...store.values()]),
                  put: (value, key) => {
                    store.set(key, value);
                    return createSuccessfulIdbRequest(undefined);
                  },
                  clear: () => {
                    store.clear();
                    return createSuccessfulIdbRequest(undefined);
                  },
                };
              },
            };
            queueMicrotask(() => {
              queueMicrotask(() => {
                tx.oncomplete?.();
              });
            });
            return tx;
          },
          close: () => {},
        };

        if (needsUpgrade) {
          dbEntry.version = version;
          request.result = db;
          request.onupgradeneeded?.({ target: request });
        }

        request.result = db;
        request.onsuccess?.({ target: request });
      });

      return request;
    },
  };
};

const createMockLocalStorage = (initialData = {}) => {
  const store = new Map(Object.entries(initialData));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

const createMockSyncStorageArea = (initialData = {}) => {
  const store = new Map(Object.entries(initialData));
  return {
    get: async (keys) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of normalizedKeys) {
        if (store.has(key)) {
          result[key] = store.get(key);
        }
      }
      return result;
    },
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
    remove: async (keys) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      for (const key of normalizedKeys) {
        store.delete(key);
      }
    },
  };
};

// ---------------------------------------------------------------------------
// localStorage malformed data
// ---------------------------------------------------------------------------

describe('malformed persisted data – localStorage', () => {
  test('invalid JSON manifest throws StorageEngineError', async () => {
    const { LocalStorageBackendController } = await importDistModule(
      'storage/drivers/localStorage/localStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockLS = createMockLocalStorage({
      'frostpillar:ls:default:manifest': '{not valid json',
    });

    const previousLocalStorage = globalThis.localStorage;
    globalThis.localStorage = mockLS;

    try {
      assert.throws(
        () => LocalStorageBackendController.create({
          config: {},
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('malformed'));
          return true;
        },
      );
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previousLocalStorage;
      }
    }
  });

  test('manifest with wrong magic/version throws StorageEngineError', async () => {
    const { LocalStorageBackendController } = await importDistModule(
      'storage/drivers/localStorage/localStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const manifest = JSON.stringify({
      magic: 'WRONG_MAGIC',
      version: 999,
      activeGeneration: 0,
      commitId: 0,
      chunkCount: 0,
    });

    const mockLS = createMockLocalStorage({
      'frostpillar:ls:default:manifest': manifest,
    });

    const previousLocalStorage = globalThis.localStorage;
    globalThis.localStorage = mockLS;

    try {
      assert.throws(
        () => LocalStorageBackendController.create({
          config: {},
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('magic/version'));
          return true;
        },
      );
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previousLocalStorage;
      }
    }
  });

  test('chunk data with invalid JSON throws StorageEngineError', async () => {
    const { LocalStorageBackendController } = await importDistModule(
      'storage/drivers/localStorage/localStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const manifest = JSON.stringify({
      magic: 'FPLS_META',
      version: 2,
      activeGeneration: 1,
      commitId: 1,
      chunkCount: 1,
    });

    const mockLS = createMockLocalStorage({
      'frostpillar:ls:default:manifest': manifest,
      'frostpillar:ls:default:g:1:chunk:0': '{broken json',
    });

    const previousLocalStorage = globalThis.localStorage;
    globalThis.localStorage = mockLS;

    try {
      assert.throws(
        () => LocalStorageBackendController.create({
          config: {},
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('chunk data JSON is malformed'));
          return true;
        },
      );
    } finally {
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previousLocalStorage;
      }
    }
  });

});

// ---------------------------------------------------------------------------
// syncStorage malformed data
// ---------------------------------------------------------------------------

describe('malformed persisted data – syncStorage', () => {
  test('manifest that is not an object throws StorageEngineError', async () => {
    const { SyncStorageBackendController } = await importDistModule(
      'storage/drivers/syncStorage/syncStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockSyncArea = createMockSyncStorageArea({
      'frostpillar:sync:default:manifest': 'not-an-object',
    });

    const previousBrowser = globalThis.browser;
    globalThis.browser = { storage: { sync: mockSyncArea } };

    try {
      await assert.rejects(
        SyncStorageBackendController.create({
          config: {},
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('manifest must be an object'));
          return true;
        },
      );
    } finally {
      if (previousBrowser === undefined) {
        delete globalThis.browser;
      } else {
        globalThis.browser = previousBrowser;
      }
    }
  });

  test('syncStorage chunk data with truncated JSON throws StorageEngineError', async () => {
    const { SyncStorageBackendController } = await importDistModule(
      'storage/drivers/syncStorage/syncStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const manifest = {
      magic: 'FPSYNC_META',
      version: 2,
      activeGeneration: 1,
      commitId: 1,
      chunkCount: 1,
    };

    const mockSyncArea = createMockSyncStorageArea({
      'frostpillar:sync:default:manifest': manifest,
      'frostpillar:sync:default:g:1:chunk:0': '[{"truncated',
    });

    const previousBrowser = globalThis.browser;
    globalThis.browser = { storage: { sync: mockSyncArea } };

    try {
      await assert.rejects(
        SyncStorageBackendController.create({
          config: {},
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('chunk data JSON is malformed'));
          return true;
        },
      );
    } finally {
      if (previousBrowser === undefined) {
        delete globalThis.browser;
      } else {
        globalThis.browser = previousBrowser;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// IndexedDB malformed metadata
// ---------------------------------------------------------------------------

describe('malformed persisted data – IndexedDB', () => {
  test('metadata with wrong magic/version throws StorageEngineError', async () => {
    const { IndexedDBBackendController } = await importDistModule(
      'storage/drivers/IndexedDB/indexedDBBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockFactory = createMockIDBFactoryWithPreloadedMeta({
      magic: 'WRONG',
      version: 99,
      commitId: 0,
    });

    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = mockFactory;

    try {
      await assert.rejects(
        IndexedDBBackendController.create({
          config: {
            databaseName: 'test-malformed',
            objectStoreName: 'events',
            version: 1,
          },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('magic/version'));
          return true;
        },
      );
    } finally {
      if (previousIndexedDB === undefined) {
        delete globalThis.indexedDB;
      } else {
        globalThis.indexedDB = previousIndexedDB;
      }
    }
  });
});
