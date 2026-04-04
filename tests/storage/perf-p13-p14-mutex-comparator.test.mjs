import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

const loadAsyncMutex = async () => {
  return await importDistModule('storage/backend/asyncMutex.js');
};

const loadBTreeAdapter = async () => {
  return await importDistModule('storage/btree/recordKeyIndexBTree.js');
};

// ---------------------------------------------------------------------------
// P13: AsyncMutex — O(1) dequeue correctness
// ---------------------------------------------------------------------------

test('AsyncMutex: uncontended acquire returns immediately', async () => {
  const { AsyncMutex } = await loadAsyncMutex();
  const mutex = new AsyncMutex();
  const release = await mutex.acquire();
  assert.equal(typeof release, 'function');
  release();
});

test('AsyncMutex: multiple acquires are served in FIFO order', async () => {
  const { AsyncMutex } = await loadAsyncMutex();
  const mutex = new AsyncMutex();
  const order = [];

  const r1 = await mutex.acquire();
  const p2 = mutex.acquire().then((release) => {
    order.push(2);
    return release;
  });
  const p3 = mutex.acquire().then((release) => {
    order.push(3);
    return release;
  });

  r1();
  const r2 = await p2;
  r2();
  const r3 = await p3;
  r3();

  assert.deepEqual(order, [2, 3]);
});

test('AsyncMutex: double release is a no-op (idempotent)', async () => {
  const { AsyncMutex } = await loadAsyncMutex();
  const mutex = new AsyncMutex();
  const release = await mutex.acquire();
  release();
  release(); // second call should be a no-op
  // Verify mutex is still usable
  const release2 = await mutex.acquire();
  assert.equal(typeof release2, 'function');
  release2();
});

test('AsyncMutex: after all releases, mutex is unlocked', async () => {
  const { AsyncMutex } = await loadAsyncMutex();
  const mutex = new AsyncMutex();

  const r1 = await mutex.acquire();
  r1();
  // Should resolve immediately since mutex is unlocked
  const r2 = await mutex.acquire();
  assert.equal(typeof r2, 'function');
  r2();
});

test('AsyncMutex: high-contention — 100 sequential acquires in correct order', async () => {
  const { AsyncMutex } = await loadAsyncMutex();
  const mutex = new AsyncMutex();
  const order = [];

  const firstRelease = await mutex.acquire();

  const promises = [];
  for (let i = 0; i < 100; i++) {
    const idx = i;
    promises.push(
      mutex.acquire().then((release) => {
        order.push(idx);
        release();
      }),
    );
  }

  firstRelease();
  await Promise.all(promises);

  const expected = Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(order, expected);
});

// ---------------------------------------------------------------------------
// P14: clampComparatorResult — exported and correct
// ---------------------------------------------------------------------------

test('clampComparatorResult(0) returns 0', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(0), 0);
});

test('clampComparatorResult(42) returns 1', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(42), 1);
});

test('clampComparatorResult(-99) returns -1', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(-99), -1);
});

test('clampComparatorResult(0.5) returns 1 (non-integer positive)', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(0.5), 1);
});

test('clampComparatorResult(-0.5) returns -1 (non-integer negative)', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(-0.5), -1);
});

test('clampComparatorResult(NaN) returns 1 (NaN is not < 0 and not === 0)', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(NaN), 1);
});

test('clampComparatorResult(Infinity) returns 1', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(Infinity), 1);
});

test('clampComparatorResult(-Infinity) returns -1', async () => {
  const { clampComparatorResult } = await loadBTreeAdapter();
  assert.equal(clampComparatorResult(-Infinity), -1);
});
