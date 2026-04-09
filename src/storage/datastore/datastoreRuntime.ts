import { DatastoreLifecycle } from './datastoreLifecycle.js';
import { AsyncMutex } from '../backend/asyncMutex.js';

export const isPromiseLike = <T>(
  value: PromiseLike<T> | T,
): value is PromiseLike<T> => {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === 'function';
};

export const executeWithLifecycle = <T>(
  lifecycle: DatastoreLifecycle,
  operation: () => T | Promise<T>,
): T | Promise<T> => {
  lifecycle.beginOperation();
  try {
    const result = operation();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value: T): T => {
          lifecycle.endOperation();
          return value;
        },
        (error: unknown): never => {
          lifecycle.endOperation();
          throw error;
        },
      );
    }
    lifecycle.endOperation();
    return result;
  } catch (error: unknown) {
    lifecycle.endOperation();
    throw error;
  }
};

export interface PendingInitState {
  pendingInit: Promise<void> | null;
  pendingInitError: Error | null;
}

export const runWithOpen = <T>(
  lifecycle: DatastoreLifecycle,
  state: PendingInitState,
  operation: () => Promise<T> | T,
): Promise<T> => {
  if (state.pendingInit !== null) {
    return state.pendingInit.then((): T | Promise<T> => {
      if (state.pendingInitError !== null) {
        throw state.pendingInitError;
      }
      return executeWithLifecycle(lifecycle, operation);
    });
  }
  if (state.pendingInitError !== null) {
    return Promise.reject(state.pendingInitError);
  }
  try {
    return Promise.resolve(executeWithLifecycle(lifecycle, operation));
  } catch (error: unknown) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
};

export const runWithOpenExclusive = async <T>(
  lifecycle: DatastoreLifecycle,
  writeMutex: AsyncMutex,
  state: PendingInitState,
  operation: () => Promise<T> | T,
): Promise<T> => {
  const release = await writeMutex.acquire();
  try {
    return await runWithOpen(lifecycle, state, operation);
  } finally {
    release();
  }
};
