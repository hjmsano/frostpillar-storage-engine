import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore, InvalidQueryRangeError } from '../../dist/index.js';

describe('Datastore.countRange', () => {
  it('countRange returns count of records in range', async () => {
    const ds = new Datastore({});
    try {
      await ds.put({ key: 'a', payload: { v: 1 } });
      await ds.put({ key: 'b', payload: { v: 2 } });
      await ds.put({ key: 'c', payload: { v: 3 } });
      await ds.put({ key: 'd', payload: { v: 4 } });
      const result = await ds.countRange('b', 'c');
      assert.equal(result, 2);
    } finally {
      await ds.close();
    }
  });

  it('countRange with single key returns count for that key', async () => {
    const ds = new Datastore({});
    try {
      await ds.put({ key: 'a', payload: { v: 1 } });
      await ds.put({ key: 'b', payload: { v: 2 } });
      await ds.put({ key: 'c', payload: { v: 3 } });
      const result = await ds.countRange('b', 'b');
      assert.equal(result, 1);
    } finally {
      await ds.close();
    }
  });

  it('countRange returns 0 when no records match', async () => {
    const ds = new Datastore({});
    try {
      await ds.put({ key: 'a', payload: { v: 1 } });
      await ds.put({ key: 'b', payload: { v: 2 } });
      const result = await ds.countRange('x', 'z');
      assert.equal(result, 0);
    } finally {
      await ds.close();
    }
  });

  it('countRange throws InvalidQueryRangeError when start > end', async () => {
    const ds = new Datastore({});
    try {
      await ds.put({ key: 'a', payload: { v: 1 } });
      await assert.rejects(
        () => ds.countRange('d', 'a'),
        (err) => err instanceof InvalidQueryRangeError,
      );
    } finally {
      await ds.close();
    }
  });

  it('countRange works with duplicate keys', async () => {
    const ds = new Datastore({ duplicateKeys: 'allow' });
    try {
      await ds.put({ key: 'b', payload: { v: 1 } });
      await ds.put({ key: 'b', payload: { v: 2 } });
      await ds.put({ key: 'b', payload: { v: 3 } });
      await ds.put({ key: 'c', payload: { v: 4 } });
      const result = await ds.countRange('b', 'b');
      assert.equal(result, 3);
    } finally {
      await ds.close();
    }
  });

  it('countRange returns 0 on empty datastore', async () => {
    const ds = new Datastore({});
    try {
      const result = await ds.countRange('a', 'z');
      assert.equal(result, 0);
    } finally {
      await ds.close();
    }
  });
});
