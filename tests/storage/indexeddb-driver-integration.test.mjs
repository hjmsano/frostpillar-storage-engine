/**
 * TEST-2: Integration tests for the IndexedDB driver.
 *
 * IndexedDB is a browser-only API not available in Node.js.  These tests
 * inject a fully in-memory mock into globalThis.indexedDB so that
 * indexedDBDriver() runs the full write → close → reopen → read cycle
 * without a real browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

// ---------------------------------------------------------------------------
// In-memory IDB mock
// ---------------------------------------------------------------------------

const createSuccessfulIdbRequest = (result) => {
  const request = { result, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    request.onsuccess?.({ target: request });
  });
  return request;
};

const createMockObjectStore = (storeMap) => ({
  getAll: () => createSuccessfulIdbRequest(Array.from(storeMap.values())),
  get: (key) => createSuccessfulIdbRequest(storeMap.get(key)),
  put: (value, key) => {
    storeMap.set(key, value);
    return createSuccessfulIdbRequest(key);
  },
  clear: () => {
    storeMap.clear();
    return createSuccessfulIdbRequest(undefined);
  },
});

/**
 * Creates a mock IDBDatabaseHandle backed by an in-memory Map of Maps.
 * `dbStores` maps storeName → Map<key, value> and is shared across all
 * database handles returned for the same database name, which allows
 * reopened datastores to read data written by the first instance.
 */
const createMockDatabase = (dbStores) => {
  const createTransaction = (_storeNames, _mode) => {
    const tx = { onerror: null };
    let _oncomplete = null;
    Object.defineProperty(tx, 'oncomplete', {
      get: () => _oncomplete,
      set: (fn) => {
        _oncomplete = fn;
        // idbTransaction() sets oncomplete after all put/clear calls;
        // fire it on the next microtask to satisfy await idbTransaction(tx).
        queueMicrotask(() => {
          fn?.();
        });
      },
    });
    tx.objectStore = (name) => createMockObjectStore(dbStores.get(name));
    return tx;
  };

  return {
    objectStoreNames: { contains: (name) => dbStores.has(name) },
    createObjectStore: (name) => {
      if (!dbStores.has(name)) {
        dbStores.set(name, new Map());
      }
      return createMockObjectStore(dbStores.get(name));
    },
    transaction: createTransaction,
    close: () => {},
  };
};

/**
 * Creates a mock IDBFactory.  A single factory instance persists data across
 * multiple open() calls, simulating what a real browser IDB would do.
 */
const createMockIDBFactory = () => {
  // databaseName → Map<storeName, Map<key, value>>
  const databases = new Map();

  return {
    open: (databaseName, version) => {
      if (!databases.has(databaseName)) {
        databases.set(databaseName, new Map());
      }
      const dbStores = databases.get(databaseName);
      const db = createMockDatabase(dbStores);

      const request = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      queueMicrotask(() => {
        // Fire onupgradeneeded so openIndexedDB() can create the object stores.
        request.onupgradeneeded?.({
          target: request,
          oldVersion: 0,
          newVersion: version,
        });
        // Fire onsuccess on the following microtask so the upgrade handler
        // (which is synchronous) finishes before onsuccess resolves.
        queueMicrotask(() => {
          request.onsuccess?.({ target: request });
        });
      });

      return request;
    },
  };
};

/**
 * Injects a mock IDB factory into globalThis.indexedDB and returns a cleanup
 * function that restores the original value.
 */
const injectMockIndexedDB = () => {
  const factory = createMockIDBFactory();
  const previousIndexedDB = globalThis.indexedDB;
  globalThis.indexedDB = factory;

  return () => {
    if (previousIndexedDB === undefined) {
      delete globalThis.indexedDB;
    } else {
      globalThis.indexedDB = previousIndexedDB;
    }
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('indexedDB driver: fresh open returns empty datastore', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const restore = injectMockIndexedDB();
  try {
    const datastore = new Datastore({ driver: indexedDBDriver() });
    const rows = await datastore.getRange(
      '2025-01-01T00:00:00.000Z',
      '2025-12-31T23:59:59.999Z',
    );
    assert.equal(rows.length, 0);
    await datastore.close();
  } finally {
    restore();
  }
});

test('indexedDB driver: inserted records survive close and reopen', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const restore = injectMockIndexedDB();
  try {
    // First instance: write
    const first = new Datastore({ driver: indexedDBDriver() });
    await first.put({
      key: '2025-06-01T00:00:00.000Z',
      payload: { id: 'alpha', value: 42 },
    });
    await first.put({
      key: '2025-06-02T00:00:00.000Z',
      payload: { id: 'beta', value: 99 },
    });
    // autoCommit is 'immediate' by default — records are committed per-insert.
    await first.close();

    // Second instance: read from the same in-memory IDB stores
    const second = new Datastore({ driver: indexedDBDriver() });
    const rows = await second.getRange(
      '2025-06-01T00:00:00.000Z',
      '2025-06-30T00:00:00.000Z',
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].payload.id, 'alpha');
    assert.equal(rows[0].payload.value, 42);
    assert.equal(rows[1].payload.id, 'beta');
    assert.equal(rows[1].payload.value, 99);
    await second.close();
  } finally {
    restore();
  }
});

test('indexedDB driver: explicit commit() flushes records before close', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const restore = injectMockIndexedDB();
  try {
    const first = new Datastore({ driver: indexedDBDriver() });
    await first.put({
      key: '2025-07-01T00:00:00.000Z',
      payload: { id: 'gamma' },
    });
    await first.commit();
    await first.close();

    const second = new Datastore({ driver: indexedDBDriver() });
    const rows = await second.getRange(
      '2025-07-01T00:00:00.000Z',
      '2025-07-01T00:00:00.000Z',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'gamma');
    await second.close();
  } finally {
    restore();
  }
});

test('indexedDB driver: deletion is reflected after reopen', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const restore = injectMockIndexedDB();
  try {
    const first = new Datastore({ driver: indexedDBDriver() });
    await first.put({
      key: '2025-08-01T00:00:00.000Z',
      payload: { id: 'to-delete' },
    });
    await first.put({
      key: '2025-08-02T00:00:00.000Z',
      payload: { id: 'to-keep' },
    });

    const toDeleteRecords = await first.getRange(
      '2025-08-01T00:00:00.000Z',
      '2025-08-01T00:00:00.000Z',
    );
    assert.equal(toDeleteRecords.length, 1);
    await first.deleteById(toDeleteRecords[0]._id);
    await first.close();

    const second = new Datastore({ driver: indexedDBDriver() });
    const rows = await second.getRange(
      '2025-08-01T00:00:00.000Z',
      '2025-08-31T00:00:00.000Z',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.id, 'to-keep');
    await second.close();
  } finally {
    restore();
  }
});

test('indexedDB driver: update is reflected after reopen', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const restore = injectMockIndexedDB();
  try {
    const first = new Datastore({ driver: indexedDBDriver() });
    await first.put({
      key: '2025-09-01T00:00:00.000Z',
      payload: { id: 'updateable', value: 1 },
    });

    const targetRecords = await first.getRange(
      '2025-09-01T00:00:00.000Z',
      '2025-09-01T00:00:00.000Z',
    );
    assert.equal(targetRecords.length, 1);
    await first.updateById(targetRecords[0]._id, { value: 999 });
    await first.close();

    const second = new Datastore({ driver: indexedDBDriver() });
    const rows = await second.getRange(
      '2025-09-01T00:00:00.000Z',
      '2025-09-01T00:00:00.000Z',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.value, 999);
    await second.close();
  } finally {
    restore();
  }
});

test('indexedDB driver: throws UnsupportedBackendError when indexedDB is unavailable', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const previousIndexedDB = globalThis.indexedDB;
  // Ensure globalThis.indexedDB is absent so detectGlobalIndexedDB() returns null.
  delete globalThis.indexedDB;
  try {
    const datastore = new Datastore({ driver: indexedDBDriver() });

    await assert.rejects(
      datastore.put({
        key: '2025-01-01T00:00:00.000Z',
        payload: { id: 'fail' },
      }),
      (error) =>
        error instanceof Error && error.name === 'UnsupportedBackendError',
    );

    await datastore.close().catch(() => undefined);
  } finally {
    if (previousIndexedDB === undefined) {
      delete globalThis.indexedDB;
    } else {
      globalThis.indexedDB = previousIndexedDB;
    }
  }
});

test('indexedDB driver: insertion order is preserved across multiple records with the same key after reopen', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');

  const restore = injectMockIndexedDB();
  try {
    const first = new Datastore({ driver: indexedDBDriver() });
    const sharedKey = '2025-10-01T00:00:00.000Z';
    await first.put({ key: sharedKey, payload: { id: 'first' } });
    await first.put({ key: sharedKey, payload: { id: 'second' } });
    await first.put({ key: sharedKey, payload: { id: 'third' } });
    await first.close();

    const second = new Datastore({ driver: indexedDBDriver() });
    const rows = await second.getRange(sharedKey, sharedKey);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].payload.id, 'first');
    assert.equal(rows[1].payload.id, 'second');
    assert.equal(rows[2].payload.id, 'third');
    await second.close();
  } finally {
    restore();
  }
});
