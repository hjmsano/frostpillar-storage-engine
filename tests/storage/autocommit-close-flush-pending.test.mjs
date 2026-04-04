import test from 'node:test';
import assert from 'node:assert/strict';
import { importDistModule } from '../load-module.mjs';

/**
 * Bug 1: close() can drop unflushed writes when autoCommit.frequency is scheduled.
 *
 * close() stops the timer and waits for commitInFlight, but never forces a
 * final commit for pending bytes that haven't reached the threshold or timer tick.
 */

const createTestController = async (options = {}) => {
  const {
    frequency = 'scheduled',
    intervalMs = null,
    maxPendingBytes = null,
    commitBehavior = 'succeed',
    drainBehavior = 'succeed',
  } = options;
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let commitCount = 0;
  let closeAfterDrainCalled = false;
  const errors = [];

  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency, intervalMs, maxPendingBytes },
        (error) => { errors.push(error); },
      );
    }

    async executeSingleCommit() {
      commitCount++;
      if (commitBehavior === 'fail') {
        throw new Error('commit failed: backend unavailable');
      }
    }

    onCloseAfterDrain() {
      closeAfterDrainCalled = true;
      if (drainBehavior === 'fail') {
        throw new Error('drain failed: lock release error');
      }
      return Promise.resolve();
    }
  }

  const controller = new TestController();

  return {
    controller,
    commitCount: () => commitCount,
    errors: () => errors,
    closeAfterDrainCalled: () => closeAfterDrainCalled,
  };
};

test('close() flushes pending writes under scheduled autoCommit without maxPendingBytes', async () => {
  const { controller, commitCount } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000, // 1h — timer won't fire during test
  });

  await controller.handleRecordAppended(100);
  await controller.handleRecordAppended(200);

  // No commits yet — timer hasn't fired, no byte threshold
  assert.equal(commitCount(), 0);

  await controller.close();

  // close() must have flushed the pending data
  assert.ok(commitCount() >= 1, 'expected at least one commit on close');
});

test('close() flushes pending writes when maxPendingBytes not yet reached', async () => {
  const { controller, commitCount } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
    maxPendingBytes: 999999,
  });

  await controller.handleRecordAppended(50);

  assert.equal(commitCount(), 0);

  await controller.close();

  assert.ok(commitCount() >= 1, 'expected at least one commit on close');
});

test('close() flushes dirty-from-clear state set after last commit', async () => {
  const { controller, commitCount } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
  });

  // handleCleared() queues a background commit that runs immediately,
  // so we verify that if dirtyFromClear is set by a sequence of operations
  // close() still commits. Force a commit first, then set dirty state.
  await controller.handleRecordAppended(100);
  await controller.commitNow();
  const commitsAfterExplicit = commitCount();

  // Now mark dirty again — the timer hasn't fired, so without the close-flush fix
  // this would be lost.
  await controller.handleCleared();
  // handleCleared queues a background commit — wait for it
  // The background commit may have already run; the point is close() ensures it.

  await controller.close();

  assert.ok(commitCount() > commitsAfterExplicit, 'expected commit for cleared state on close');
});

test('close() does not commit when nothing is pending', async () => {
  const { controller, commitCount } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
  });

  // No writes at all
  await controller.close();

  assert.equal(commitCount(), 0);
});

test('close() is idempotent — no extra commits on second call', async () => {
  const { controller, commitCount } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
  });

  await controller.handleRecordAppended(100);
  await controller.close();

  const commitsAfterFirst = commitCount();
  await controller.close();

  assert.equal(commitCount(), commitsAfterFirst);
});

test('immediate mode close() does not double-commit', async () => {
  const { controller, commitCount } = await createTestController({
    frequency: 'immediate',
  });

  // immediate mode commits on handleRecordAppended
  await controller.handleRecordAppended(100);
  assert.equal(commitCount(), 1);

  await controller.close();

  // No additional commit since pendingAutoCommitBytes was cleared by immediate commit
  assert.equal(commitCount(), 1);
});

test('close() rejects when final flush commit fails', async () => {
  const { controller, errors } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
    commitBehavior: 'fail',
  });

  await controller.handleRecordAppended(100);

  // close() must propagate the commit error to the caller
  await assert.rejects(
    () => controller.close(),
    (err) => err instanceof Error && err.message.includes('backend unavailable'),
  );

  // Error listener should NOT be called — caller owns the error
  assert.equal(errors().length, 0);
});

test('close() still runs onCloseAfterDrain even when final flush fails', async () => {
  const { controller, closeAfterDrainCalled } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
    commitBehavior: 'fail',
  });

  await controller.handleRecordAppended(100);

  await controller.close().catch(() => {});

  // Resource cleanup must still happen (file lock release, IDB close, etc.)
  assert.equal(closeAfterDrainCalled(), true);
});

test('close() preserves both errors when flush and drain both fail', async () => {
  const { controller } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
    commitBehavior: 'fail',
    drainBehavior: 'fail',
  });

  await controller.handleRecordAppended(100);

  let thrownError = null;
  try {
    await controller.close();
  } catch (err) {
    thrownError = err;
  }

  assert.notEqual(thrownError, null, 'close() must reject');

  // Must be an AggregateError containing both failures
  assert.equal(thrownError.constructor.name, 'AggregateError');
  assert.equal(thrownError.errors.length, 2);

  const messages = thrownError.errors.map((e) => e.message);
  assert.ok(messages.some((m) => m.includes('backend unavailable')), 'flush error preserved');
  assert.ok(messages.some((m) => m.includes('lock release error')), 'drain error preserved');
});

test('close() preserves both errors on runtimes without AggregateError', async () => {
  const original = globalThis.AggregateError;
  delete globalThis.AggregateError;

  try {
    const { controller } = await createTestController({
      frequency: 'scheduled',
      intervalMs: 3_600_000,
      commitBehavior: 'fail',
      drainBehavior: 'fail',
    });

    await controller.handleRecordAppended(100);

    let thrownError = null;
    try {
      await controller.close();
    } catch (err) {
      thrownError = err;
    }

    assert.notEqual(thrownError, null, 'close() must reject');
    assert.ok(thrownError instanceof Error);
    // Fallback: plain Error with .errors array
    assert.ok(Array.isArray(thrownError.errors), 'expected .errors array on fallback');
    assert.equal(thrownError.errors.length, 2);

    const messages = thrownError.errors.map((e) => e.message);
    assert.ok(messages.some((m) => m.includes('backend unavailable')), 'flush error preserved');
    assert.ok(messages.some((m) => m.includes('lock release error')), 'drain error preserved');
  } finally {
    globalThis.AggregateError = original;
  }
});

test('close() throws drain error directly when only drain fails (no flush error)', async () => {
  const { controller } = await createTestController({
    frequency: 'scheduled',
    intervalMs: 3_600_000,
    commitBehavior: 'succeed',
    drainBehavior: 'fail',
  });

  await controller.handleRecordAppended(100);

  await assert.rejects(
    () => controller.close(),
    (err) => err instanceof Error && err.message.includes('lock release error'),
  );
});
