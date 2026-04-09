import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  Datastore,
  ValidationError,
  DuplicateKeyError,
} from '../../dist/index.js';

describe('Duplicate key policy: allow (default)', () => {
  let ds;

  before(() => {
    ds = new Datastore({});
  });

  after(async () => {
    await ds.close();
  });

  it('allows multiple records with the same key', async () => {
    await ds.put({ key: 'dup', payload: { v: 1 } });
    await ds.put({ key: 'dup', payload: { v: 2 } });
    await ds.put({ key: 'dup', payload: { v: 3 } });

    const results = await ds.get('dup');
    assert.equal(results.length, 3);
    const count = await ds.count();
    assert.equal(count, 3);
  });

  it('getFirst returns the earliest inserted record', async () => {
    const record = await ds.getFirst('dup');
    assert.notEqual(record, null);
    assert.equal(record.payload.v, 1);
  });

  it('getLast returns the latest inserted record', async () => {
    const record = await ds.getLast('dup');
    assert.notEqual(record, null);
    assert.equal(record.payload.v, 3);
  });

  it('getLast includes read-only _id field', async () => {
    const record = await ds.getLast('dup');
    assert.notEqual(record, null);
    assert.ok('_id' in record);
  });

  it('keys() deduplicates despite multiple records', async () => {
    const allKeys = await ds.keys();
    assert.equal(allKeys.length, 1);
    assert.equal(allKeys[0], 'dup');
  });
});

describe('Duplicate key policy: replace', () => {
  let ds;

  before(() => {
    ds = new Datastore({ duplicateKeys: 'replace' });
  });

  after(async () => {
    await ds.close();
  });

  it('replaces existing record with same key', async () => {
    await ds.put({ key: 'item', payload: { v: 1 } });
    await ds.put({ key: 'item', payload: { v: 2 } });

    const results = await ds.get('item');
    assert.equal(results.length, 1);
    assert.equal(results[0].payload.v, 2);

    const count = await ds.count();
    assert.equal(count, 1);
  });

  it('getLast returns same as getFirst when at most one record per key', async () => {
    const first = await ds.getFirst('item');
    const last = await ds.getLast('item');
    assert.deepStrictEqual(first, last);
  });
});

describe('Duplicate key policy: reject', () => {
  let ds;

  before(() => {
    ds = new Datastore({ duplicateKeys: 'reject' });
  });

  after(async () => {
    await ds.close();
  });

  it('rejects duplicate key with DuplicateKeyError (also instanceof ValidationError)', async () => {
    await ds.put({ key: 'unique', payload: { v: 1 } });

    await assert.rejects(
      () => ds.put({ key: 'unique', payload: { v: 2 } }),
      (err) => {
        assert.ok(err instanceof DuplicateKeyError);
        assert.ok(err instanceof ValidationError);
        assert.ok(err instanceof Error);
        assert.equal(
          err.message,
          'Duplicate key rejected: a record with this key already exists.',
        );
        assert.equal(err.name, 'DuplicateKeyError');
        return true;
      },
    );

    const results = await ds.get('unique');
    assert.equal(results.length, 1);
    assert.equal(results[0].payload.v, 1);
  });

  it('allows different keys', async () => {
    await ds.put({ key: 'other', payload: { v: 3 } });
    const count = await ds.count();
    assert.equal(count, 2);
  });

  it('getLast returns same as getFirst when at most one record per key', async () => {
    const first = await ds.getFirst('unique');
    const last = await ds.getLast('unique');
    assert.deepStrictEqual(first, last);
  });
});

describe('Duplicate key policy: reject (putMany)', () => {
  let ds;

  before(async () => {
    ds = new Datastore({ duplicateKeys: 'reject' });
    await ds.put({ key: 'k1', payload: { v: 1 } });
  });

  after(async () => {
    await ds.close();
  });

  it('rejects putMany containing a duplicate key with DuplicateKeyError (also instanceof ValidationError)', async () => {
    await assert.rejects(
      () =>
        ds.putMany([
          { key: 'k2', payload: { v: 2 } },
          { key: 'k1', payload: { v: 3 } },
        ]),
      (err) => {
        assert.ok(err instanceof DuplicateKeyError);
        assert.ok(err instanceof ValidationError);
        assert.equal(
          err.message,
          'Duplicate key rejected: a record with this key already exists.',
        );
        assert.equal(err.name, 'DuplicateKeyError');
        return true;
      },
    );
  });
});
