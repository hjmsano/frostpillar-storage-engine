import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createPromiseSyncStorageArea = () => {
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

const createChromeCallbackSyncStorageArea = () => {
  const store = new Map();
  return {
    get: (keys, callback) => {
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
      queueMicrotask(() => {
        callback(result);
      });
    },
    set: (items, callback) => {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
      queueMicrotask(() => {
        callback();
      });
    },
    remove: (keys, callback) => {
      const normalizedKeys = Array.isArray(keys) ? keys : [keys];
      for (const key of normalizedKeys) {
        store.delete(key);
      }
      queueMicrotask(() => {
        callback();
      });
    },
  };
};

const createSyncStorageConfig = (databaseKey) => {
  return {
    keyPrefix: 'frostpillar',
    databaseKey,
    maxItemBytes: 8192,
    maxTotalBytes: 102400,
    maxItems: 512,
  };
};

const loadSyncStorageDriver = async () => {
  const { syncStorageDriver } = await importDistModule(
    'drivers/syncStorage.js',
  );
  return syncStorageDriver;
};

test('syncStorage backend persists records across reopen via browser.storage.sync', async () => {
  const { Datastore } = await loadStorageModule();
  const syncStorageDriver = await loadSyncStorageDriver();
  const syncArea = createPromiseSyncStorageArea();
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  globalThis.browser = { storage: { sync: syncArea } };
  delete globalThis.chrome;

  const config = {
    driver: syncStorageDriver(createSyncStorageConfig('sync-browser-reopen')),
  };

  let first = null;
  let second = null;
  try {
    first = new Datastore(config);
    await first.put({ key: 'a', payload: { value: 'first' } });
    await first.put({ key: 'b', payload: { value: 'second' } });
    await first.commit();
    await first.close();
    first = null;

    second = new Datastore(config);
    const rows = await second.getRange('a', 'z');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].payload.value, 'first');
    assert.equal(rows[1].payload.value, 'second');
  } finally {
    await first?.close().catch(() => undefined);
    await second?.close().catch(() => undefined);
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

test('syncStorage backend supports chrome.storage.sync callback API', async () => {
  const { Datastore } = await loadStorageModule();
  const syncStorageDriver = await loadSyncStorageDriver();
  const syncArea = createChromeCallbackSyncStorageArea();
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  delete globalThis.browser;
  globalThis.chrome = {
    runtime: {},
    storage: { sync: syncArea },
  };

  const config = {
    driver: syncStorageDriver(createSyncStorageConfig('sync-chrome-reopen')),
  };

  let first = null;
  let second = null;
  try {
    first = new Datastore(config);
    await first.put({ key: 'x', payload: { value: 'callback-api' } });
    await first.commit();
    await first.close();
    first = null;

    second = new Datastore(config);
    const rows = await second.getRange('x', 'x');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.value, 'callback-api');
  } finally {
    await first?.close().catch(() => undefined);
    await second?.close().catch(() => undefined);
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

test('syncStorage commit rejects when snapshot exceeds configured maxItems envelope', async () => {
  const { Datastore, QuotaExceededError } = await loadStorageModule();
  const syncStorageDriver = await loadSyncStorageDriver();
  const syncArea = createPromiseSyncStorageArea();
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  globalThis.browser = { storage: { sync: syncArea } };
  delete globalThis.chrome;

  let datastore = null;
  try {
    datastore = new Datastore({
      driver: syncStorageDriver({
        keyPrefix: 'frostpillar',
        databaseKey: 'sync-max-items-overflow',
        maxItemBytes: 128,
        maxTotalBytes: 4096,
        maxItems: 2,
      }),
    });

    await assert.rejects(
      datastore.put({
        key: 'sync-overflow',
        payload: { value: 'x'.repeat(1024) },
      }),
      QuotaExceededError,
    );
  } finally {
    await datastore?.close().catch(() => undefined);
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

test('syncStorage explicit selection fails when neither browser nor chrome sync storage is available', async () => {
  const { Datastore, UnsupportedBackendError } = await loadStorageModule();
  const syncStorageDriver = await loadSyncStorageDriver();
  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  delete globalThis.browser;
  delete globalThis.chrome;

  let datastore = null;
  try {
    datastore = new Datastore({
      driver: syncStorageDriver(),
    });
    await assert.rejects(
      datastore.put({
        key: 'missing-sync',
        payload: { value: 'x' },
      }),
      UnsupportedBackendError,
    );
  } finally {
    await datastore?.close().catch(() => undefined);
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
