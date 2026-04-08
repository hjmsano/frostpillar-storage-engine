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

const createMockLocalStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
};

const lsManifestKey = (keyPrefix, databaseKey) =>
  `${keyPrefix}:ls:${databaseKey}:manifest`;

const lsChunkKey = (keyPrefix, databaseKey, generation, index) =>
  `${keyPrefix}:ls:${databaseKey}:g:${generation}:chunk:${index}`;

const syncManifestKey = (keyPrefix, databaseKey) =>
  `${keyPrefix}:sync:${databaseKey}:manifest`;

const syncChunkKey = (keyPrefix, databaseKey, generation, index) =>
  `${keyPrefix}:sync:${databaseKey}:g:${generation}:chunk:${index}`;

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

const createMockIndexedDbHandle = (records, meta) => {
  return {
    transaction: () => {
      const tx = {
        oncomplete: null,
        onerror: null,
        objectStore: (name) => {
          if (name === 'events') {
            return {
              getAll: () => createSuccessfulIdbRequest(records),
            };
          }
          if (name === '_meta') {
            return {
              get: () => createSuccessfulIdbRequest(meta),
            };
          }
          throw new Error(`Unexpected object store ${name}`);
        },
      };
      queueMicrotask(() => {
        queueMicrotask(() => {
          tx.oncomplete?.();
        });
      });
      return tx;
    },
  };
};

const createMockSyncStorageArea = () => {
  const store = new Map();
  return {
    get: async (keys) => {
      const normalizedKeys =
        keys === null
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

const createNotFoundError = () => {
  const error = new Error('NotFound');
  error.name = 'NotFoundError';
  return error;
};

const createMockOpfsDirectory = (files) => {
  const store = new Map(Object.entries(files));
  return {
    getDirectoryHandle: async () => {
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

test('loadLocalStorageSnapshot rejects non-numeric activeGeneration in manifest', async () => {
  const { StorageEngineError } = await loadStorageModule();
  const { createLocalStorageBackendState, loadLocalStorageSnapshot } =
    await importDistModule(
      'storage/drivers/localStorage/localStorageBackend.js',
    );

  const adapter = createMockLocalStorage();
  const keyPrefix = 'frostpillar';
  const databaseKey = 'default';
  const state = createLocalStorageBackendState(
    adapter,
    keyPrefix,
    databaseKey,
    4096,
    8,
  );

  adapter.setItem(
    lsManifestKey(keyPrefix, databaseKey),
    JSON.stringify({
      magic: 'FPLS_META',
      version: 2,
      activeGeneration: 'broken-generation',
      commitId: 0,
    }),
  );
  adapter.setItem(
    lsChunkKey(keyPrefix, databaseKey, 'broken-generation', 0),
    JSON.stringify({ version: 1, config: {}, entries: [] }),
  );

  assert.throws(() => {
    loadLocalStorageSnapshot(state);
  }, StorageEngineError);
});

test('loadLocalStorageSnapshot rejects negative commitId in manifest', async () => {
  const { StorageEngineError } = await loadStorageModule();
  const { createLocalStorageBackendState, loadLocalStorageSnapshot } =
    await importDistModule(
      'storage/drivers/localStorage/localStorageBackend.js',
    );

  const adapter = createMockLocalStorage();
  const keyPrefix = 'frostpillar';
  const databaseKey = 'default';
  const state = createLocalStorageBackendState(
    adapter,
    keyPrefix,
    databaseKey,
    4096,
    8,
  );

  adapter.setItem(
    lsManifestKey(keyPrefix, databaseKey),
    JSON.stringify({
      magic: 'FPLS_META',
      version: 2,
      activeGeneration: 0,
      commitId: -1,
    }),
  );
  adapter.setItem(
    lsChunkKey(keyPrefix, databaseKey, 0, 0),
    JSON.stringify({ version: 1, config: {}, entries: [] }),
  );

  assert.throws(() => {
    loadLocalStorageSnapshot(state);
  }, StorageEngineError);
});

test('loadLocalStorageSnapshot rejects non-numeric chunkCount in manifest', async () => {
  const { StorageEngineError } = await loadStorageModule();
  const { createLocalStorageBackendState, loadLocalStorageSnapshot } =
    await importDistModule(
      'storage/drivers/localStorage/localStorageBackend.js',
    );

  const adapter = createMockLocalStorage();
  const keyPrefix = 'frostpillar';
  const databaseKey = 'default';
  const state = createLocalStorageBackendState(
    adapter,
    keyPrefix,
    databaseKey,
    4096,
    8,
  );

  adapter.setItem(
    lsManifestKey(keyPrefix, databaseKey),
    JSON.stringify({
      magic: 'FPLS_META',
      version: 2,
      activeGeneration: 0,
      commitId: 0,
      chunkCount: 'broken-chunk-count',
    }),
  );
  adapter.setItem(
    lsChunkKey(keyPrefix, databaseKey, 0, 0),
    JSON.stringify({ version: 1, config: {}, entries: [] }),
  );

  assert.throws(() => {
    loadLocalStorageSnapshot(state);
  }, StorageEngineError);
});

test('loadLocalStorageSnapshot rejects when manifest-declared chunk is missing', async () => {
  const { StorageEngineError } = await loadStorageModule();
  const { createLocalStorageBackendState, loadLocalStorageSnapshot } =
    await importDistModule(
      'storage/drivers/localStorage/localStorageBackend.js',
    );

  const adapter = createMockLocalStorage();
  const keyPrefix = 'frostpillar';
  const databaseKey = 'default';
  const state = createLocalStorageBackendState(
    adapter,
    keyPrefix,
    databaseKey,
    4096,
    8,
  );

  adapter.setItem(
    lsManifestKey(keyPrefix, databaseKey),
    JSON.stringify({
      magic: 'FPLS_META',
      version: 2,
      activeGeneration: 0,
      commitId: 0,
      chunkCount: 3,
    }),
  );
  adapter.setItem(
    lsChunkKey(keyPrefix, databaseKey, 0, 0),
    '{"version":1,"config"',
  );
  adapter.setItem(lsChunkKey(keyPrefix, databaseKey, 0, 1), ',"entries":[]}');
  // chunk:2 is intentionally missing.

  assert.throws(() => {
    loadLocalStorageSnapshot(state);
  }, StorageEngineError);
});

test('loadIndexedDBSnapshot rejects non-numeric commitId in metadata', async () => {
  const { StorageEngineError } = await loadStorageModule();
  const { loadIndexedDBSnapshot } = await importDistModule(
    'storage/drivers/IndexedDB/indexedDBBackend.js',
  );

  const db = createMockIndexedDbHandle([], {
    magic: 'FPIDB_META',
    version: 2,
    commitId: 'broken-commit',
    treeJSON: { version: 1, config: {}, entries: [] },
  });

  await assert.rejects(loadIndexedDBSnapshot(db, 'events'), StorageEngineError);
});

test('syncStorage initialization rejects non-numeric commitId in manifest', async () => {
  const { Datastore, StorageEngineError } = await loadStorageModule();
  const { syncStorageDriver } = await importDistModule(
    'drivers/syncStorage.js',
  );

  const keyPrefix = 'frostpillar';
  const databaseKey = 'default';
  const manifestStorageKey = syncManifestKey(keyPrefix, databaseKey);
  const firstChunkStorageKey = syncChunkKey(keyPrefix, databaseKey, 0, 0);
  const syncArea = createMockSyncStorageArea();
  await syncArea.set({
    [manifestStorageKey]: {
      magic: 'FPSYNC_META',
      version: 2,
      activeGeneration: 0,
      commitId: 'broken-commit',
      chunkCount: 1,
    },
    [firstChunkStorageKey]: JSON.stringify({
      version: 1,
      config: {},
      entries: [],
    }),
  });

  const previousBrowser = globalThis.browser;
  globalThis.browser = { storage: { sync: syncArea } };

  let datastore = null;
  try {
    datastore = new Datastore({
      driver: syncStorageDriver({
        keyPrefix,
        databaseKey,
      }),
    });

    await assert.rejects(
      datastore.put({
        key: 'sync-broken-manifest',
        payload: { value: 'x' },
      }),
      StorageEngineError,
    );
  } finally {
    await datastore?.close().catch(() => undefined);
    if (previousBrowser === undefined) {
      delete globalThis.browser;
    } else {
      globalThis.browser = previousBrowser;
    }
  }
});

test('loadOpfsSnapshot rejects non-numeric commitId in metadata', async () => {
  const { StorageEngineError } = await loadStorageModule();
  const { loadOpfsSnapshot } = await importDistModule(
    'storage/drivers/opfs/opfsBackend.js',
  );

  const directory = createMockOpfsDirectory({
    'meta.json': JSON.stringify({
      magic: 'FPOPFS_META',
      version: 2,
      activeData: 'a',
      commitId: 'broken-commit',
    }),
    'data-a.json': JSON.stringify({ version: 1, config: {}, entries: [] }),
  });

  await assert.rejects(loadOpfsSnapshot(directory), StorageEngineError);
});
