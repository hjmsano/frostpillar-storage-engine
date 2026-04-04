import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore } from '../../dist/index.js';

describe('Datastore bulk operations', () => {
  let ds;

  before(() => {
    ds = new Datastore({});
  });

  after(async () => {
    await ds.close();
  });

  it('putMany inserts multiple records', async () => {
    await ds.putMany([
      { key: 'x', payload: { v: 1 } },
      { key: 'y', payload: { v: 2 } },
      { key: 'z', payload: { v: 3 } },
    ]);
    const count = await ds.count();
    assert.equal(count, 3);
  });

  it('putMany preserves insertion order by key sort', async () => {
    const all = await ds.getAll();
    assert.equal(all[0].key, 'x');
    assert.equal(all[1].key, 'y');
    assert.equal(all[2].key, 'z');
  });

  it('deleteMany removes multiple keys', async () => {
    const removed = await ds.deleteMany(['x', 'z']);
    assert.equal(removed, 2);
    const count = await ds.count();
    assert.equal(count, 1);
    const remaining = await ds.getAll();
    assert.equal(remaining[0].key, 'y');
  });

  it('deleteMany returns 0 for non-existent keys', async () => {
    const removed = await ds.deleteMany(['nonexistent1', 'nonexistent2']);
    assert.equal(removed, 0);
  });

  it('putMany with empty array is a no-op', async () => {
    const countBefore = await ds.count();
    await ds.putMany([]);
    const countAfter = await ds.count();
    assert.equal(countBefore, countAfter);
  });

  it('deleteMany with empty array returns 0', async () => {
    const removed = await ds.deleteMany([]);
    assert.equal(removed, 0);
  });
});
