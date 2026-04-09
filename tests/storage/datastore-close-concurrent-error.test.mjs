import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

test('D2: concurrent close() callers both receive the error when close throws', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  const closeError = new Error('close failed intentionally');
  let releaseClose;
  const closeGate = new Promise((resolve) => {
    releaseClose = resolve;
  });

  datastore.backendController = {
    close: async () => {
      await closeGate;
      throw closeError;
    },
  };

  // Start first close – it becomes the in-flight close
  const firstClose = datastore.close();
  // Yield to allow the first close to register as in-flight
  await Promise.resolve();

  // Start second close – it joins the in-flight close
  const secondClose = datastore.close();

  // Release the gate so both resolve
  releaseClose();

  const [firstResult, secondResult] = await Promise.allSettled([
    firstClose,
    secondClose,
  ]);

  assert.equal(firstResult.status, 'rejected', 'first close must reject');
  assert.equal(secondResult.status, 'rejected', 'second close must reject');

  assert.equal(
    firstResult.reason,
    closeError,
    'first caller must receive the original error',
  );
  assert.equal(
    secondResult.reason,
    closeError,
    'second caller must receive the same error',
  );
});

test('D2: concurrent close() callers with successful close both resolve', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  let releaseClose;
  const closeGate = new Promise((resolve) => {
    releaseClose = resolve;
  });

  datastore.backendController = {
    close: async () => {
      await closeGate;
    },
  };

  const firstClose = datastore.close();
  await Promise.resolve();
  const secondClose = datastore.close();

  releaseClose();

  await assert.doesNotReject(
    Promise.all([firstClose, secondClose]),
    'both callers must resolve when close succeeds',
  );
});
