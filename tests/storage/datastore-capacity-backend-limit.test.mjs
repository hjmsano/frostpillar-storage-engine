import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

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

const injectLocalStorage = (mockStorage) => {
  globalThis.localStorage = mockStorage;
};

const removeLocalStorage = () => {
  delete globalThis.localStorage;
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

const injectSyncStorage = (syncArea) => {
  globalThis.browser = { storage: { sync: syncArea } };
};

const removeSyncStorage = () => {
  delete globalThis.browser;
};

const loadCapacityDriverModules = async () => {
  const { localStorageDriver } = await importDistModule('drivers/localStorage.js');
  const { syncStorageDriver } = await importDistModule('drivers/syncStorage.js');
  return { localStorageDriver, syncStorageDriver };
};

test('capacity.maxSize="backendLimit" resolves localStorage chunk envelope and rejects strict overflow', async () => {
  const { Datastore, QuotaExceededError } = await loadStorageModule();
  const { localStorageDriver } = await loadCapacityDriverModules();
  injectLocalStorage(createMockLocalStorage());

  let datastore = null;
  try {
    datastore = new Datastore({
      driver: localStorageDriver({
        maxChunkChars: 16,
        maxChunks: 2,
      }),
      capacity: {
        maxSize: 'backendLimit',
        policy: 'strict',
      },
    });

    await assert.rejects(
      datastore.put({
        key: '1735689600000',
        payload: { value: 'x'.repeat(128) },
      }),
      QuotaExceededError,
    );
  } finally {
    await datastore?.close();
    removeLocalStorage();
  }
});

test('capacity.maxSize="backendLimit" resolves syncStorage maxTotalBytes and rejects strict overflow', async () => {
  const { Datastore, QuotaExceededError } = await loadStorageModule();
  const { syncStorageDriver } = await loadCapacityDriverModules();
  injectSyncStorage(createMockSyncStorageArea());

  let datastore = null;
  try {
    datastore = new Datastore({
      driver: syncStorageDriver({
        keyPrefix: 'frostpillar',
        databaseKey: 'capacity-sync',
        maxItemBytes: 8192,
        maxTotalBytes: 96,
        maxItems: 512,
      }),
      capacity: {
        maxSize: 'backendLimit',
        policy: 'strict',
      },
    });

    await assert.rejects(
      datastore.put({
        key: 'sync-overflow',
        payload: { value: 'x'.repeat(256) },
      }),
      QuotaExceededError,
    );
  } finally {
    await datastore?.close().catch(() => undefined);
    removeSyncStorage();
  }
});

test('capacity.maxSize="backendLimit" is rejected when driver is not selected', async () => {
  const { Datastore, ConfigurationError } = await loadStorageModule();

  assert.throws(
    () =>
      new Datastore({
        capacity: {
          maxSize: 'backendLimit',
          policy: 'strict',
        },
      }),
    ConfigurationError,
  );
});
