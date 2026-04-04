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

const createFailedIdbRequest = (errorMessage) => {
  const request = {
    result: undefined,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => {
    request.onerror?.({ target: { error: { message: errorMessage } } });
  });
  return request;
};

const createMockIDBFactory = () => {
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
            dbEntry.stores.set(name, new Map());
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
            // Fire oncomplete after all microtasks from put/clear/get settle
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

const createNotFoundError = () => {
  const error = new Error('NotFound');
  error.name = 'NotFoundError';
  return error;
};

const createMockOpfsDirectory = (files) => {
  const store = files instanceof Map ? files : new Map(Object.entries(files));
  return {
    getDirectoryHandle: async (_name, _options) => {
      return createMockOpfsDirectory({});
    },
    getFileHandle: async (name, options = {}) => {
      if (!store.has(name)) {
        if (options.create === true) {
          store.set(name, '');
        } else {
          throw createNotFoundError();
        }
      }
      return {
        getFile: async () => ({
          text: async () => store.get(name),
        }),
        createWritable: async () => ({
          write: async (data) => {
            store.set(name, String(data));
          },
          close: async () => {},
        }),
      };
    },
    removeEntry: async (name) => {
      store.delete(name);
    },
  };
};

const createMockOpfsStorageRoot = (directory) => {
  return {
    getDirectory: async () => directory,
  };
};

const createMockSyncStorageArea = () => {
  const store = new Map();
  return {
    get: async (keys) => {
      const normalizedKeys = keys === null
        ? Array.from(store.keys())
        : Array.isArray(keys)
          ? keys
          : [keys];
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

const makeRecord = (key, payload) => {
  return { key, payload };
};

const makeTreeJSON = (...records) => ({
  version: 1,
  config: { maxLeafEntries: 32, maxBranchChildren: 33, duplicateKeys: 'allow', enableEntryIdLookup: true, autoScale: false },
  entries: records.map((r) => [r.key, r]),
});

const loadModules = async () => {};

// ---------------------------------------------------------------------------
// IndexedDB backend
// ---------------------------------------------------------------------------

describe('browser backend integration', () => {
  test('IndexedDB: create returns empty initial state on fresh database', async () => {
    await loadModules();
    const { IndexedDBBackendController } = await importDistModule(
      'storage/drivers/IndexedDB/indexedDBBackendController.js',
    );

    const mockFactory = createMockIDBFactory();
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = mockFactory;

    try {
      const { controller, initialTreeJSON, initialCurrentSizeBytes } =
        await IndexedDBBackendController.create({
          config: {
            databaseName: 'test-idb',
            objectStoreName: 'events',
            version: 1,
          },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({
            treeJSON: makeTreeJSON(),
          }),
          onAutoCommitError: () => {},
        });

      assert.equal(initialTreeJSON, null);
      assert.equal(initialCurrentSizeBytes, 0);
      assert.ok(controller);

      await controller.close();
    } finally {
      if (previousIndexedDB === undefined) {
        delete globalThis.indexedDB;
      } else {
        globalThis.indexedDB = previousIndexedDB;
      }
    }
  });

  test('IndexedDB: commit then re-create restores records', async () => {
    await loadModules();
    const { IndexedDBBackendController } = await importDistModule(
      'storage/drivers/IndexedDB/indexedDBBackendController.js',
    );

    const mockFactory = createMockIDBFactory();
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = mockFactory;

    try {
      const record1 = makeRecord('alpha', { value: 'one' });
      const record2 = makeRecord('beta', { value: 'two' });
      const snapshotTreeJSON = makeTreeJSON(record1, record2);

      // First session: create, commit, close
      const first = await IndexedDBBackendController.create({
        config: {
          databaseName: 'test-idb-persist',
          objectStoreName: 'events',
          version: 1,
        },
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: snapshotTreeJSON,
        }),
        onAutoCommitError: () => {},
      });

      await first.controller.commitNow();
      await first.controller.close();

      // Second session: re-create and verify restored state
      const second = await IndexedDBBackendController.create({
        config: {
          databaseName: 'test-idb-persist',
          objectStoreName: 'events',
          version: 1,
        },
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: makeTreeJSON(),
        }),
        onAutoCommitError: () => {},
      });

      assert.ok(second.initialTreeJSON !== null);
      assert.equal(second.initialTreeJSON.entries.length, 2);
      assert.equal(second.initialTreeJSON.entries[0][1].key, 'alpha');
      assert.deepStrictEqual(second.initialTreeJSON.entries[0][1].payload, { value: 'one' });
      assert.equal(second.initialTreeJSON.entries[1][1].key, 'beta');
      assert.deepStrictEqual(second.initialTreeJSON.entries[1][1].payload, { value: 'two' });
      assert.ok(second.initialCurrentSizeBytes > 0);

      await second.controller.close();
    } finally {
      if (previousIndexedDB === undefined) {
        delete globalThis.indexedDB;
      } else {
        globalThis.indexedDB = previousIndexedDB;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // OPFS backend
  // ---------------------------------------------------------------------------

  test('OPFS: create returns empty initial state on fresh directory', async () => {
    await loadModules();
    const { OpfsBackendController } = await importDistModule(
      'storage/drivers/opfs/opfsBackendController.js',
    );

    const mockDir = createMockOpfsDirectory({});
    const mockStorageRoot = createMockOpfsStorageRoot(mockDir);
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: mockStorageRoot },
      configurable: true,
      writable: true,
    });

    try {
      const { controller, initialTreeJSON, initialCurrentSizeBytes } =
        await OpfsBackendController.create({
          config: { directoryName: 'test-opfs' },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({
            treeJSON: makeTreeJSON(),
          }),
          onAutoCommitError: () => {},
        });

      assert.equal(initialTreeJSON, null);
      assert.equal(initialCurrentSizeBytes, 0);
      assert.ok(controller);

      await controller.close();
    } finally {
      if (originalNavigatorDescriptor !== undefined) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
    }
  });

  test('OPFS: commit writes data and meta files, re-load restores records', async () => {
    await loadModules();
    const { OpfsBackendController } = await importDistModule(
      'storage/drivers/opfs/opfsBackendController.js',
    );

    // Shared file store so both sessions see the same data
    const sharedFiles = new Map();
    const createSharedDir = () => createMockOpfsDirectory(sharedFiles);
    const mockStorageRoot = {
      getDirectory: async () => ({
        getDirectoryHandle: async (_name, _options) => createSharedDir(),
      }),
    };

    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: mockStorageRoot },
      configurable: true,
      writable: true,
    });

    try {
      const record1 = makeRecord('gamma', { n: 1 });
      const record2 = makeRecord('delta', { n: 2 });
      const snapshotTreeJSON = makeTreeJSON(record1, record2);

      // First session: create, commit, close
      const first = await OpfsBackendController.create({
        config: { directoryName: 'test-opfs-persist' },
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: snapshotTreeJSON,
        }),
        onAutoCommitError: () => {},
      });

      await first.controller.commitNow();
      await first.controller.close();

      // Second session: re-create and verify restored state
      const second = await OpfsBackendController.create({
        config: { directoryName: 'test-opfs-persist' },
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: makeTreeJSON(),
        }),
        onAutoCommitError: () => {},
      });

      assert.ok(second.initialTreeJSON !== null);
      assert.equal(second.initialTreeJSON.entries.length, 2);
      // Entries are stored in BTree order (by key): delta < gamma
      const entryMap = Object.fromEntries(second.initialTreeJSON.entries.map(([k, v]) => [k, v]));
      assert.deepStrictEqual(entryMap['gamma'].payload, { n: 1 });
      assert.deepStrictEqual(entryMap['delta'].payload, { n: 2 });
      assert.ok(second.initialCurrentSizeBytes > 0);

      await second.controller.close();
    } finally {
      if (originalNavigatorDescriptor !== undefined) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // syncStorage backend
  // ---------------------------------------------------------------------------

  test('syncStorage: create returns empty initial state on fresh storage', async () => {
    await loadModules();
    const { SyncStorageBackendController } = await importDistModule(
      'storage/drivers/syncStorage/syncStorageBackendController.js',
    );

    const syncArea = createMockSyncStorageArea();
    const previousBrowser = globalThis.browser;
    const previousChrome = globalThis.chrome;
    globalThis.browser = { storage: { sync: syncArea } };
    delete globalThis.chrome;

    try {
      const { controller, initialTreeJSON, initialCurrentSizeBytes } =
        await SyncStorageBackendController.create({
          config: {
            keyPrefix: 'fp-test',
            databaseKey: 'sync-fresh',
            maxChunkChars: 6000,
            maxChunks: 511,
            maxItemBytes: 8192,
            maxTotalBytes: 102400,
            maxItems: 512,
          },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({
            treeJSON: makeTreeJSON(),
          }),
          onAutoCommitError: () => {},
        });

      assert.equal(initialTreeJSON, null);
      assert.equal(initialCurrentSizeBytes, 0);
      assert.ok(controller);

      await controller.close();
    } finally {
      if (previousBrowser === undefined) {
        delete globalThis.browser;
      } else {
        globalThis.browser = previousBrowser;
      }
      if (previousChrome === undefined) {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = previousChrome;
      }
    }
  });

  test('syncStorage: commit then re-create restores records', async () => {
    await loadModules();
    const { SyncStorageBackendController } = await importDistModule(
      'storage/drivers/syncStorage/syncStorageBackendController.js',
    );

    const syncArea = createMockSyncStorageArea();
    const previousBrowser = globalThis.browser;
    const previousChrome = globalThis.chrome;
    globalThis.browser = { storage: { sync: syncArea } };
    delete globalThis.chrome;

    const syncConfig = {
      keyPrefix: 'fp-test',
      databaseKey: 'sync-persist',
      maxChunkChars: 6000,
      maxChunks: 511,
      maxItemBytes: 8192,
      maxTotalBytes: 102400,
      maxItems: 512,
    };

    try {
      const record1 = makeRecord('epsilon', { msg: 'hello' });
      const record2 = makeRecord('zeta', { msg: 'world' });
      const snapshotTreeJSON = makeTreeJSON(record1, record2);

      // First session: create, commit, close
      const first = await SyncStorageBackendController.create({
        config: syncConfig,
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: snapshotTreeJSON,
        }),
        onAutoCommitError: () => {},
      });

      await first.controller.commitNow();
      await first.controller.close();

      // Second session: re-create and verify restored state
      const second = await SyncStorageBackendController.create({
        config: syncConfig,
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: makeTreeJSON(),
        }),
        onAutoCommitError: () => {},
      });

      assert.ok(second.initialTreeJSON !== null);
      assert.equal(second.initialTreeJSON.entries.length, 2);
      const entryMap = Object.fromEntries(second.initialTreeJSON.entries.map(([k, v]) => [k, v]));
      assert.deepStrictEqual(entryMap['epsilon'].payload, { msg: 'hello' });
      assert.deepStrictEqual(entryMap['zeta'].payload, { msg: 'world' });
      assert.ok(second.initialCurrentSizeBytes > 0);

      await second.controller.close();
    } finally {
      if (previousBrowser === undefined) {
        delete globalThis.browser;
      } else {
        globalThis.browser = previousBrowser;
      }
      if (previousChrome === undefined) {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = previousChrome;
      }
    }
  });

  test('IndexedDB: request error during load propagates as StorageEngineError', async () => {
    await loadModules();
    const { IndexedDBBackendController } = await importDistModule(
      'storage/drivers/IndexedDB/indexedDBBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    // Build a mock factory where getAll returns a failed request
    const databases = new Map();
    const mockFactory = {
      open: (databaseName, version) => {
        const request = {
          result: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };

        queueMicrotask(() => {
          let dbEntry = databases.get(databaseName);
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
              dbEntry.stores.set(name, new Map());
            },
            transaction: (storeNames, mode) => {
              const tx = {
                oncomplete: null,
                onerror: null,
                objectStore: (name) => {
                  return {
                    get: (key) => createFailedIdbRequest('Simulated read error'),
                    getAll: () => createSuccessfulIdbRequest([]),
                    put: (value, key) => createSuccessfulIdbRequest(undefined),
                    clear: () => createSuccessfulIdbRequest(undefined),
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

          const needsUpgrade = !databases.has(databaseName) || dbEntry.version < version;
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

    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = mockFactory;

    try {
      await assert.rejects(
        IndexedDBBackendController.create({
          config: {
            databaseName: 'test-idb-error',
            objectStoreName: 'events',
            version: 1,
          },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({
            treeJSON: makeTreeJSON(),
          }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError);
          assert.ok(error.message.includes('Simulated read error'));
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
