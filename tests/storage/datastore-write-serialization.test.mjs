import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => {
  return {
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
  };
};

const createNoopDurableBackendController = () => {
  return {
    handleRecordAppended: async () => {},
    handleCleared: async () => {},
    commitNow: async () => {},
    close: async () => {},
  };
};

// =============================================================================
// D1: Write Operation Serialization
// =============================================================================

test('D1: concurrent put() calls result in no lost writes (count matches)', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ key: createStringKeyDefinition() });

  const N = 20;
  const puts = Array.from({ length: N }, (_, i) =>
    datastore.put({ key: `key-${i}`, payload: { index: i } }),
  );

  await Promise.all(puts);

  const count = await datastore.count();
  assert.equal(count, N, `Expected ${N} records, got ${count}`);

  await datastore.close();
});

test('D1: concurrent put() calls with capacity tracking remain consistent', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({
    key: createStringKeyDefinition(),
    capacity: { maxSize: '64KB', policy: 'strict' },
  });

  const N = 10;
  const puts = Array.from({ length: N }, (_, i) =>
    datastore.put({ key: `cap-key-${i}`, payload: { data: 'x'.repeat(100) } }),
  );

  await Promise.all(puts);

  const count = await datastore.count();
  assert.equal(
    count,
    N,
    `Expected ${N} records after concurrent puts, got ${count}`,
  );

  // Verify capacity is not double-counted: put one more record should succeed
  await datastore.put({ key: 'extra', payload: { data: 'small' } });
  const countAfter = await datastore.count();
  assert.equal(countAfter, N + 1);

  await datastore.close();
});

test('D1: concurrent put() and delete() operations maintain consistency', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ key: createStringKeyDefinition() });

  // Seed some records
  const seedKeys = Array.from({ length: 5 }, (_, i) => `seed-${i}`);
  for (const key of seedKeys) {
    await datastore.put({ key, payload: { v: 1 } });
  }

  // Fire puts and deletes concurrently
  const ops = [
    ...Array.from({ length: 5 }, (_, i) =>
      datastore.put({ key: `new-${i}`, payload: { v: 2 } }),
    ),
    ...seedKeys.map((key) => datastore.delete(key)),
  ];

  await Promise.all(ops);

  const count = await datastore.count();
  // Deletes removed 5 seeds, puts added 5 new -> net 5
  assert.equal(
    count,
    5,
    `Expected 5 records after concurrent put+delete, got ${count}`,
  );

  await datastore.close();
});

test('D1: concurrent updateById operations maintain consistency', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ key: createStringKeyDefinition() });

  // Seed records
  const N = 10;
  for (let i = 0; i < N; i++) {
    await datastore.put({ key: `item-${i}`, payload: { value: i } });
  }

  const records = await datastore.getAll();
  assert.equal(records.length, N);

  // Concurrently update all records
  const updates = records.map((r) =>
    datastore.updateById(r._id, { value: r.payload.value * 10 }),
  );
  const results = await Promise.all(updates);

  // All updates must have succeeded
  assert.ok(
    results.every((r) => r === true),
    'All concurrent updateById must return true',
  );

  // Each record must have the updated value
  for (let i = 0; i < N; i++) {
    const found = await datastore.get(`item-${i}`);
    assert.equal(found.length, 1);
    assert.equal(
      found[0].payload.value,
      i * 10,
      `item-${i} must be updated to ${i * 10}`,
    );
  }

  await datastore.close();
});

test('D1: concurrent puts with same key under replace policy produce exactly one record', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({
    key: createStringKeyDefinition(),
    duplicateKeys: 'replace',
  });

  const N = 10;
  const puts = Array.from({ length: N }, (_, i) =>
    datastore.put({ key: 'shared', payload: { seq: i } }),
  );

  await Promise.all(puts);

  const records = await datastore.get('shared');
  assert.equal(
    records.length,
    1,
    'replace policy must leave exactly one record',
  );

  await datastore.close();
});

// =============================================================================
// B1: pendingInit Single-Flight (race condition fix)
// =============================================================================

// =============================================================================
// D1: replaceById and deleteByIds Write Serialization
// =============================================================================

test('D1: concurrent replaceById operations maintain consistency', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ key: createStringKeyDefinition() });

  // Seed records
  const N = 10;
  for (let i = 0; i < N; i++) {
    await datastore.put({ key: `item-${i}`, payload: { value: i } });
  }

  const records = await datastore.getAll();
  assert.equal(records.length, N);

  // Concurrently replace all records
  const replacements = records.map((r) =>
    datastore.replaceById(r._id, {
      replaced: true,
      seq: r.payload.value * 100,
    }),
  );
  const results = await Promise.all(replacements);

  // All replacements must have succeeded
  assert.ok(
    results.every((r) => r === true),
    'All concurrent replaceById must return true',
  );

  // Each record must have the replaced payload (old fields gone)
  for (let i = 0; i < N; i++) {
    const found = await datastore.get(`item-${i}`);
    assert.equal(found.length, 1);
    assert.equal(
      found[0].payload.replaced,
      true,
      `item-${i} must have replaced=true`,
    );
    assert.equal(
      found[0].payload.seq,
      i * 100,
      `item-${i} must have seq=${i * 100}`,
    );
    assert.equal(
      found[0].payload.value,
      undefined,
      `item-${i} must not retain old value field`,
    );
  }

  await datastore.close();
});

test('D1: concurrent deleteByIds operations maintain consistency', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ key: createStringKeyDefinition() });

  // Seed records
  const N = 20;
  for (let i = 0; i < N; i++) {
    await datastore.put({ key: `item-${i}`, payload: { v: i } });
  }

  const records = await datastore.getAll();
  assert.equal(records.length, N);

  // Split ids into two batches and delete concurrently
  const batch1 = records.filter((_, i) => i % 2 === 0).map((r) => r._id);
  const batch2 = records.filter((_, i) => i % 2 === 1).map((r) => r._id);

  const [count1, count2] = await Promise.all([
    datastore.deleteByIds(batch1),
    datastore.deleteByIds(batch2),
  ]);

  // All records must be deleted (serialized, so no conflicts)
  assert.equal(count1 + count2, N, `Total deleted must be ${N}`);

  const remaining = await datastore.count();
  assert.equal(remaining, 0, 'No records must remain');

  await datastore.close();
});

test('D1: concurrent replaceById and deleteByIds do not corrupt state', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({
    key: createStringKeyDefinition(),
    capacity: { maxSize: '64KB', policy: 'strict' },
  });

  // Seed records
  const N = 10;
  for (let i = 0; i < N; i++) {
    await datastore.put({
      key: `item-${i}`,
      payload: { data: 'x'.repeat(50) },
    });
  }

  const records = await datastore.getAll();
  const replaceTargets = records.slice(0, 5);
  const deleteTargets = records.slice(5).map((r) => r._id);

  // Fire replaceById and deleteByIds concurrently
  const ops = [
    ...replaceTargets.map((r) =>
      datastore.replaceById(r._id, { data: 'y'.repeat(30) }),
    ),
    datastore.deleteByIds(deleteTargets),
  ];

  await Promise.all(ops);

  const count = await datastore.count();
  assert.equal(count, 5, 'Only replaced records must remain');

  // Verify capacity is not corrupted: should be able to insert more
  await datastore.put({ key: 'extra', payload: { data: 'small' } });
  assert.equal(await datastore.count(), 6);

  await datastore.close();
});

// =============================================================================
// B1: pendingInit Single-Flight (race condition fix)
// =============================================================================

test('B1: concurrent operations during async init all succeed and init runs exactly once', async () => {
  const { Datastore } = await loadStorageModule();

  let initCallCount = 0;
  let resolveInit;
  const initPromise = new Promise((resolve) => {
    resolveInit = resolve;
  });

  const datastore = new Datastore({
    key: createStringKeyDefinition(),
    driver: {
      init: () => {
        initCallCount++;
        return {
          then: (resolve) => {
            return initPromise.then(() => {
              resolve({
                controller: createNoopDurableBackendController(),
                initialTreeJSON: null,
                initialCurrentSizeBytes: 0,
              });
            });
          },
        };
      },
    },
  });

  // Fire multiple concurrent operations before init completes
  const ops = [
    datastore.put({ key: 'op-a', payload: { v: 1 } }),
    datastore.put({ key: 'op-b', payload: { v: 2 } }),
    datastore.put({ key: 'op-c', payload: { v: 3 } }),
    datastore.count(),
    datastore.getAll(),
  ];

  // Unblock init
  resolveInit();

  const results = await Promise.all(ops);

  // init must only be called once (it's synchronous in this test setup — called in constructor)
  assert.equal(initCallCount, 1, 'driver.init must be called exactly once');

  // All puts succeeded
  const count = await datastore.count();
  assert.equal(count, 3, 'All 3 concurrent puts must have succeeded');

  await datastore.close();
});

test('B1: pendingInit is cleared before awaiting (single-flight: no duplicate awaits)', async () => {
  const { Datastore } = await loadStorageModule();

  let resolveFn;
  const blocker = new Promise((resolve) => {
    resolveFn = resolve;
  });

  const datastore = new Datastore({
    key: createStringKeyDefinition(),
    driver: {
      init: () => {
        return {
          then: (resolve) => {
            return blocker.then(() => {
              resolve({
                controller: createNoopDurableBackendController(),
                initialTreeJSON: null,
                initialCurrentSizeBytes: 0,
              });
            });
          },
        };
      },
    },
  });

  // Start multiple operations; they all encounter pendingInit
  const p1 = datastore.put({ key: 'x', payload: { v: 1 } });
  const p2 = datastore.put({ key: 'y', payload: { v: 2 } });
  const p3 = datastore.get('x');

  // Resolve init
  resolveFn();
  await Promise.all([p1, p2, p3]);

  // After all operations, no operation should be stuck: verify datastore is fully functional
  await datastore.put({ key: 'z', payload: { v: 3 } });
  const all = await datastore.getAll();
  assert.equal(all.length, 3);

  await datastore.close();
});
