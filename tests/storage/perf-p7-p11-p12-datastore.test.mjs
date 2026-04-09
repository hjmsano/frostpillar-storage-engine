import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

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

const createNumericKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${fieldName} must be a finite number.`);
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
// P7: Synchronous fast-path for read operations
// ---------------------------------------------------------------------------

test('P7: get() returns correct results on pure in-memory datastore', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.put({ key: 'alpha', payload: { v: 1 } });
  await ds.put({ key: 'beta', payload: { v: 2 } });

  const results = await ds.get('alpha');
  assert.equal(results.length, 1);
  assert.equal(results[0].payload.v, 1);

  await ds.close();
});

test('P7: has() returns correct boolean', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.put({ key: 'exists', payload: { v: 1 } });

  assert.equal(await ds.has('exists'), true);
  assert.equal(await ds.has('missing'), false);

  await ds.close();
});

test('P7: count() returns correct count', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  assert.equal(await ds.count(), 0);

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'b', payload: { v: 2 } });
  await ds.put({ key: 'c', payload: { v: 3 } });

  assert.equal(await ds.count(), 3);

  await ds.close();
});

test('P7: keys() returns distinct keys in sorted order', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.put({ key: 'cherry', payload: { v: 3 } });
  await ds.put({ key: 'apple', payload: { v: 1 } });
  await ds.put({ key: 'banana', payload: { v: 2 } });
  // duplicate key entry (default allow policy)
  await ds.put({ key: 'apple', payload: { v: 4 } });

  const keys = await ds.keys();
  assert.deepEqual(keys, ['apple', 'banana', 'cherry']);

  await ds.close();
});

test('P7: getAll() returns all records', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.put({ key: 'x', payload: { v: 10 } });
  await ds.put({ key: 'y', payload: { v: 20 } });

  const all = await ds.getAll();
  assert.equal(all.length, 2);
  // Sorted by key
  assert.equal(all[0].payload.v, 10);
  assert.equal(all[1].payload.v, 20);

  await ds.close();
});

test('P7: read methods throw after close', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.put({ key: 'k', payload: { v: 1 } });
  await ds.close();

  await assert.rejects(
    () => ds.get('k'),
    (error) => error instanceof Error,
  );

  await assert.rejects(
    () => ds.has('k'),
    (error) => error instanceof Error,
  );

  await assert.rejects(
    () => ds.count(),
    (error) => error instanceof Error,
  );
});

test('P7: getRange() with valid range returns correct results', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createNumericKeyDefinition() });

  await ds.put({ key: 1, payload: { v: 'a' } });
  await ds.put({ key: 2, payload: { v: 'b' } });
  await ds.put({ key: 3, payload: { v: 'c' } });
  await ds.put({ key: 4, payload: { v: 'd' } });
  await ds.put({ key: 5, payload: { v: 'e' } });

  const range = await ds.getRange(2, 4);
  assert.equal(range.length, 3);
  assert.equal(range[0].payload.v, 'b');
  assert.equal(range[1].payload.v, 'c');
  assert.equal(range[2].payload.v, 'd');

  await ds.close();
});

test('P7: getMany() deduplicates keys correctly', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'replace',
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'b', payload: { v: 2 } });
  await ds.put({ key: 'c', payload: { v: 3 } });

  // Pass 'a' twice — should return only 3 results (dedup)
  const results = await ds.getMany(['a', 'b', 'a', 'c']);
  assert.equal(results.length, 3);

  await ds.close();
});

// ---------------------------------------------------------------------------
// P11: Inline computeReplacedBytes — verify replace policy still works
// ---------------------------------------------------------------------------

test('P11: put with replace policy overwrites existing record correctly', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'replace',
  });

  await ds.put({ key: 'k1', payload: { v: 'original' } });
  await ds.put({ key: 'k1', payload: { v: 'replaced' } });

  const results = await ds.get('k1');
  assert.equal(results.length, 1);
  assert.equal(results[0].payload.v, 'replaced');

  assert.equal(await ds.count(), 1);

  await ds.close();
});

test('P11: put with replace policy and capacity tracks size correctly', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'replace',
    capacity: { maxSize: '10KB', policy: 'strict' },
  });

  // Put a record, then replace it — should not double-count
  await ds.put({ key: 'k1', payload: { v: 'hello' } });
  await ds.put({ key: 'k1', payload: { v: 'world' } });

  // If size tracking is broken (double-counted), adding more records would
  // exceed capacity prematurely.
  for (let i = 0; i < 20; i++) {
    await ds.put({
      key: `item-${String(i).padStart(3, '0')}`,
      payload: { n: i },
    });
  }

  assert.equal(await ds.count(), 21); // 1 replaced + 20 new

  await ds.close();
});

test('P11: put with allow policy does not remove existing entries', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    // default is 'allow'
  });

  await ds.put({ key: 'k1', payload: { v: 'first' } });
  await ds.put({ key: 'k1', payload: { v: 'second' } });

  const results = await ds.get('k1');
  assert.equal(results.length, 2);

  await ds.close();
});

// ---------------------------------------------------------------------------
// P12: Synchronous loop for in-memory putMany/deleteMany
// ---------------------------------------------------------------------------

test('P12: putMany on pure in-memory datastore inserts all records', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  const records = [];
  for (let i = 0; i < 50; i++) {
    records.push({
      key: `key-${String(i).padStart(3, '0')}`,
      payload: { n: i },
    });
  }

  await ds.putMany(records);
  assert.equal(await ds.count(), 50);

  // Verify order
  const all = await ds.getAll();
  assert.equal(all[0].payload.n, 0);
  assert.equal(all[49].payload.n, 49);

  await ds.close();
});

test('P12: putMany with reject policy throws on duplicate within batch (across puts)', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'reject',
  });

  // Insert a record first
  await ds.put({ key: 'dup', payload: { v: 1 } });

  // putMany with a record that has the same key should throw
  await assert.rejects(
    () =>
      ds.putMany([
        { key: 'new1', payload: { v: 2 } },
        { key: 'dup', payload: { v: 3 } },
      ]),
    (error) => error instanceof Error && error.name === 'ValidationError',
  );

  await ds.close();
});

test('P12: putMany with reject policy throws on intra-batch duplicate', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'reject',
  });

  // Two records with the same key in one batch
  await assert.rejects(
    () =>
      ds.putMany([
        { key: 'same', payload: { v: 1 } },
        { key: 'same', payload: { v: 2 } },
      ]),
    (error) => error instanceof Error && error.name === 'ValidationError',
  );

  await ds.close();
});

test('P12: deleteMany on pure in-memory datastore deletes correct count', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.putMany([
    { key: 'a', payload: { v: 1 } },
    { key: 'b', payload: { v: 2 } },
    { key: 'c', payload: { v: 3 } },
    { key: 'd', payload: { v: 4 } },
  ]);

  const deleted = await ds.deleteMany(['a', 'c', 'missing']);
  assert.equal(deleted, 2);
  assert.equal(await ds.count(), 2);

  // Verify remaining
  assert.equal(await ds.has('b'), true);
  assert.equal(await ds.has('d'), true);

  await ds.close();
});

test('P12: deleteMany returns 0 when no keys match', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.put({ key: 'a', payload: { v: 1 } });

  const deleted = await ds.deleteMany(['x', 'y', 'z']);
  assert.equal(deleted, 0);
  assert.equal(await ds.count(), 1);

  await ds.close();
});

test('P12: putMany with replace policy replaces existing keys', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'replace',
  });

  await ds.put({ key: 'a', payload: { v: 'old' } });

  await ds.putMany([
    { key: 'a', payload: { v: 'new' } },
    { key: 'b', payload: { v: 'fresh' } },
  ]);

  assert.equal(await ds.count(), 2);
  const results = await ds.get('a');
  assert.equal(results[0].payload.v, 'new');

  await ds.close();
});

test('P12: deleteMany with duplicate keys in input (allow policy)', async () => {
  const { Datastore } = await loadStorageModule();
  const ds = new Datastore({ key: createStringKeyDefinition() });

  await ds.putMany([
    { key: 'a', payload: { v: 1 } },
    { key: 'a', payload: { v: 2 } },
    { key: 'b', payload: { v: 3 } },
  ]);

  // Delete 'a' which has 2 entries
  const deleted = await ds.deleteMany(['a']);
  assert.equal(deleted, 2);
  assert.equal(await ds.count(), 1);

  await ds.close();
});
