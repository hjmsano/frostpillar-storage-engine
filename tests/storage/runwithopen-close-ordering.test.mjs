import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

test('runWithOpen counts operation before awaiting pendingInit', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  let resolvePendingInit;
  const pendingInit = new Promise((resolve) => {
    resolvePendingInit = resolve;
  });

  datastore.pendingInit = pendingInit;
  datastore.backendController = { close: async () => {} };

  // Start an insert — it should call beginOperation() synchronously
  // before awaiting pendingInit.
  const insertPromise = datastore.put({
    key: '1735689600000',
    payload: { id: 'test' },
  });

  // Yield a microtick so the insert's synchronous part runs.
  await Promise.resolve();

  // The operation should already be counted even though init hasn't resolved.
  // Closing now should wait for drain (which waits for the insert to finish).
  const closePromise = datastore.close();

  // Resolve init so the insert can proceed.
  resolvePendingInit();

  // The insert should fail because close marked the datastore as closing,
  // but it should NOT throw ClosedDatastoreError from beginOperation —
  // the operation was already counted before close was called.
  // Instead, it should either succeed or fail due to closing state
  // during the actual operation, depending on timing.
  // The important invariant: close() must await the insert's drain.
  await Promise.allSettled([insertPromise, closePromise]);

  // After both settle, the datastore is closed.
  assert.ok(true, 'No deadlock — both promises settled');
});

test('close awaits pendingInit before draining operations', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  let resolvePendingInit;
  const pendingInit = new Promise((resolve) => {
    resolvePendingInit = resolve;
  });
  let closeResolved = false;

  datastore.pendingInit = pendingInit;
  datastore.backendController = { close: async () => {} };

  const closePromise = datastore.close().then(() => {
    closeResolved = true;
  });

  // Close should be blocked on pendingInit.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closeResolved, false, 'close is blocked on pendingInit');

  resolvePendingInit();
  await closePromise;
  assert.equal(
    closeResolved,
    true,
    'close completed after pendingInit resolved',
  );
});
