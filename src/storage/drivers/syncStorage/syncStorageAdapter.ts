import { toErrorInstance } from '../../../errors/index.js';
import { isRecordObject } from '../../../validation/typeGuards.js';
import type {
  BrowserSyncStorageAreaPromiseAdapter,
  ChromeRuntimeAdapter,
  ChromeSyncStorageAreaCallbackAdapter,
  SyncStorageAdapter,
} from '../../backend/types.js';

interface BrowserSyncNamespace {
  browser?: {
    storage?: {
      sync?: BrowserSyncStorageAreaPromiseAdapter | null;
    } | null;
  } | null;
  chrome?: {
    runtime?: ChromeRuntimeAdapter | null;
    storage?: {
      sync?: ChromeSyncStorageAreaCallbackAdapter | null;
    } | null;
  } | null;
}

interface SyncAreaShape {
  get: unknown;
  set: unknown;
  remove: unknown;
}

const readChromeRuntimeError = (
  runtime: ChromeRuntimeAdapter | null,
): Error | null => {
  const runtimeMessage = runtime?.lastError?.message;
  if (runtimeMessage === undefined) {
    return null;
  }
  if (runtimeMessage.trim().length === 0) {
    return new Error('chrome.runtime.lastError is set with an empty message.');
  }
  return new Error(runtimeMessage);
};

const callChromeCallbackGet = (
  syncArea: ChromeSyncStorageAreaCallbackAdapter,
  runtime: ChromeRuntimeAdapter | null,
  keys: string[],
): Promise<Record<string, unknown>> => {
  return new Promise((resolve, reject) => {
    try {
      syncArea.get(keys, (items): void => {
        const runtimeError = readChromeRuntimeError(runtime);
        if (runtimeError !== null) {
          reject(runtimeError);
          return;
        }
        resolve(items);
      });
    } catch (error: unknown) {
      reject(
        toErrorInstance(
          error,
          'chrome.storage.sync.get failed with a non-Error value.',
        ),
      );
    }
  });
};

const callChromeCallbackSet = (
  syncArea: ChromeSyncStorageAreaCallbackAdapter,
  runtime: ChromeRuntimeAdapter | null,
  items: Record<string, unknown>,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      syncArea.set(items, (): void => {
        const runtimeError = readChromeRuntimeError(runtime);
        if (runtimeError !== null) {
          reject(runtimeError);
          return;
        }
        resolve();
      });
    } catch (error: unknown) {
      reject(
        toErrorInstance(
          error,
          'chrome.storage.sync.set failed with a non-Error value.',
        ),
      );
    }
  });
};

const callChromeCallbackRemove = (
  syncArea: ChromeSyncStorageAreaCallbackAdapter,
  runtime: ChromeRuntimeAdapter | null,
  keys: string[],
): Promise<void> => {
  return new Promise((resolve, reject) => {
    try {
      syncArea.remove(keys, (): void => {
        const runtimeError = readChromeRuntimeError(runtime);
        if (runtimeError !== null) {
          reject(runtimeError);
          return;
        }
        resolve();
      });
    } catch (error: unknown) {
      reject(
        toErrorInstance(
          error,
          'chrome.storage.sync.remove failed with a non-Error value.',
        ),
      );
    }
  });
};

const createBrowserPromiseSyncStorageAdapter = (
  syncArea: BrowserSyncStorageAreaPromiseAdapter,
): SyncStorageAdapter => {
  return {
    getItems: async (keys: string[]): Promise<Record<string, unknown>> => {
      return await syncArea.get(keys);
    },
    setItems: async (items: Record<string, unknown>): Promise<void> => {
      await syncArea.set(items);
    },
    removeItems: async (keys: string[]): Promise<void> => {
      await syncArea.remove(keys);
    },
  };
};

const createChromeCallbackSyncStorageAdapter = (
  syncArea: ChromeSyncStorageAreaCallbackAdapter,
  runtime: ChromeRuntimeAdapter | null,
): SyncStorageAdapter => {
  return {
    getItems: async (keys: string[]): Promise<Record<string, unknown>> => {
      return await callChromeCallbackGet(syncArea, runtime, keys);
    },
    setItems: async (items: Record<string, unknown>): Promise<void> => {
      await callChromeCallbackSet(syncArea, runtime, items);
    },
    removeItems: async (keys: string[]): Promise<void> => {
      await callChromeCallbackRemove(syncArea, runtime, keys);
    },
  };
};

const hasSyncAreaFunctionShape = (value: unknown): value is SyncAreaShape => {
  if (!isRecordObject(value)) {
    return false;
  }
  return (
    typeof value.get === 'function' &&
    typeof value.set === 'function' &&
    typeof value.remove === 'function'
  );
};

const hasBrowserPromiseSyncArea = (
  value: unknown,
): value is BrowserSyncStorageAreaPromiseAdapter => {
  return hasSyncAreaFunctionShape(value);
};

const hasChromeCallbackSyncArea = (
  value: unknown,
): value is ChromeSyncStorageAreaCallbackAdapter => {
  return hasSyncAreaFunctionShape(value);
};

export const detectGlobalSyncStorage = (): SyncStorageAdapter | null => {
  try {
    const globals = globalThis as BrowserSyncNamespace;
    // Prefer the Promise API when both namespaces exist. The callback API is a
    // fallback for runtimes where only chrome.* is available.
    const browserSync = globals.browser?.storage?.sync;
    if (hasBrowserPromiseSyncArea(browserSync)) {
      return createBrowserPromiseSyncStorageAdapter(browserSync);
    }

    const chromeSync = globals.chrome?.storage?.sync;
    if (hasChromeCallbackSyncArea(chromeSync)) {
      const runtime = globals.chrome?.runtime ?? null;
      return createChromeCallbackSyncStorageAdapter(chromeSync, runtime);
    }

    return null;
  } catch {
    return null;
  }
};
