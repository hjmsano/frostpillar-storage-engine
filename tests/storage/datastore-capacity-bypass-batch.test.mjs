import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'string')
      throw new TypeError(`${fieldName} must be string.`);
    if (value.length === 0)
      throw new TypeError(`${fieldName} must not be empty.`);
    return value;
  },
  compare: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
});

// ---------------------------------------------------------------------------
// P5-A: Capacity-Bypass Fast Path
// ---------------------------------------------------------------------------

describe('P5-A: Capacity-Bypass Fast Path (no capacity config)', () => {
  test('in-memory, no capacity: put() succeeds and record is retrievable', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({ key: createStringKeyDefinition() });
    try {
      await datastore.put({ key: 'hello', payload: { v: 'world' } });
      const records = await datastore.get('hello');
      assert.equal(records.length, 1);
      assert.equal(records[0].payload.v, 'world');
    } finally {
      await datastore.close();
    }
  });

  test('in-memory, no capacity: putMany() succeeds for batch, all records retrievable', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({ key: createStringKeyDefinition() });
    try {
      await datastore.putMany([
        { key: 'a', payload: { v: '1' } },
        { key: 'b', payload: { v: '2' } },
        { key: 'c', payload: { v: '3' } },
      ]);
      assert.equal(await datastore.count(), 3);
      const a = await datastore.get('a');
      const b = await datastore.get('b');
      const c = await datastore.get('c');
      assert.equal(a[0].payload.v, '1');
      assert.equal(b[0].payload.v, '2');
      assert.equal(c[0].payload.v, '3');
    } finally {
      await datastore.close();
    }
  });

  test('with capacity: existing behavior unchanged (put works, quota enforced)', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: 200, policy: 'strict' },
    });
    try {
      await datastore.put({ key: 'x', payload: { v: 'small' } });
      const records = await datastore.get('x');
      assert.equal(records.length, 1);

      await assert.rejects(
        () => datastore.put({ key: 'y', payload: { v: 'z'.repeat(300) } }),
        (err) => err instanceof QuotaExceededError,
      );
    } finally {
      await datastore.close();
    }
  });
});

// ---------------------------------------------------------------------------
// P5-B: Batch putMany with Strict Atomicity
// ---------------------------------------------------------------------------

describe('P5-B: Batch putMany with Strict Atomicity', () => {
  test('strict policy, batch fits: putMany() inserts all records; count() reflects total', async () => {
    const { Datastore } = await loadStorageModule();
    // Use a large enough maxSize so all records fit
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: 2000, policy: 'strict' },
    });
    try {
      await datastore.putMany([
        { key: 'k1', payload: { v: 'aaa' } },
        { key: 'k2', payload: { v: 'bbb' } },
        { key: 'k3', payload: { v: 'ccc' } },
      ]);
      assert.equal(await datastore.count(), 3);
    } finally {
      await datastore.close();
    }
  });

  test('strict policy, batch overflows: putMany() throws QuotaExceededError; count() is 0 (no partial insertion)', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    // maxSize tight enough so 3 records together exceed it but individually fit
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: 120, policy: 'strict' },
    });
    try {
      await assert.rejects(
        () =>
          datastore.putMany([
            { key: 'k1', payload: { v: 'a'.repeat(30) } },
            { key: 'k2', payload: { v: 'b'.repeat(30) } },
            { key: 'k3', payload: { v: 'c'.repeat(30) } },
          ]),
        (err) => err instanceof QuotaExceededError,
      );
      // Atomicity: no partial insertion
      assert.equal(await datastore.count(), 0);
    } finally {
      await datastore.close();
    }
  });

  test('strict policy, single oversized record in batch: throws QuotaExceededError; count() is 0', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: 200, policy: 'strict' },
    });
    try {
      await assert.rejects(
        () =>
          datastore.putMany([
            { key: 'k1', payload: { v: 'small' } },
            { key: 'k2', payload: { v: 'z'.repeat(500) } },
          ]),
        (err) => err instanceof QuotaExceededError,
      );
      assert.equal(await datastore.count(), 0);
    } finally {
      await datastore.close();
    }
  });

  test('turnover policy, batch: putMany() inserts records with eviction', async () => {
    const { Datastore } = await loadStorageModule();
    // Keys are ordered so that 'aaa' < 'bbb' < 'ppp' < 'qqq'.
    // popFirst() evicts the smallest key, so 'aaa' is evicted when 'qqq' would overflow.
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: 300, policy: 'turnover' },
    });
    try {
      await datastore.put({ key: 'aaa', payload: { v: 'x'.repeat(60) } });
      await datastore.put({ key: 'bbb', payload: { v: 'y'.repeat(60) } });
      // 'ppp' fits without eviction; 'qqq' triggers eviction of 'aaa' (smallest)
      await datastore.putMany([
        { key: 'ppp', payload: { v: 'a'.repeat(60) } },
        { key: 'qqq', payload: { v: 'b'.repeat(60) } },
      ]);
      // ppp and qqq must be retrievable
      const p = await datastore.get('ppp');
      const q = await datastore.get('qqq');
      assert.equal(p.length, 1);
      assert.equal(q.length, 1);
    } finally {
      await datastore.close();
    }
  });

  test('no capacity, batch: putMany() inserts all records', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({ key: createStringKeyDefinition() });
    try {
      await datastore.putMany([
        { key: 'x1', payload: { n: 1 } },
        { key: 'x2', payload: { n: 2 } },
        { key: 'x3', payload: { n: 3 } },
        { key: 'x4', payload: { n: 4 } },
      ]);
      assert.equal(await datastore.count(), 4);
    } finally {
      await datastore.close();
    }
  });

  test('strict policy with replace, batch fits: all records inserted/replaced correctly', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 2000, policy: 'strict' },
    });
    try {
      await datastore.put({ key: 'r1', payload: { v: 'original' } });
      // Batch replaces r1 and adds r2
      await datastore.putMany([
        { key: 'r1', payload: { v: 'replaced' } },
        { key: 'r2', payload: { v: 'new' } },
      ]);
      const r1 = await datastore.get('r1');
      const r2 = await datastore.get('r2');
      assert.equal(r1.length, 1);
      assert.equal(r1[0].payload.v, 'replaced');
      assert.equal(r2.length, 1);
      assert.equal(r2[0].payload.v, 'new');
      assert.equal(await datastore.count(), 2);
    } finally {
      await datastore.close();
    }
  });

  test('strict policy, batch exactly at limit: succeeds', async () => {
    const { Datastore } = await loadStorageModule();
    const { estimateRecordSizeBytes } = await importDistModule(
      'storage/backend/encoding.js',
    );

    // Compute exact bytes for a known record, then set maxSize to that exact value
    const key = 'exact';
    const payload = { v: 'fit' };
    const exactBytes = estimateRecordSizeBytes(key, payload);

    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: exactBytes, policy: 'strict' },
    });
    try {
      // Single record that exactly hits maxSizeBytes — must succeed
      await datastore.putMany([{ key, payload }]);
      assert.equal(await datastore.count(), 1);
    } finally {
      await datastore.close();
    }
  });

  test('strict policy, batch atomicity: pre-existing records unaffected on overflow', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      capacity: { maxSize: 300, policy: 'strict' },
    });
    try {
      await datastore.put({ key: 'existing', payload: { v: 'keep' } });
      const countBefore = await datastore.count();

      await assert.rejects(
        () =>
          datastore.putMany([
            { key: 'n1', payload: { v: 'a'.repeat(50) } },
            { key: 'n2', payload: { v: 'b'.repeat(50) } },
            { key: 'n3', payload: { v: 'c'.repeat(50) } },
            { key: 'n4', payload: { v: 'd'.repeat(50) } },
          ]),
        (err) => err instanceof QuotaExceededError,
      );

      // Pre-existing record must still be there, no new records inserted
      assert.equal(await datastore.count(), countBefore);
      const existing = await datastore.get('existing');
      assert.equal(existing.length, 1);
      assert.equal(existing[0].payload.v, 'keep');
    } finally {
      await datastore.close();
    }
  });

  test('strict policy with reject: intra-batch duplicate key throws ValidationError; count() is 0', async () => {
    const { Datastore } = await loadStorageModule();
    const { ValidationError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'reject',
      capacity: { maxSize: 2000, policy: 'strict' },
    });
    try {
      await assert.rejects(
        () =>
          datastore.putMany([
            { key: 'dup', payload: { v: 'first' } },
            { key: 'dup', payload: { v: 'second' } },
          ]),
        (err) => err instanceof ValidationError,
      );
      assert.equal(await datastore.count(), 0);
    } finally {
      await datastore.close();
    }
  });

  test('turnover policy, non-atomic: partial insertion survives mid-batch reject-policy failure', async () => {
    const { Datastore } = await loadStorageModule();
    const { ValidationError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'reject',
      capacity: { maxSize: 2000, policy: 'turnover' },
    });
    try {
      await datastore.put({ key: 'existing', payload: { v: 'pre' } });
      // Second record has duplicate key 'existing' → fails
      await assert.rejects(
        () =>
          datastore.putMany([
            { key: 'new1', payload: { v: 'ok' } },
            { key: 'existing', payload: { v: 'dup' } },
          ]),
        (err) => err instanceof ValidationError,
      );
      // Non-atomic: 'new1' was inserted before failure
      assert.equal(await datastore.count(), 2);
      const n1 = await datastore.get('new1');
      assert.equal(n1.length, 1);
    } finally {
      await datastore.close();
    }
  });

  test('no capacity, non-atomic: partial insertion survives mid-batch reject-policy failure', async () => {
    const { Datastore } = await loadStorageModule();
    const { ValidationError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'reject',
    });
    try {
      await datastore.put({ key: 'existing', payload: { v: 'pre' } });
      await assert.rejects(
        () =>
          datastore.putMany([
            { key: 'new1', payload: { v: 'ok' } },
            { key: 'existing', payload: { v: 'dup' } },
          ]),
        (err) => err instanceof ValidationError,
      );
      // Non-atomic: 'new1' was inserted before failure
      assert.equal(await datastore.count(), 2);
    } finally {
      await datastore.close();
    }
  });

  test('strict policy with replace: shrink replacement frees capacity for additional records', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 300, policy: 'strict' },
    });
    try {
      // Fill near capacity with a large record
      await datastore.put({ key: 'big', payload: { v: 'x'.repeat(100) } });
      // Batch: shrink 'big' and add a new record — net delta should fit
      await datastore.putMany([
        { key: 'big', payload: { v: 'tiny' } },
        { key: 'new', payload: { v: 'hello' } },
      ]);
      assert.equal(await datastore.count(), 2);
      const big = await datastore.get('big');
      assert.equal(big[0].payload.v, 'tiny');
    } finally {
      await datastore.close();
    }
  });
});
