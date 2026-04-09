import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

test('capacity resolver maps backendLimit to syncStorage maxTotalBytes', async () => {
  await loadStorageModule();
  const { resolveCapacityState } = await importDistModule(
    'storage/backend/capacityResolver.js',
  );
  const { syncStorageDriver } = await importDistModule(
    'drivers/syncStorage.js',
  );

  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  globalThis.browser = {
    storage: {
      sync: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
  };
  delete globalThis.chrome;

  try {
    const state = resolveCapacityState({
      driver: syncStorageDriver({
        maxTotalBytes: 321,
      }),
      capacity: {
        maxSize: 'backendLimit',
        policy: 'strict',
      },
    });

    assert.deepEqual(state, {
      maxSizeBytes: 321,
      policy: 'strict',
    });
  } finally {
    if (previousBrowser === undefined) {
      delete globalThis.browser;
    } else {
      globalThis.browser = previousBrowser;
    }
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  }
});

test('capacity resolver for syncStorage backendLimit ignores non-capacity runtime option validation', async () => {
  await loadStorageModule();
  const { resolveCapacityState } = await importDistModule(
    'storage/backend/capacityResolver.js',
  );
  const { syncStorageDriver } = await importDistModule(
    'drivers/syncStorage.js',
  );

  const previousBrowser = globalThis.browser;
  const previousChrome = globalThis.chrome;
  globalThis.browser = {
    storage: {
      sync: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
  };
  delete globalThis.chrome;

  try {
    const state = resolveCapacityState({
      driver: syncStorageDriver({
        maxChunks: 900,
        maxItems: 1,
        maxTotalBytes: 654,
      }),
      capacity: {
        maxSize: 'backendLimit',
        policy: 'strict',
      },
    });

    assert.deepEqual(state, {
      maxSizeBytes: 654,
      policy: 'strict',
    });
  } finally {
    if (previousBrowser === undefined) {
      delete globalThis.browser;
    } else {
      globalThis.browser = previousBrowser;
    }
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  }
});
