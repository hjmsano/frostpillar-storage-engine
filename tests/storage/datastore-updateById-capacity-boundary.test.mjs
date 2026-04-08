import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

describe('updateById capacity boundary checks', () => {
  test('updateById rejects when update would exceed strict capacity', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      capacity: { maxSize: 200, policy: 'strict' },
    });

    try {
      await datastore.put({ key: 'k1', payload: { v: 'x' } });

      const records = await datastore.get('k1');
      const id = records[0]._id;

      await assert.rejects(
        () => datastore.updateById(id, { v: 'y'.repeat(500) }),
        QuotaExceededError,
      );
    } finally {
      await datastore.close();
    }
  });

  test('updateById allows update that shrinks size', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      capacity: { maxSize: 200, policy: 'strict' },
    });

    try {
      await datastore.put({ key: 'k1', payload: { v: 'a'.repeat(50) } });

      const records = await datastore.get('k1');
      const id = records[0]._id;

      const result = await datastore.updateById(id, { v: 'b' });
      assert.equal(
        result,
        true,
        'updateById must succeed when shrinking payload',
      );

      const after = await datastore.getById(id);
      assert.equal(after.payload.v, 'b');
    } finally {
      await datastore.close();
    }
  });

  test('updateById does NOT trigger turnover eviction', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const datastore = new Datastore({
      capacity: { maxSize: 200, policy: 'turnover' },
    });

    try {
      await datastore.put({ key: 'k1', payload: { v: 'a' } });
      await datastore.put({ key: 'k2', payload: { v: 'b' } });

      const records = await datastore.get('k1');
      const id = records[0]._id;

      // Attempt an update with a patch large enough to exceed capacity.
      // Under turnover policy, put() would evict the oldest record,
      // but updateById must NOT evict — it should throw instead.
      await assert.rejects(
        () => datastore.updateById(id, { v: 'z'.repeat(500) }),
        QuotaExceededError,
      );

      // Verify both original records still exist (no eviction occurred)
      const allRecords = await datastore.getAll();
      assert.equal(
        allRecords.length,
        2,
        'turnover eviction must not be triggered by updateById',
      );
    } finally {
      await datastore.close();
    }
  });
});
