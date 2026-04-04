import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'string') throw new TypeError(`${fieldName} must be string.`);
    if (value.length === 0) throw new TypeError(`${fieldName} must not be empty.`);
    return value;
  },
  compare: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
});

describe("duplicateKeys: 'replace' capacity accounting", () => {
  test('replace with strict capacity: valid replace must not be rejected', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 300, policy: 'strict' },
    });

    try {
      await datastore.put({ key: 'a', payload: { v: 'x'.repeat(100) } });
      // Same-size replace must not trigger quota even though full encoded bytes are near/over limit
      await datastore.put({ key: 'a', payload: { v: 'y'.repeat(100) } });

      const records = await datastore.get('a');
      assert.equal(records.length, 1);
      assert.equal(records[0].payload.v, 'y'.repeat(100));
    } finally {
      await datastore.close();
    }
  });

  test('replace with strict capacity: reject when delta truly exceeds limit', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 300, policy: 'strict' },
    });

    try {
      await datastore.put({ key: 'a', payload: { v: 'x' } });
      // Delta alone (large replacement - tiny original) would exceed maxSize
      await assert.rejects(
        () => datastore.put({ key: 'a', payload: { v: 'z'.repeat(500) } }),
        (error) => error instanceof QuotaExceededError,
      );
    } finally {
      await datastore.close();
    }
  });

  test('replace with turnover: replacing key must not evict unrelated keys', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 500, policy: 'turnover' },
    });

    try {
      await datastore.put({ key: 'a', payload: { v: 'aaa' } });
      await datastore.put({ key: 'b', payload: { v: 'bbb' } });
      await datastore.put({ key: 'c', payload: { v: 'ccc' } });

      // Replace 'b' with similar-sized payload — must not evict 'a'
      await datastore.put({ key: 'b', payload: { v: 'BBB' } });

      const a = await datastore.get('a');
      const b = await datastore.get('b');
      const c = await datastore.get('c');

      assert.equal(a.length, 1, "key 'a' must not be evicted");
      assert.equal(b.length, 1, "key 'b' must exist after replace");
      assert.equal(c.length, 1, "key 'c' must not be evicted");
      assert.equal(b[0].payload.v, 'BBB');
    } finally {
      await datastore.close();
    }
  });

  test('replace with turnover: currentSizeBytes tracks correctly after multiple replacements', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 500, policy: 'turnover' },
    });

    try {
      await datastore.put({ key: 'a', payload: { v: 'x'.repeat(50) } });
      // Replace 'a' with a smaller payload — should free space
      await datastore.put({ key: 'a', payload: { v: 'y' } });
      await datastore.put({ key: 'b', payload: { v: 'z'.repeat(50) } });

      const a = await datastore.get('a');
      const b = await datastore.get('b');

      assert.equal(a.length, 1);
      assert.equal(b.length, 1);
      assert.equal(a[0].payload.v, 'y');
    } finally {
      await datastore.close();
    }
  });

  test('replace rejects record that individually exceeds maxSize even when delta is small', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 300, policy: 'strict' },
    });

    try {
      // Insert a large record that fits just under maxSize
      await datastore.put({ key: 'a', payload: { v: 'x'.repeat(200) } });
      // Replace with an even larger record that exceeds maxSize individually,
      // even though the delta might be small
      await assert.rejects(
        () => datastore.put({ key: 'a', payload: { v: 'z'.repeat(500) } }),
        (error) => error instanceof QuotaExceededError,
      );
    } finally {
      await datastore.close();
    }
  });

  test('replace shrinking payload frees capacity for new records', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 300, policy: 'strict' },
    });

    try {
      // Fill near capacity
      await datastore.put({ key: 'big', payload: { v: 'x'.repeat(200) } });
      // Shrink the record — must free capacity
      await datastore.put({ key: 'big', payload: { v: 'y' } });
      // This new record must succeed because the shrink freed space
      await datastore.put({ key: 'new', payload: { v: 'z'.repeat(100) } });

      const big = await datastore.get('big');
      const newRec = await datastore.get('new');

      assert.equal(big.length, 1);
      assert.equal(newRec.length, 1);
      assert.equal(big[0].payload.v, 'y');
    } finally {
      await datastore.close();
    }
  });
});
