import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

test('D3: scheduled autoCommit timer is unreferenced in Node.js', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let unrefCallCount = 0;
  let timerSet = false;

  // Patch setInterval to capture the returned timer handle
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, delay) => {
    timerSet = true;
    const handle = originalSetInterval(fn, delay);
    // Track whether unref is called on the actual handle
    const originalUnref = handle.unref?.bind(handle);
    if (typeof originalUnref === 'function') {
      handle.unref = () => {
        unrefCallCount += 1;
        return originalUnref();
      };
    }
    return handle;
  };

  // Concrete subclass for testing
  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency: 'scheduled', intervalMs: 60000, maxPendingBytes: null },
        () => {},
      );
    }

    getSnapshot() {
      return { treeJSON: { version: 1, config: {}, entries: [] } };
    }

    async executeSingleCommit() {
      // no-op
    }
  }

  let controller;
  try {
    controller = new TestController();

    assert.ok(
      timerSet,
      'setInterval must have been called for scheduled frequency',
    );
    assert.equal(
      unrefCallCount,
      1,
      'unref() must be called once on the timer handle',
    );
  } finally {
    globalThis.setInterval = originalSetInterval;
    if (controller) {
      await controller.close?.();
    }
  }
});

test('D3: immediate autoCommit does not set an interval timer', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let timerSet = false;
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, delay) => {
    timerSet = true;
    return originalSetInterval(fn, delay);
  };

  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency: 'immediate', intervalMs: null, maxPendingBytes: null },
        () => {},
      );
    }

    async executeSingleCommit() {
      // no-op
    }
  }

  let controller;
  try {
    controller = new TestController();
    assert.ok(
      !timerSet,
      'setInterval must NOT be called for immediate frequency',
    );
  } finally {
    globalThis.setInterval = originalSetInterval;
    if (controller) {
      await controller.close?.();
    }
  }
});
