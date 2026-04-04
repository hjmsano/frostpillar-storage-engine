import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore } from '../../dist/index.js';

describe('Datastore deleteByIds', () => {
  describe('basic behavior', () => {
    let ds;
    let ids;

    before(async () => {
      ds = new Datastore({});
      await ds.put({ key: 'a', payload: { v: 1 } });
      await ds.put({ key: 'b', payload: { v: 2 } });
      await ds.put({ key: 'c', payload: { v: 3 } });
      await ds.put({ key: 'd', payload: { v: 4 } });
      await ds.put({ key: 'e', payload: { v: 5 } });
      const all = await ds.getAll();
      ids = all.map((r) => r._id);
    });

    after(async () => {
      await ds.close();
    });

    it('deletes multiple records by ids', async () => {
      const deleted = await ds.deleteByIds([ids[0], ids[2], ids[4]]);
      assert.equal(deleted, 3);

      const remaining = await ds.getAll();
      assert.equal(remaining.length, 2);
      assert.deepStrictEqual(remaining.map((r) => r.payload.v), [2, 4]);
    });

    it('deleted records are inaccessible by getById', async () => {
      assert.equal(await ds.getById(ids[0]), null);
      assert.equal(await ds.getById(ids[2]), null);
      assert.equal(await ds.getById(ids[4]), null);
    });
  });

  describe('empty array', () => {
    let ds;

    before(async () => {
      ds = new Datastore({});
      await ds.put({ key: 'a', payload: { v: 1 } });
    });

    after(async () => {
      await ds.close();
    });

    it('returns 0 for empty array', async () => {
      const deleted = await ds.deleteByIds([]);
      assert.equal(deleted, 0);
      assert.equal(await ds.count(), 1);
    });
  });

  describe('non-existent ids', () => {
    let ds;

    before(async () => {
      ds = new Datastore({});
      await ds.put({ key: 'a', payload: { v: 1 } });
    });

    after(async () => {
      await ds.close();
    });

    it('skips non-existent ids and returns count of actually deleted', async () => {
      const all = await ds.getAll();
      const validId = all[0]._id;
      const deleted = await ds.deleteByIds([999999, validId, 888888]);
      assert.equal(deleted, 1);
      assert.equal(await ds.count(), 0);
    });
  });

  describe('duplicate keys mode', () => {
    let ds;

    before(async () => {
      ds = new Datastore({ duplicateKeys: 'allow' });
      await ds.put({ key: 'shared', payload: { v: 1 } });
      await ds.put({ key: 'shared', payload: { v: 2 } });
      await ds.put({ key: 'shared', payload: { v: 3 } });
      await ds.put({ key: 'shared', payload: { v: 4 } });
    });

    after(async () => {
      await ds.close();
    });

    it('deletes specific records among duplicates without affecting others', async () => {
      const all = await ds.get('shared');
      // Delete only the 2nd and 4th records
      const deleted = await ds.deleteByIds([all[1]._id, all[3]._id]);
      assert.equal(deleted, 2);

      const remaining = await ds.get('shared');
      assert.equal(remaining.length, 2);
      assert.deepStrictEqual(remaining.map((r) => r.payload.v), [1, 3]);
    });
  });

  describe('capacity size tracking', () => {
    let ds;

    before(async () => {
      ds = new Datastore({
        capacity: { maxSize: '10KB', policy: 'strict' },
      });
      await ds.put({ key: 'a', payload: { data: 'aaa' } });
      await ds.put({ key: 'b', payload: { data: 'bbb' } });
      await ds.put({ key: 'c', payload: { data: 'ccc' } });
    });

    after(async () => {
      await ds.close();
    });

    it('frees capacity after batch deletion', async () => {
      const all = await ds.getAll();
      await ds.deleteByIds([all[0]._id, all[1]._id]);

      // Should be able to insert new records in freed space
      await ds.put({ key: 'x', payload: { data: 'xxx' } });
      assert.equal(await ds.count(), 2);
    });
  });

  describe('all ids non-existent', () => {
    let ds;

    before(async () => {
      ds = new Datastore({});
      await ds.put({ key: 'a', payload: { v: 1 } });
    });

    after(async () => {
      await ds.close();
    });

    it('returns 0 when all ids are non-existent', async () => {
      const deleted = await ds.deleteByIds([999999, 888888, 777777]);
      assert.equal(deleted, 0);
      assert.equal(await ds.count(), 1);
    });
  });

  describe('closed datastore', () => {
    it('rejects after close', async () => {
      const ds = new Datastore({});
      await ds.put({ key: 'a', payload: { v: 1 } });
      const all = await ds.getAll();
      await ds.close();
      await assert.rejects(
        () => ds.deleteByIds([all[0]._id]),
        (err) => err.constructor.name === 'ClosedDatastoreError',
      );
    });
  });
});
