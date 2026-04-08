import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule, importDistModule } from '../load-module.mjs';

test('getRange rejects NaN comparator output with IndexCorruptionError', async () => {
  const { Datastore, IndexCorruptionError } = await loadStorageModule();

  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        if (left === right) return 0;
        return Number.NaN;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  // Only one record with key 'a' — insert does not compare distinct keys
  await ds.put({ key: 'a', payload: { v: 1 } });

  // getRange('a', 'b') calls compare('a', 'b') which returns NaN
  await assert.rejects(ds.getRange('a', 'b'), IndexCorruptionError);

  await ds.close();
});

test('getRange rejects Infinity comparator output with IndexCorruptionError', async () => {
  const { Datastore, IndexCorruptionError } = await loadStorageModule();

  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        if (left === right) return 0;
        return Number.POSITIVE_INFINITY;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });

  await assert.rejects(ds.getRange('a', 'b'), IndexCorruptionError);

  await ds.close();
});

test('getRange rejects non-integer comparator output with IndexCorruptionError', async () => {
  const { Datastore, IndexCorruptionError } = await loadStorageModule();

  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        if (left === right) return 0;
        return 0.5;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });

  await assert.rejects(ds.getRange('a', 'b'), IndexCorruptionError);

  await ds.close();
});

// NaN comparator results are consistently rejected with IndexCorruptionError
// across all APIs including hot-path loop APIs (keys, getMany).
// clampComparatorResult checks NaN (x !== x) with negligible overhead.

test('keys() rejects NaN comparator output with IndexCorruptionError', async () => {
  const { Datastore, IndexCorruptionError } = await loadStorageModule();

  let poisoned = false;
  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        if (left === right) return 0;
        if (poisoned) return Number.NaN;
        return left < right ? -1 : 1;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'z', payload: { v: 2 } });

  poisoned = true;

  await assert.rejects(ds.keys(), IndexCorruptionError);

  await ds.close();
});

test('getMany rejects NaN comparator output via BTree range query', async () => {
  const { Datastore, IndexCorruptionError } = await loadStorageModule();

  let poisoned = false;
  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        if (left === right) return 0;
        if (poisoned) return Number.NaN;
        return left < right ? -1 : 1;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'b', payload: { v: 2 } });

  poisoned = true;

  // NaN is detected by the BTree wrapped comparator during rangeQuery
  await assert.rejects(ds.getMany(['b', 'a']), IndexCorruptionError);

  await ds.close();
});

test('BTree wrapped comparator rejects NaN during put to prevent index corruption', async () => {
  const { Datastore, IndexCorruptionError } = await loadStorageModule();

  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        // Return NaN when comparing with 'b' — simulates a buggy comparator
        if (left === 'b' || right === 'b') return Number.NaN;
        return left < right ? -1 : left > right ? 1 : 0;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  // Inserting 'b' triggers BTree comparisons that return NaN
  await assert.rejects(
    ds.put({ key: 'b', payload: { v: 2 } }),
    IndexCorruptionError,
  );

  await ds.close();
});

test('keys() does not throw on Infinity comparator output (clamped, non-NaN)', async () => {
  const { Datastore } = await loadStorageModule();

  let poisoned = false;
  const ds = new Datastore({
    key: {
      normalize: (v) => v,
      compare: (left, right) => {
        if (left === right) return 0;
        if (poisoned) return Number.POSITIVE_INFINITY;
        return left < right ? -1 : 1;
      },
      serialize: (v) => String(v),
      deserialize: (v) => v,
    },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'z', payload: { v: 2 } });

  poisoned = true;

  // Infinity is clamped to 1 (not-equal), so all keys are treated as distinct
  const result = await ds.keys();
  assert.equal(result.length, 2);

  await ds.close();
});

test('clampComparatorResult rejects NaN with IndexCorruptionError', async () => {
  const { clampComparatorResult } = await importDistModule(
    'storage/btree/recordKeyIndexBTree.js',
  );
  const { IndexCorruptionError } = await importDistModule('errors/index.js');

  assert.equal(clampComparatorResult(0), 0);
  assert.equal(clampComparatorResult(-42), -1);
  assert.equal(clampComparatorResult(99), 1);
  // Infinity is clamped, not thrown
  assert.equal(clampComparatorResult(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampComparatorResult(Number.NEGATIVE_INFINITY), -1);
  // NaN throws
  assert.throws(() => clampComparatorResult(Number.NaN), IndexCorruptionError);
});

test('normalizeComparatorResult is exported from recordKeyIndexBTree module', async () => {
  const { normalizeComparatorResult } = await importDistModule(
    'storage/btree/recordKeyIndexBTree.js',
  );

  assert.equal(typeof normalizeComparatorResult, 'function');
  assert.equal(normalizeComparatorResult(0), 0);
  assert.equal(normalizeComparatorResult(-42), -1);
  assert.equal(normalizeComparatorResult(99), 1);
  assert.throws(() => normalizeComparatorResult(Number.NaN));
  assert.throws(() => normalizeComparatorResult(0.5));
  assert.throws(() => normalizeComparatorResult(Number.POSITIVE_INFINITY));
  assert.throws(() => normalizeComparatorResult(Number.NEGATIVE_INFINITY));
});
