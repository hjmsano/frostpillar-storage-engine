import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { importDistModule } from '../load-module.mjs';

// ---------------------------------------------------------------------------
// Helpers – file backend
// ---------------------------------------------------------------------------

const GENERATION_MAGIC = 'FPGE_DATA';
const SIDECAR_MAGIC = 'FPGE_META';
const FORMAT_VERSION = 2;

const createCorruptedFileBackend = (tempDir, treeJSONValue) => {
  const baseFileName = 'test-db';
  const activeDataFile = `${baseFileName}.g.1`;
  const sidecarPath = join(tempDir, `${baseFileName}.meta.json`);

  const sidecar = {
    magic: SIDECAR_MAGIC,
    version: FORMAT_VERSION,
    activeDataFile,
    commitId: 1,
  };
  writeFileSync(sidecarPath, JSON.stringify(sidecar));

  const generation = {
    magic: GENERATION_MAGIC,
    version: FORMAT_VERSION,
    treeJSON: treeJSONValue,
  };
  writeFileSync(join(tempDir, activeDataFile), JSON.stringify(generation));

  return {
    directoryPath: tempDir,
    baseFileName,
    activeDataFile,
    sidecarPath,
    commitId: 1,
    lockAcquired: false,
  };
};

// ---------------------------------------------------------------------------
// Helpers – localStorage
// ---------------------------------------------------------------------------

const createMockLocalStorage = (initialData = {}) => {
  const store = new Map(Object.entries(initialData));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

const LS_MAGIC = 'FPLS_META';
const LS_VERSION = 2;

const buildLocalStorageWithTreeJSON = (treeJSONString) => {
  const manifest = JSON.stringify({
    magic: LS_MAGIC,
    version: LS_VERSION,
    activeGeneration: 1,
    commitId: 1,
    chunkCount: 1,
  });
  return createMockLocalStorage({
    'frostpillar:ls:default:manifest': manifest,
    'frostpillar:ls:default:g:1:chunk:0': treeJSONString,
  });
};

// ---------------------------------------------------------------------------
// Helpers – IndexedDB
// ---------------------------------------------------------------------------

const IDB_MAGIC = 'FPIDB_META';
const IDB_VERSION_VALUE = 2;

const createMockIDBFactoryWithTreeJSON = (treeJSONValue) => {
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
            if (name === '_meta') {
              store.set('config', {
                magic: IDB_MAGIC,
                version: IDB_VERSION_VALUE,
                commitId: 1,
                treeJSON: treeJSONValue,
              });
            }
            dbEntry.stores.set(name, store);
          },
          transaction: (storeNames, _mode) => {
            const tx = {
              oncomplete: null,
              onerror: null,
              objectStore: (name) => {
                const store = dbEntry.stores.get(name);
                if (!store) {
                  throw new Error(`Object store "${name}" not found.`);
                }
                const createSuccessfulRequest = (result) => {
                  const req = { result, onsuccess: null, onerror: null };
                  queueMicrotask(() => { req.onsuccess?.({ target: req }); });
                  return req;
                };
                return {
                  get: (key) => createSuccessfulRequest(store.get(key) ?? undefined),
                  put: (value, key) => {
                    store.set(key, value);
                    return createSuccessfulRequest(undefined);
                  },
                };
              },
            };
            queueMicrotask(() => {
              queueMicrotask(() => { tx.oncomplete?.(); });
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

// ---------------------------------------------------------------------------
// Helpers – syncStorage
// ---------------------------------------------------------------------------

const createMockSyncStorageArea = (initialData = {}) => {
  const store = new Map(Object.entries(initialData));
  return {
    get: async (keys) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of normalizedKeys) {
        if (store.has(key)) result[key] = store.get(key);
      }
      return result;
    },
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    remove: async (keys) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      for (const key of normalizedKeys) store.delete(key);
    },
  };
};

const SYNC_MAGIC = 'FPSYNC_META';
const SYNC_VERSION = 2;

const buildSyncStorageWithTreeJSON = (treeJSONValue) => {
  const manifest = {
    magic: SYNC_MAGIC,
    version: SYNC_VERSION,
    activeGeneration: 1,
    commitId: 1,
    chunkCount: 1,
  };
  // The chunk value is stored as a string – we JSON.stringify treeJSON to simulate
  return createMockSyncStorageArea({
    'frostpillar:sync:default:manifest': manifest,
    'frostpillar:sync:default:g:1:chunk:0': JSON.stringify(treeJSONValue),
  });
};

// ---------------------------------------------------------------------------
// S2: file backend
// ---------------------------------------------------------------------------

describe('S2: treeJSON structural validation – file backend', () => {
  test('loadFileSnapshot throws PageCorruptionError when treeJSON is null', async () => {
    const { loadFileSnapshot } = await importDistModule(
      'storage/drivers/file/fileBackendSnapshot.js',
    );
    const { PageCorruptionError } = await importDistModule('errors/index.js');

    const tempDir = mkdtempSync(join(tmpdir(), 'fp-treejson-test-'));
    try {
      const backend = createCorruptedFileBackend(tempDir, null);
      assert.throws(
        () => loadFileSnapshot(backend),
        (error) => {
          assert.ok(error instanceof PageCorruptionError, `Expected PageCorruptionError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
          return true;
        },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('loadFileSnapshot throws PageCorruptionError when treeJSON is an array', async () => {
    const { loadFileSnapshot } = await importDistModule(
      'storage/drivers/file/fileBackendSnapshot.js',
    );
    const { PageCorruptionError } = await importDistModule('errors/index.js');

    const tempDir = mkdtempSync(join(tmpdir(), 'fp-treejson-test-'));
    try {
      const backend = createCorruptedFileBackend(tempDir, []);
      assert.throws(
        () => loadFileSnapshot(backend),
        (error) => {
          assert.ok(error instanceof PageCorruptionError, `Expected PageCorruptionError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'));
          return true;
        },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('loadFileSnapshot throws PageCorruptionError when treeJSON is a string', async () => {
    const { loadFileSnapshot } = await importDistModule(
      'storage/drivers/file/fileBackendSnapshot.js',
    );
    const { PageCorruptionError } = await importDistModule('errors/index.js');

    const tempDir = mkdtempSync(join(tmpdir(), 'fp-treejson-test-'));
    try {
      const backend = createCorruptedFileBackend(tempDir, 'not-an-object');
      assert.throws(
        () => loadFileSnapshot(backend),
        (error) => {
          assert.ok(error instanceof PageCorruptionError, `Expected PageCorruptionError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'));
          return true;
        },
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// S2: localStorage backend
// ---------------------------------------------------------------------------

describe('S2: treeJSON structural validation – localStorage backend', () => {
  test('loadLocalStorageSnapshot throws StorageEngineError when treeJSON is null', async () => {
    const { LocalStorageBackendController } = await importDistModule(
      'storage/drivers/localStorage/localStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockLS = buildLocalStorageWithTreeJSON('null');
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
          assert.ok(error instanceof StorageEngineError, `Expected StorageEngineError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
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

  test('loadLocalStorageSnapshot throws StorageEngineError when treeJSON is an array', async () => {
    const { LocalStorageBackendController } = await importDistModule(
      'storage/drivers/localStorage/localStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockLS = buildLocalStorageWithTreeJSON('[]');
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
          assert.ok(error instanceof StorageEngineError, `Expected StorageEngineError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
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
// S2: IndexedDB backend
// ---------------------------------------------------------------------------

describe('S2: treeJSON structural validation – IndexedDB backend', () => {
  test('loadIndexedDBSnapshot throws StorageEngineError when treeJSON is null', async () => {
    const { IndexedDBBackendController } = await importDistModule(
      'storage/drivers/IndexedDB/indexedDBBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockFactory = createMockIDBFactoryWithTreeJSON(null);
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = mockFactory;

    try {
      await assert.rejects(
        IndexedDBBackendController.create({
          config: {
            databaseName: 'test-treejson-null',
            objectStoreName: 'events',
            version: 1,
          },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError, `Expected StorageEngineError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
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

  test('loadIndexedDBSnapshot throws StorageEngineError when treeJSON is an array', async () => {
    const { IndexedDBBackendController } = await importDistModule(
      'storage/drivers/IndexedDB/indexedDBBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockFactory = createMockIDBFactoryWithTreeJSON([]);
    const previousIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = mockFactory;

    try {
      await assert.rejects(
        IndexedDBBackendController.create({
          config: {
            databaseName: 'test-treejson-array',
            objectStoreName: 'events',
            version: 1,
          },
          autoCommit: { frequency: 'immediate' },
          getSnapshot: () => ({ treeJSON: { version: 1, config: {}, entries: [] } }),
          onAutoCommitError: () => {},
        }),
        (error) => {
          assert.ok(error instanceof StorageEngineError, `Expected StorageEngineError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
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

// ---------------------------------------------------------------------------
// S2: syncStorage backend
// ---------------------------------------------------------------------------

describe('S2: treeJSON structural validation – syncStorage backend', () => {
  test('loadSyncStorageSnapshot throws StorageEngineError when treeJSON is null', async () => {
    const { SyncStorageBackendController } = await importDistModule(
      'storage/drivers/syncStorage/syncStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockSyncArea = buildSyncStorageWithTreeJSON(null);
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
          assert.ok(error instanceof StorageEngineError, `Expected StorageEngineError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
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

  test('loadSyncStorageSnapshot throws StorageEngineError when treeJSON is an array', async () => {
    const { SyncStorageBackendController } = await importDistModule(
      'storage/drivers/syncStorage/syncStorageBackendController.js',
    );
    const { StorageEngineError } = await importDistModule('errors/index.js');

    const mockSyncArea = buildSyncStorageWithTreeJSON([]);
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
          assert.ok(error instanceof StorageEngineError, `Expected StorageEngineError, got: ${error.constructor.name}: ${error.message}`);
          assert.ok(error.message.includes('treeJSON'), `Expected message to include 'treeJSON', got: ${error.message}`);
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
