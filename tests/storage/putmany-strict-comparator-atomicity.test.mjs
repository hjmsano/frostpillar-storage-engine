import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  Datastore,
  DuplicateKeyError,
  ValidationError,
} from '../../dist/index.js';

/**
 * Bug 2: putMany strict path can violate atomicity with custom comparator + duplicateKeys: 'reject'.
 *
 * prepareBatchRecord uses keyStr ('s'+key / JSON.stringify) for intra-batch
 * duplicate detection instead of the comparator. So comparator-equal keys
 * (e.g. 'A' and 'a' under case-insensitive compare) pass the prepare phase,
 * then fail during insert after partial mutation — breaking atomic batch semantics.
 */

const caseInsensitiveKeyDef = {
  normalize: (value, fieldName) => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${fieldName} must be a non-empty string.`);
    }
    return value; // Preserve original case; comparator handles equality
  },
  compare: (left, right) => {
    const l = left.toLowerCase();
    const r = right.toLowerCase();
    if (l < r) return -1;
    if (l > r) return 1;
    return 0;
  },
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
};

describe('putMany strict + custom comparator atomicity', () => {
  it('rejects intra-batch comparator-equal keys without partial mutation', async () => {
    const ds = new Datastore({
      key: caseInsensitiveKeyDef,
      duplicateKeys: 'reject',
      capacity: { maxSize: '1MB', policy: 'strict' },
    });

    // 'A' and 'a' are comparator-equal under case-insensitive compare.
    // putMany must reject atomically — no partial insertion.
    await assert.rejects(
      () =>
        ds.putMany([
          { key: 'A', payload: { v: 1 } },
          { key: 'a', payload: { v: 2 } },
        ]),
      (err) =>
        err instanceof DuplicateKeyError && err instanceof ValidationError,
    );

    // Atomicity: count must be 0, not 1
    const count = await ds.count();
    assert.equal(
      count,
      0,
      'expected 0 records after atomic rejection, got partial write',
    );

    await ds.close();
  });

  it('rejects intra-batch comparator-equal keys even when not string-identical', async () => {
    const ds = new Datastore({
      key: caseInsensitiveKeyDef,
      duplicateKeys: 'reject',
      capacity: { maxSize: '1MB', policy: 'strict' },
    });

    await assert.rejects(
      () =>
        ds.putMany([
          { key: 'Hello', payload: { v: 1 } },
          { key: 'HELLO', payload: { v: 2 } },
        ]),
      (err) =>
        err instanceof DuplicateKeyError && err instanceof ValidationError,
    );

    const count = await ds.count();
    assert.equal(count, 0);

    await ds.close();
  });

  it('allows intra-batch keys that are string-different but comparator-different', async () => {
    const ds = new Datastore({
      key: caseInsensitiveKeyDef,
      duplicateKeys: 'reject',
      capacity: { maxSize: '1MB', policy: 'strict' },
    });

    // 'A' and 'B' are comparator-different — should succeed
    await ds.putMany([
      { key: 'A', payload: { v: 1 } },
      { key: 'B', payload: { v: 2 } },
    ]);

    const count = await ds.count();
    assert.equal(count, 2);

    await ds.close();
  });

  it('rejects batch when key exists in tree and is comparator-equal', async () => {
    const ds = new Datastore({
      key: caseInsensitiveKeyDef,
      duplicateKeys: 'reject',
      capacity: { maxSize: '1MB', policy: 'strict' },
    });

    await ds.put({ key: 'Existing', payload: { v: 0 } });

    await assert.rejects(
      () => ds.putMany([{ key: 'EXISTING', payload: { v: 1 } }]),
      (err) =>
        err instanceof DuplicateKeyError && err instanceof ValidationError,
    );

    // Only the original record remains
    const count = await ds.count();
    assert.equal(count, 1);

    await ds.close();
  });

  it('replace policy handles comparator-equal intra-batch keys correctly', async () => {
    const ds = new Datastore({
      key: caseInsensitiveKeyDef,
      duplicateKeys: 'replace',
      capacity: { maxSize: '1MB', policy: 'strict' },
    });

    await ds.putMany([
      { key: 'A', payload: { v: 1 } },
      { key: 'a', payload: { v: 2 } },
    ]);

    // Under replace policy, 'a' should replace 'A' — only 1 record
    const count = await ds.count();
    assert.equal(count, 1);

    const result = await ds.getFirst('a');
    assert.notEqual(result, null);
    assert.equal(result.payload.v, 2);

    await ds.close();
  });
});
