import { createAggregateError, toErrorInstance } from '../../errors/index.js';
import { DatastoreLifecycle } from './datastoreLifecycle.js';
import type { DurableBackendController } from '../backend/types.js';

export interface DatastoreCloseOptions {
  lifecycle: DatastoreLifecycle;
  getPendingInit: () => Promise<void> | null;
  getPendingInitError: () => Error | null;
  setPendingInitError: (pendingInitError: Error | null) => void;
  getBackendController: () => DurableBackendController | null;
  setBackendController: (
    backendController: DurableBackendController | null,
  ) => void;
  clearInMemoryState: () => void;
}

export interface DatastoreCloseableState {
  lifecycle: DatastoreLifecycle;
  pendingInit: Promise<void> | null;
  pendingInitError: Error | null;
  backendController: DurableBackendController | null;
  keyIndex: { clear: () => void };
  errorListeners: { clear: () => void };
}

export const buildCloseOptions = (
  state: DatastoreCloseableState,
): DatastoreCloseOptions => ({
  lifecycle: state.lifecycle,
  getPendingInit: () => state.pendingInit,
  getPendingInitError: () => state.pendingInitError,
  setPendingInitError: (e) => {
    state.pendingInitError = e;
  },
  getBackendController: () => state.backendController,
  setBackendController: (c) => {
    state.backendController = c;
  },
  clearInMemoryState: () => {
    state.keyIndex.clear();
    state.errorListeners.clear();
  },
});

export const closeDatastore = async (
  options: DatastoreCloseOptions,
): Promise<void> => {
  if (options.lifecycle.isClosed()) {
    return;
  }
  const closeInFlight = options.lifecycle.getCloseInFlight();
  if (closeInFlight !== null) {
    await closeInFlight;
    return;
  }

  options.lifecycle.markClosing();
  const closeOperation = performClose(options).finally((): void => {
    options.lifecycle.setCloseInFlight(null);
  });
  options.lifecycle.setCloseInFlight(closeOperation);
  await closeOperation;
};

const performClose = async (options: DatastoreCloseOptions): Promise<void> => {
  const pendingInit = options.getPendingInit();
  if (pendingInit !== null) {
    await pendingInit;
  }

  await options.lifecycle.waitForActiveOperationsToDrain();

  let deferredError: Error | null = options.getPendingInitError();

  try {
    await options.getBackendController()?.close();
  } catch (error: unknown) {
    const closeError = toErrorInstance(
      error,
      'Datastore close failed with a non-Error value.',
    );
    if (deferredError === null) {
      deferredError = closeError;
    } else {
      deferredError = createAggregateError(
        [deferredError, closeError],
        'Datastore close failed with multiple errors.',
      );
    }
  }

  options.setBackendController(null);
  options.setPendingInitError(null);
  options.lifecycle.markClosed();
  options.clearInMemoryState();

  if (deferredError !== null) {
    throw deferredError;
  }
};
