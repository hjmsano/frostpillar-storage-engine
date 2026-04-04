import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore, InvalidQueryRangeError } from '../../dist/index.js';

describe('Datastore key-based operations', () => {
  let ds;

  before(async () => {
    ds = new Datastore({});
    await ds.put({ key: 'a', payload: { v: 1 } });
    await ds.put({ key: 'b', payload: { v: 2 } });
    await ds.put({ key: 'c', payload: { v: 3 } });
    await ds.put({ key: 'd', payload: { v: 4 } });
    await ds.put({ key: 'e', payload: { v: 5 } });
  });

  after(async () => {
    await ds.close();
  });

  it('getRange returns records within inclusive range', async () => {
    const results = await ds.getRange('b', 'd');
    assert.equal(results.length, 3);
    const keys = results.map((r) => r.key);
    assert.deepStrictEqual(keys, ['b', 'c', 'd']);
  });

  it('getRange throws when start > end', async () => {
    await assert.rejects(
      () => ds.getRange('d', 'a'),
      (err) => err instanceof InvalidQueryRangeError,
    );
  });

  it('getRange returns empty for non-overlapping range', async () => {
    const results = await ds.getRange('x', 'z');
    assert.equal(results.length, 0);
  });

  it('delete removes all records with a given key', async () => {
    const removed = await ds.delete('c');
    assert.equal(removed, 1);
    const exists = await ds.has('c');
    assert.equal(exists, false);
  });

  it('delete returns 0 for non-existent key', async () => {
    const removed = await ds.delete('nonexistent');
    assert.equal(removed, 0);
  });

  it('getMany returns records for multiple keys sorted', async () => {
    const results = await ds.getMany(['e', 'a', 'b']);
    assert.equal(results.length, 3);
    assert.equal(results[0].key, 'a');
    assert.equal(results[1].key, 'b');
    assert.equal(results[2].key, 'e');
  });

  it('getMany deduplicates keys', async () => {
    const results = await ds.getMany(['a', 'a', 'a']);
    assert.equal(results.length, 1);
  });

  it('getMany returns empty for non-existent keys', async () => {
    const results = await ds.getMany(['x', 'y', 'z']);
    assert.equal(results.length, 0);
  });
});
