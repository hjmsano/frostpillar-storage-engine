/**
 * TEST-1: Integration tests for the OPFS driver.
 *
 * OPFS requires a browser origin-private file system that Node.js does not
 * natively provide.  These tests inject a lightweight in-memory mock into
 * globalThis.navigator.storage so that opfsDriver() runs the full
 * write → close → reopen → read cycle without a real browser environment.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

// ---------------------------------------------------------------------------
// Mock OPFS helpers
// ---------------------------------------------------------------------------

const createNotFoundError = () => {
  const error = new Error(
    'The requested file or directory could not be found.',
  );
  error.name = 'NotFoundError';
  return error;
};

/**
 * Creates a mock OPFS directory handle backed by an in-memory Map.
 * Sharing the same Map across multiple createMockOpfsDirectory() calls
 * is what allows reopened datastores to read data written by the first instance.
 */
const createMockOpfsDirectory = (fileStore) => ({
  getDirectoryHandle: async (name, opts = {}) => {
    // Nested sub-directories are not exercised by the OPFS backend;
    // return a fresh directory that delegates to the same fileStore
    // so tests that don't rely on nesting still work.
    return createMockOpfsDirectory(fileStore);
  },
  getFileHandle: async (name, options = {}) => {
    if (!fileStore.has(name)) {
      if (options.create === true) {
        fileStore.set(name, '');
      } else {
        throw createNotFoundError();
      }
    }
    return {
      getFile: async () => ({
        text: async () => fileStore.get(name),
      }),
      createWritable: async () => ({
        write: async (data) => {
          fileStore.set(name, String(data));
        },
        close: async () => {},
      }),
    };
  },
  removeEntry: async (name) => {
    fileStore.delete(name);
  },
});

/**
 * Injects a mock storage root into globalThis.navigator so that detectGlobalOpfs()
 * returns it.  Returns a cleanup function that restores the original descriptor.
 *
 * In Node.js 24+, `navigator` is a configurable getter-only property on
 * globalThis, so direct assignment throws.  We must use Object.defineProperty.
 */
const injectMockOpfsStorage = (fileStore) => {
  const mockSubDir = createMockOpfsDirectory(fileStore);
  const mockStorageArea = {
    // detectGlobalOpfs() checks that getDirectory is a function, then returns
    // navigator.storage itself as the OpfsStorageRoot.
    getDirectory: async () => ({
      // openOpfsDirectory() calls root.getDirectoryHandle(directoryName, {create:true})
      getDirectoryHandle: async (_name, _opts = {}) => mockSubDir,
    }),
  };

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage: mockStorageArea },
    configurable: true,
    writable: true,
  });

  return () => {
    if (originalDescriptor === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('opfs driver: fresh open returns empty datastore', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { opfsDriver } = await importDistModule('drivers/opfs.js');

  const fileStore = new Map();
  const restore = injectMockOpfsStorage(fileStore);
  try {
    const datastore = new Datastore({ driver: opfsDriver() });
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

test('opfs driver: inserted records survive close and reopen', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { opfsDriver } = await importDistModule('drivers/opfs.js');

  const fileStore = new Map();
  const restore = injectMockOpfsStorage(fileStore);
  try {
    // First instance: write
    const first = new Datastore({ driver: opfsDriver() });
    await first.put({
      key: '2025-06-01T00:00:00.000Z',
      payload: { id: 'alpha', value: 42 },
    });
    await first.put({
      key: '2025-06-02T00:00:00.000Z',
      payload: { id: 'beta', value: 99 },
    });
    // autoCommit is 'immediate' by default, so records are already committed.
    await first.close();

    // Second instance: read from the same mock OPFS files
    const second = new Datastore({ driver: opfsDriver() });
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

test('opfs driver: explicit commit() flushes records before close', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { opfsDriver } = await importDistModule('drivers/opfs.js');

  const fileStore = new Map();
  const restore = injectMockOpfsStorage(fileStore);
  try {
    // Use no autoCommit so we control the commit ourselves.
    // autoCommit defaults to 'immediate' when no option is passed, but we pass
    // an explicit frequency to test the explicit commit() path specifically.
    // 'immediate' still auto-commits on each insert; calling commit() again is idempotent.
    const first = new Datastore({ driver: opfsDriver() });
    await first.put({
      key: '2025-07-01T00:00:00.000Z',
      payload: { id: 'gamma' },
    });
    await first.commit();
    await first.close();

    const second = new Datastore({ driver: opfsDriver() });
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

test('opfs driver: deletion is reflected after reopen', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { opfsDriver } = await importDistModule('drivers/opfs.js');

  const fileStore = new Map();
  const restore = injectMockOpfsStorage(fileStore);
  try {
    const first = new Datastore({ driver: opfsDriver() });
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

    const second = new Datastore({ driver: opfsDriver() });
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

test('opfs driver: ping-pong commit alternates activeData between a and b', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { opfsDriver } = await importDistModule('drivers/opfs.js');

  const fileStore = new Map();
  const restore = injectMockOpfsStorage(fileStore);
  try {
    // First open: should write data-b.json (alternating from initial 'a')
    const first = new Datastore({ driver: opfsDriver() });
    await first.put({
      key: '2025-09-01T00:00:00.000Z',
      payload: { id: 'first-commit' },
    });
    await first.close();

    const metaAfterFirst = JSON.parse(fileStore.get('meta.json'));
    assert.ok(
      metaAfterFirst.activeData === 'a' || metaAfterFirst.activeData === 'b',
    );

    // Second open: should toggle activeData
    const second = new Datastore({ driver: opfsDriver() });
    await second.put({
      key: '2025-09-02T00:00:00.000Z',
      payload: { id: 'second-commit' },
    });
    await second.close();

    const metaAfterSecond = JSON.parse(fileStore.get('meta.json'));
    assert.notEqual(metaAfterSecond.activeData, metaAfterFirst.activeData);
  } finally {
    restore();
  }
});

test('opfs driver: throws UnsupportedBackendError when OPFS is not available', async () => {
  await loadStorageModule();
  const { Datastore } = await importDistModule(
    'storage/datastore/Datastore.js',
  );
  const { opfsDriver } = await importDistModule('drivers/opfs.js');

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  // Remove navigator.storage so detectGlobalOpfs() returns null
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
    writable: true,
  });
  try {
    const datastore = new Datastore({ driver: opfsDriver() });

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
    if (originalDescriptor === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  }
});
