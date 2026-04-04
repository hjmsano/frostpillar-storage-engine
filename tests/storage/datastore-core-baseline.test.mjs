import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore } from '../../dist/index.js';

describe('Datastore core baseline', () => {
  let ds;

  before(() => {
    ds = new Datastore({});
  });

  after(async () => {
    await ds.close();
  });

  it('put and get a single record', async () => {
    await ds.put({ key: 'hello', payload: { value: 'world' } });
    const results = await ds.get('hello');
    assert.equal(results.length, 1);
    assert.equal(results[0].key, 'hello');
    assert.deepStrictEqual(results[0].payload, { value: 'world' });
  });

  it('getFirst returns the first matching record', async () => {
    const record = await ds.getFirst('hello');
    assert.notEqual(record, null);
    assert.equal(record.key, 'hello');
    assert.deepStrictEqual(record.payload, { value: 'world' });
  });

  it('getFirst returns null for non-existent key', async () => {
    const record = await ds.getFirst('nonexistent');
    assert.equal(record, null);
  });

  it('getLast returns the last matching record', async () => {
    const record = await ds.getLast('hello');
    assert.notEqual(record, null);
    assert.equal(record.key, 'hello');
    assert.deepStrictEqual(record.payload, { value: 'world' });
  });

  it('getLast returns null for non-existent key', async () => {
    const record = await ds.getLast('nonexistent');
    assert.equal(record, null);
  });

  it('has returns true for existing key', async () => {
    const exists = await ds.has('hello');
    assert.equal(exists, true);
  });

  it('has returns false for non-existent key', async () => {
    const exists = await ds.has('nonexistent');
    assert.equal(exists, false);
  });

  it('count reflects the number of records', async () => {
    const count = await ds.count();
    assert.equal(count, 1);
  });

  it('keys returns distinct keys', async () => {
    await ds.put({ key: 'alpha', payload: { v: 1 } });
    await ds.put({ key: 'beta', payload: { v: 2 } });
    const allKeys = await ds.keys();
    assert.ok(allKeys.includes('alpha'));
    assert.ok(allKeys.includes('beta'));
    assert.ok(allKeys.includes('hello'));
  });

  it('getAll returns all records', async () => {
    const all = await ds.getAll();
    assert.ok(all.length >= 3);
    const keys = all.map((r) => r.key);
    assert.ok(keys.includes('alpha'));
    assert.ok(keys.includes('beta'));
    assert.ok(keys.includes('hello'));
  });

  it('clear removes all records', async () => {
    await ds.clear();
    const count = await ds.count();
    assert.equal(count, 0);
    const all = await ds.getAll();
    assert.equal(all.length, 0);
  });

  it('get returns empty array for non-existent key', async () => {
    const results = await ds.get('nonexistent');
    assert.deepStrictEqual(results, []);
  });
});

describe('Datastore with numeric keys', () => {
  let ds;

  before(() => {
    ds = new Datastore({
      key: {
        normalize: (v) => Number(v),
        compare: (a, b) => a - b,
        serialize: (k) => String(k),
        deserialize: (s) => Number(s),
      },
    });
  });

  after(async () => {
    await ds.close();
  });

  it('supports numeric keys with custom key definition', async () => {
    await ds.put({ key: 10, payload: { name: 'ten' } });
    await ds.put({ key: 5, payload: { name: 'five' } });
    await ds.put({ key: 20, payload: { name: 'twenty' } });

    const results = await ds.get(10);
    assert.equal(results.length, 1);
    assert.equal(results[0].payload.name, 'ten');

    const all = await ds.getAll();
    assert.equal(all.length, 3);
    assert.equal(all[0].key, 5);
    assert.equal(all[1].key, 10);
    assert.equal(all[2].key, 20);
  });
});

describe('Datastore payload immutability', () => {
  let ds;

  before(() => {
    ds = new Datastore({});
  });

  after(async () => {
    await ds.close();
  });

  it('input payload is cloned on insert to prevent external corruption', async () => {
    const input = { a: 1 };
    await ds.put({ key: 'cloned', payload: input });
    // Mutate original input after insert
    input.a = 999;
    // P3-C: payload was defensively cloned on insert, so internal state is safe.
    const results = await ds.get('cloned');
    assert.equal(results[0].payload.a, 1);
  });
});
