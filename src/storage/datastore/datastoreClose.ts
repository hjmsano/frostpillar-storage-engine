import { toErrorInstance } from '../../errors/index.js';
import { DatastoreLifecycle } from './datastoreLifecycle.js';
import type { DurableBackendController } from '../backend/types.js';

type AggregateErrorConstructorLike = new (
  errors: Iterable<unknown>,
  message?: string,
) => Error;

interface ErrorWithErrors extends Error {
  errors?: Error[];
}

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

const readAggregateErrorConstructor = (): AggregateErrorConstructorLike | null => {
  const candidate = (globalThis as { AggregateError?: unknown }).AggregateError;
  if (typeof candidate !== 'function') {
    return null;
  }
  return candidate as AggregateErrorConstructorLike;
};

const createCloseAggregateError = (
  deferredError: Error,
  closeError: Error,
): Error => {
  const aggregateErrorConstructor = readAggregateErrorConstructor();
  if (aggregateErrorConstructor !== null) {
    return new aggregateErrorConstructor(
      [deferredError, closeError],
      'Datastore close failed with multiple errors.',
    );
  }
  const fallbackError: ErrorWithErrors = new Error(
    'Datastore close failed with multiple errors.',
  );
  fallbackError.errors = [deferredError, closeError];
  return fallbackError;
};

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
      deferredError = createCloseAggregateError(deferredError, closeError);
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
