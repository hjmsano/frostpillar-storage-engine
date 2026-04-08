import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore } from '../../dist/index.js';

describe('Datastore replaceById', () => {
  describe('basic behavior', () => {
    let ds;
    let idA;

    before(async () => {
      ds = new Datastore({});
      await ds.put({
        key: 'k1',
        payload: { name: 'alice', age: 30, city: 'tokyo' },
      });
      await ds.put({ key: 'k2', payload: { name: 'bob', age: 25 } });
      const all = await ds.getAll();
      idA = all[0]._id;
    });

    after(async () => {
      await ds.close();
    });

    it('fully replaces the payload (old fields removed)', async () => {
      const replaced = await ds.replaceById(idA, {
        name: 'alice-v2',
        score: 100,
      });
      assert.equal(replaced, true);

      const record = await ds.getById(idA);
      assert.deepStrictEqual(record.payload, { name: 'alice-v2', score: 100 });
      // 'age' and 'city' must be gone
      assert.equal(record.payload.age, undefined);
      assert.equal(record.payload.city, undefined);
    });

    it('preserves key and _id', async () => {
      const record = await ds.getById(idA);
      assert.equal(record._id, idA);
      assert.equal(record.key, 'k1');
    });

    it('returns false for unknown id', async () => {
      const replaced = await ds.replaceById(999999, { x: 1 });
      assert.equal(replaced, false);
    });

    it('record is still visible via key-based get', async () => {
      const records = await ds.get('k1');
      assert.equal(records.length, 1);
      assert.deepStrictEqual(records[0].payload, {
        name: 'alice-v2',
        score: 100,
      });
    });
  });

  describe('payload validation', () => {
    let ds;
    let idA;

    before(async () => {
      ds = new Datastore({});
      await ds.put({ key: 'k1', payload: { name: 'alice' } });
      const all = await ds.getAll();
      idA = all[0]._id;
    });

    after(async () => {
      await ds.close();
    });

    it('rejects invalid payload and leaves record unchanged', async () => {
      await assert.rejects(
        () => ds.replaceById(idA, { bad: undefined }),
        (err) => err.constructor.name === 'ValidationError',
      );
      const record = await ds.getById(idA);
      assert.deepStrictEqual(record.payload, { name: 'alice' });
    });
  });

  describe('skipPayloadValidation mode', () => {
    let ds;
    let idA;

    before(async () => {
      ds = new Datastore({ skipPayloadValidation: true });
      await ds.put({ key: 'k1', payload: { name: 'alice' } });
      const all = await ds.getAll();
      idA = all[0]._id;
    });

    after(async () => {
      await ds.close();
    });

    it('replaces without validation when skipPayloadValidation is true', async () => {
      const replaced = await ds.replaceById(idA, { raw: 'data' });
      assert.equal(replaced, true);
      const record = await ds.getById(idA);
      assert.deepStrictEqual(record.payload, { raw: 'data' });
    });
  });

  describe('capacity enforcement (strict)', () => {
    let ds;
    let idA;

    before(async () => {
      ds = new Datastore({
        capacity: { maxSize: '1KB', policy: 'strict' },
      });
      await ds.put({ key: 'k1', payload: { x: 1 } });
      const all = await ds.getAll();
      idA = all[0]._id;
    });

    after(async () => {
      await ds.close();
    });

    it('allows replacement when new size fits within capacity', async () => {
      const replaced = await ds.replaceById(idA, { x: 2 });
      assert.equal(replaced, true);
    });

    it('rejects replacement that exceeds capacity', async () => {
      const bigPayload = { data: 'x'.repeat(2000) };
      await assert.rejects(
        () => ds.replaceById(idA, bigPayload),
        (err) => err.constructor.name === 'QuotaExceededError',
      );
      // Original record must be unchanged
      const record = await ds.getById(idA);
      assert.equal(record.payload.x, 2);
    });

    it('allows replacement that shrinks the record', async () => {
      // First make record bigger
      await ds.replaceById(idA, { data: 'medium-length-string' });
      // Then shrink it
      const replaced = await ds.replaceById(idA, { x: 1 });
      assert.equal(replaced, true);
    });
  });

  describe('count stays unchanged', () => {
    let ds;

    before(async () => {
      ds = new Datastore({});
      await ds.put({ key: 'k1', payload: { a: 1 } });
      await ds.put({ key: 'k2', payload: { b: 2 } });
    });

    after(async () => {
      await ds.close();
    });

    it('does not change record count', async () => {
      const before = await ds.count();
      const all = await ds.getAll();
      await ds.replaceById(all[0]._id, { replaced: true });
      const afterCount = await ds.count();
      assert.equal(before, afterCount);
    });
  });

  describe('duplicate keys mode', () => {
    let ds;

    before(async () => {
      ds = new Datastore({ duplicateKeys: 'allow' });
      await ds.put({ key: 'shared', payload: { v: 1 } });
      await ds.put({ key: 'shared', payload: { v: 2 } });
      await ds.put({ key: 'shared', payload: { v: 3 } });
    });

    after(async () => {
      await ds.close();
    });

    it('replaces only the targeted record among duplicates', async () => {
      const all = await ds.get('shared');
      const targetId = all[1]._id;
      await ds.replaceById(targetId, { v: 'replaced' });

      const after = await ds.get('shared');
      assert.equal(after.length, 3);
      assert.deepStrictEqual(after[0].payload, { v: 1 });
      assert.deepStrictEqual(after[1].payload, { v: 'replaced' });
      assert.deepStrictEqual(after[2].payload, { v: 3 });
    });
  });

  describe('closed datastore', () => {
    it('rejects after close', async () => {
      const ds = new Datastore({});
      await ds.put({ key: 'k1', payload: { a: 1 } });
      const all = await ds.getAll();
      const id = all[0]._id;
      await ds.close();
      await assert.rejects(
        () => ds.replaceById(id, { b: 2 }),
        (err) => err.constructor.name === 'ClosedDatastoreError',
      );
    });
  });
});
