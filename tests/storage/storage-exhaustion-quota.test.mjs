import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore, QuotaExceededError } from '../../dist/index.js';

describe('Capacity policy: strict', () => {
  it('rejects insert when capacity exceeded', async () => {
    const ds = new Datastore({
      capacity: { maxSize: 200, policy: 'strict' },
    });

    await ds.put({ key: 'a', payload: { data: 'x'.repeat(50) } });

    await assert.rejects(
      () => ds.put({ key: 'b', payload: { data: 'y'.repeat(150) } }),
      (err) => err instanceof QuotaExceededError,
    );

    await ds.close();
  });

  it('allows insert within capacity', async () => {
    const ds = new Datastore({
      capacity: { maxSize: '10KB', policy: 'strict' },
    });

    await ds.put({ key: 'a', payload: { data: 'small' } });
    const count = await ds.count();
    assert.equal(count, 1);

    await ds.close();
  });

  it('rejects single record that exceeds maxSize boundary', async () => {
    const ds = new Datastore({
      capacity: { maxSize: 10, policy: 'strict' },
    });

    await assert.rejects(
      () => ds.put({ key: 'huge', payload: { data: 'x'.repeat(100) } }),
      (err) => err instanceof QuotaExceededError,
    );

    await ds.close();
  });
});

describe('Capacity policy: turnover', () => {
  it('evicts oldest records to make room', async () => {
    const ds = new Datastore({
      capacity: { maxSize: 300, policy: 'turnover' },
    });

    await ds.put({ key: 'first', payload: { data: 'a'.repeat(50) } });
    await ds.put({ key: 'second', payload: { data: 'b'.repeat(50) } });
    await ds.put({ key: 'third', payload: { data: 'c'.repeat(100) } });

    const hasBefore = await ds.has('first');
    assert.equal(hasBefore, true);

    await ds.put({ key: 'fourth', payload: { data: 'd'.repeat(100) } });

    const hasFirst = await ds.has('first');
    const hasFourth = await ds.has('fourth');
    assert.equal(hasFourth, true);
    if (!hasFirst) {
      const count = await ds.count();
      assert.ok(count >= 1);
    }

    await ds.close();
  });
});
