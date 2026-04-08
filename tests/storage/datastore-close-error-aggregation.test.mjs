import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

test('close aggregates deferred init and backend close failures', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  const initFailure = new Error('init failed');
  const closeFailure = new Error('close failed');
  let closeCallCount = 0;

  datastore.pendingInitError = initFailure;
  datastore.backendController = {
    close: async () => {
      closeCallCount += 1;
      throw closeFailure;
    },
  };

  await assert.rejects(datastore.close(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0], initFailure);
    assert.equal(error.errors[1], closeFailure);
    return true;
  });
  assert.equal(closeCallCount, 1);

  await assert.doesNotReject(async () => {
    await datastore.close();
  });
});

test('close is single-flight under concurrent calls', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  let closeCallCount = 0;
  let releaseClose;
  const closeGate = new Promise((resolve) => {
    releaseClose = resolve;
  });

  datastore.backendController = {
    close: async () => {
      closeCallCount += 1;
      await closeGate;
    },
  };

  const firstClose = datastore.close();
  await Promise.resolve();
  const secondClose = datastore.close();
  assert.equal(closeCallCount, 1);

  releaseClose();
  await assert.doesNotReject(async () => {
    await Promise.all([firstClose, secondClose]);
  });
});

test('put started after close begins fails with ClosedDatastoreError', async () => {
  const { ClosedDatastoreError, Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  let resolvePendingInit;
  const pendingInit = new Promise((resolve) => {
    resolvePendingInit = resolve;
  });

  datastore.pendingInit = pendingInit;
  datastore.backendController = {
    close: async () => {},
  };

  const closePromise = datastore.close();
  const putPromise = datastore.put({
    key: '1735689600000',
    payload: { id: 'during-close' },
  });

  resolvePendingInit();
  await assert.rejects(putPromise, ClosedDatastoreError);
  await assert.doesNotReject(closePromise);
});
