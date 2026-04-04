import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore } from '../../dist/index.js';

describe('Datastore ID-based operations', () => {
  let ds;
  let insertedId;

  before(async () => {
    ds = new Datastore({});
    await ds.put({ key: 'item1', payload: { name: 'first', score: 10 } });
    await ds.put({ key: 'item2', payload: { name: 'second', score: 20 } });
    await ds.put({ key: 'item3', payload: { name: 'third', score: 30 } });

    const all = await ds.getAll();
    insertedId = all[0]._id;
  });

  after(async () => {
    await ds.close();
  });

  it('getById returns matching record', async () => {
    const record = await ds.getById(insertedId);
    assert.notEqual(record, null);
    assert.equal(record._id, insertedId);
    assert.equal(record.key, 'item1');
    assert.deepStrictEqual(record.payload, { name: 'first', score: 10 });
  });

  it('getById returns null for unknown id', async () => {
    const record = await ds.getById(999999);
    assert.equal(record, null);
  });

  it('updateById patches the payload', async () => {
    const updated = await ds.updateById(insertedId, { score: 99 });
    assert.equal(updated, true);

    const record = await ds.getById(insertedId);
    assert.equal(record.payload.score, 99);
    assert.equal(record.payload.name, 'first');
  });

  it('updateById returns false for unknown id', async () => {
    const updated = await ds.updateById(999999, { score: 0 });
    assert.equal(updated, false);
  });

  it('deleteById removes the record', async () => {
    const all = await ds.getAll();
    const targetId = all[all.length - 1]._id;

    const deleted = await ds.deleteById(targetId);
    assert.equal(deleted, true);

    const record = await ds.getById(targetId);
    assert.equal(record, null);
  });

  it('deleteById returns false for unknown id', async () => {
    const deleted = await ds.deleteById(999999);
    assert.equal(deleted, false);
  });
});
