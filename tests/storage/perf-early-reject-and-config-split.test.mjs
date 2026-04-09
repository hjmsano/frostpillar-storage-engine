import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'string') {
      throw new TypeError(`${fieldName} must be string.`);
    }
    if (value.length === 0) {
      throw new TypeError(`${fieldName} must not be empty.`);
    }
    return value;
  },
  compare: (left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  },
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
});

// ---------------------------------------------------------------------------
// Change #3: Early reject — duplicate key check before validation
// ---------------------------------------------------------------------------

test('put with reject policy and duplicate key should throw ValidationError', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'reject',
  });

  await ds.put({ key: 'k1', payload: { v: 1 } });

  await assert.rejects(
    () => ds.put({ key: 'k1', payload: { v: 2 } }),
    (error) => error instanceof Error && error.name === 'ValidationError',
  );

  await ds.close();
});

test('put with reject policy and unique key should succeed', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'reject',
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'b', payload: { v: 2 } });

  const all = await ds.getAll();
  assert.equal(all.length, 2);

  await ds.close();
});

test('put with reject policy, duplicate key, and invalid payload throws duplicate-key error (not payload error)', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'reject',
  });

  await ds.put({ key: 'dup', payload: { v: 1 } });

  // Circular reference would fail payload validation, but the duplicate key
  // check must fire first because it runs before validateAndNormalizePayload.
  const circular = {};
  circular.self = circular;

  await assert.rejects(
    () => ds.put({ key: 'dup', payload: circular }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.ok(
        error.message.includes('Duplicate key rejected'),
        `Expected "Duplicate key rejected" in message, got: ${error.message}`,
      );
      return true;
    },
  );

  await ds.close();
});

test('put with allow policy and invalid payload throws payload validation error', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'allow',
  });

  const circular = {};
  circular.self = circular;

  await assert.rejects(
    () => ds.put({ key: 'k', payload: circular }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      // Should NOT be about duplicate key — should be payload-related
      assert.ok(
        !error.message.includes('Duplicate key rejected'),
        `Should not be a duplicate-key error: ${error.message}`,
      );
      return true;
    },
  );

  await ds.close();
});

test('put with replace policy should replace existing record', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'replace',
  });

  await ds.put({ key: 'r1', payload: { v: 1 } });
  await ds.put({ key: 'r1', payload: { v: 2 } });

  const records = await ds.get('r1');
  assert.equal(records.length, 1);
  assert.equal(records[0].payload.v, 2);

  await ds.close();
});

// ---------------------------------------------------------------------------
// Change #2: Per-driver config split — modules export expected symbols
// ---------------------------------------------------------------------------

test('localStorageConfig module exports parseLocalStorageConfig and constants', async () => {
  const mod = await importDistModule(
    'storage/drivers/localStorage/localStorageConfig.js',
  );
  assert.equal(typeof mod.parseLocalStorageConfig, 'function');
  assert.equal(typeof mod.DEFAULT_LOCAL_STORAGE_MAX_CHUNK_CHARS, 'number');
  assert.equal(typeof mod.DEFAULT_LOCAL_STORAGE_MAX_CHUNKS, 'number');
});

test('indexedDBConfig module exports parseIndexedDBConfig', async () => {
  const mod = await importDistModule(
    'storage/drivers/IndexedDB/indexedDBConfig.js',
  );
  assert.equal(typeof mod.parseIndexedDBConfig, 'function');
});

test('syncStorageConfig module exports parseSyncStorageConfig and related', async () => {
  const mod = await importDistModule(
    'storage/drivers/syncStorage/syncStorageConfig.js',
  );
  assert.equal(typeof mod.parseSyncStorageConfig, 'function');
  assert.equal(
    typeof mod.parseSyncStorageMaxTotalBytesForBackendLimit,
    'function',
  );
  assert.equal(typeof mod.DEFAULT_SYNC_STORAGE_MAX_TOTAL_BYTES, 'number');
});

test('config.shared does not export per-driver parsers (tree-shaking boundary)', async () => {
  const shared = await importDistModule('storage/config/config.shared.js');

  // Per-driver parsers must NOT be reachable from config.shared
  assert.equal(shared.parseLocalStorageConfig, undefined);
  assert.equal(shared.parseIndexedDBConfig, undefined);
  assert.equal(shared.parseSyncStorageConfig, undefined);

  // Core parsers must remain
  assert.equal(typeof shared.parseCapacityConfig, 'function');
  assert.equal(typeof shared.parseAutoCommitConfig, 'function');
  assert.equal(typeof shared.parseDuplicateKeyConfig, 'function');
});
