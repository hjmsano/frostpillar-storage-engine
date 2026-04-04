/**
 * TDD tests for B2: currentSizeBytes must use UTF-8 byte length, not UTF-16 .length.
 *
 * Spec reference: 02_DurableBackends.md §2.1
 * "initialCurrentSizeBytes MUST be the UTF-8 byte length of JSON.stringify(initialTreeJSON)"
 *
 * CJK characters (e.g. "日本語") are 1 char in UTF-16 but 3 bytes in UTF-8,
 * so .length underestimates byte count for such content.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

// ---------------------------------------------------------------------------
// Multi-byte test data: CJK characters ensure UTF-16 .length != UTF-8 byteLength
// ---------------------------------------------------------------------------

const CJK_STRING = '日本語テスト'; // 6 chars, but 18 UTF-8 bytes

const buildMultiByteTreeJSON = () => ({
  version: 1,
  config: {},
  entries: [
    { key: CJK_STRING, payload: { value: CJK_STRING } },
  ],
});

const utf8ByteLength = (str) => new TextEncoder().encode(str).byteLength;

// ---------------------------------------------------------------------------
// Mock helpers (mirrored from browser-metadata-validation.test.mjs)
// ---------------------------------------------------------------------------

const createMockLocalStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};

const lsManifestKey = (keyPrefix, databaseKey) =>
  `${keyPrefix}:ls:${databaseKey}:manifest`;

const lsChunkKey = (keyPrefix, databaseKey, generation, index) =>
  `${keyPrefix}:ls:${databaseKey}:g:${generation}:chunk:${index}`;

const createSuccessfulIdbRequest = (result) => {
  const request = { result, onsuccess: null, onerror: null };
  queueMicrotask(() => { request.onsuccess?.({ target: request }); });
  return request;
};

const createMockIndexedDbHandle = (meta) => ({
  transaction: () => {
    const tx = {
      oncomplete: null,
      onerror: null,
      objectStore: (name) => {
        if (name === '_meta') {
          return { get: () => createSuccessfulIdbRequest(meta) };
        }
        throw new Error(`Unexpected object store: ${name}`);
      },
    };
    queueMicrotask(() => {
      queueMicrotask(() => {
        tx.oncomplete?.();
      });
    });
    return tx;
  },
});

const createNotFoundError = () => {
  const error = new Error('NotFound');
  error.name = 'NotFoundError';
  return error;
};

const createMockOpfsDirectory = (files) => {
  const store = new Map(Object.entries(files));
  return {
    getFileHandle: async (name, options = {}) => {
      if (!store.has(name)) {
        if (options.create === true) {
          store.set(name, '');
        } else {
          throw createNotFoundError();
        }
      }
      return {
        getFile: async () => ({ text: async () => store.get(name) }),
        createWritable: async () => ({
          write: async (data) => { store.set(name, String(data)); },
          close: async () => {},
        }),
      };
    },
    removeEntry: async (name) => { store.delete(name); },
  };
};

const createMockSyncStorageArea = () => {
  const store = new Map();
  return {
    getItems: async (keys) => {
      const result = {};
      for (const key of keys) {
        if (store.has(key)) result[key] = store.get(key);
      }
      return result;
    },
    setItems: async (items) => {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    removeItems: async (keys) => {
      for (const key of keys) store.delete(key);
    },
  };
};

const syncManifestKey = (keyPrefix, databaseKey) =>
  `${keyPrefix}:sync:${databaseKey}:manifest`;

const syncChunkKey = (keyPrefix, databaseKey, generation, index) =>
  `${keyPrefix}:sync:${databaseKey}:g:${generation}:chunk:${index}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('localStorage: currentSizeBytes uses UTF-8 byte length for multi-byte content', async () => {
  const { createLocalStorageBackendState, loadLocalStorageSnapshot } =
    await importDistModule('storage/drivers/localStorage/localStorageBackend.js');

  const adapter = createMockLocalStorage();
  const keyPrefix = 'fp';
  const databaseKey = 'test';
  const state = createLocalStorageBackendState(adapter, keyPrefix, databaseKey, 4096, 8);

  const treeJSON = buildMultiByteTreeJSON();
  const jsonStr = JSON.stringify(treeJSON);

  // Verify our test data actually has a discrepancy (UTF-8 > UTF-16 char count)
  const expectedByteLength = utf8ByteLength(jsonStr);
  assert.ok(
    expectedByteLength > jsonStr.length,
    `Test data must have multi-byte chars: byteLength=${expectedByteLength}, charLength=${jsonStr.length}`,
  );

  adapter.setItem(
    lsManifestKey(keyPrefix, databaseKey),
    JSON.stringify({ magic: 'FPLS_META', version: 2, activeGeneration: 0, commitId: 1, chunkCount: 1 }),
  );
  adapter.setItem(lsChunkKey(keyPrefix, databaseKey, 0, 0), jsonStr);

  const snapshot = loadLocalStorageSnapshot(state);

  assert.equal(
    snapshot.currentSizeBytes,
    expectedByteLength,
    `localStorage currentSizeBytes should be UTF-8 byte length (${expectedByteLength}), got ${snapshot.currentSizeBytes}`,
  );
});

test('IndexedDB: currentSizeBytes uses UTF-8 byte length for multi-byte content', async () => {
  const { loadIndexedDBSnapshot } =
    await importDistModule('storage/drivers/IndexedDB/indexedDBBackend.js');

  const treeJSON = buildMultiByteTreeJSON();
  const jsonStr = JSON.stringify(treeJSON);
  const expectedByteLength = utf8ByteLength(jsonStr);

  assert.ok(
    expectedByteLength > jsonStr.length,
    `Test data must have multi-byte chars: byteLength=${expectedByteLength}, charLength=${jsonStr.length}`,
  );

  const db = createMockIndexedDbHandle({
    magic: 'FPIDB_META',
    version: 2,
    commitId: 1,
    treeJSON,
  });

  const snapshot = await loadIndexedDBSnapshot(db, '_meta');

  assert.equal(
    snapshot.currentSizeBytes,
    expectedByteLength,
    `IndexedDB currentSizeBytes should be UTF-8 byte length (${expectedByteLength}), got ${snapshot.currentSizeBytes}`,
  );
});

test('OPFS: currentSizeBytes uses UTF-8 byte length for multi-byte content', async () => {
  const { loadOpfsSnapshot } =
    await importDistModule('storage/drivers/opfs/opfsBackend.js');

  const treeJSON = buildMultiByteTreeJSON();
  const jsonStr = JSON.stringify(treeJSON);
  const expectedByteLength = utf8ByteLength(jsonStr);

  assert.ok(
    expectedByteLength > jsonStr.length,
    `Test data must have multi-byte chars: byteLength=${expectedByteLength}, charLength=${jsonStr.length}`,
  );

  const directory = createMockOpfsDirectory({
    'meta.json': JSON.stringify({ magic: 'FPOPFS_META', version: 2, activeData: 'a', commitId: 1 }),
    'data-a.json': jsonStr,
  });

  const snapshot = await loadOpfsSnapshot(directory);

  assert.equal(
    snapshot.currentSizeBytes,
    expectedByteLength,
    `OPFS currentSizeBytes should be UTF-8 byte length (${expectedByteLength}), got ${snapshot.currentSizeBytes}`,
  );
});

test('syncStorage: currentSizeBytes uses UTF-8 byte length for multi-byte content', async () => {
  const { createSyncStorageBackendState, loadSyncStorageSnapshot } =
    await importDistModule('storage/drivers/syncStorage/syncStorageBackend.js');

  const keyPrefix = 'fp';
  const databaseKey = 'test';
  const adapter = createMockSyncStorageArea();

  const treeJSON = buildMultiByteTreeJSON();
  const jsonStr = JSON.stringify(treeJSON);
  const expectedByteLength = utf8ByteLength(jsonStr);

  assert.ok(
    expectedByteLength > jsonStr.length,
    `Test data must have multi-byte chars: byteLength=${expectedByteLength}, charLength=${jsonStr.length}`,
  );

  await adapter.setItems({
    [syncManifestKey(keyPrefix, databaseKey)]: {
      magic: 'FPSYNC_META',
      version: 2,
      activeGeneration: 0,
      commitId: 1,
      chunkCount: 1,
    },
    [syncChunkKey(keyPrefix, databaseKey, 0, 0)]: jsonStr,
  });

  // maxChunkChars=4096, maxChunks=8, maxItemBytes=8192, maxTotalBytes=102400
  const state = createSyncStorageBackendState(adapter, keyPrefix, databaseKey, 4096, 8, 8192, 102400);

  const snapshot = await loadSyncStorageSnapshot(state);

  assert.equal(
    snapshot.currentSizeBytes,
    expectedByteLength,
    `syncStorage currentSizeBytes should be UTF-8 byte length (${expectedByteLength}), got ${snapshot.currentSizeBytes}`,
  );
});
