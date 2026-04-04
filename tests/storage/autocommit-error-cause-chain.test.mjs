import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

test('emitAutoCommitErrorToListeners preserves cause when wrapping a plain Error', async () => {
  const { emitAutoCommitErrorToListeners } = await importDistModule(
    'storage/backend/autoCommit.js',
  );
  const { StorageEngineError } = await importDistModule('errors/index.js');

  const originalError = new TypeError('ENOSPC: disk full');
  let receivedEvent;

  const listeners = new Set([
    (event) => {
      receivedEvent = event;
    },
  ]);

  emitAutoCommitErrorToListeners(listeners, originalError);

  assert.ok(receivedEvent !== undefined, 'listener must be called');
  assert.ok(receivedEvent.error instanceof StorageEngineError);
  assert.equal(receivedEvent.error.message, 'ENOSPC: disk full');
  assert.equal(receivedEvent.error.cause, originalError);
});

test('emitAutoCommitErrorToListeners preserves existing StorageEngineError as-is', async () => {
  const { emitAutoCommitErrorToListeners } = await importDistModule(
    'storage/backend/autoCommit.js',
  );
  const { StorageEngineError } = await importDistModule('errors/index.js');

  const existing = new StorageEngineError('already wrapped');
  let receivedEvent;

  const listeners = new Set([
    (event) => {
      receivedEvent = event;
    },
  ]);

  emitAutoCommitErrorToListeners(listeners, existing);

  assert.ok(receivedEvent !== undefined);
  assert.equal(receivedEvent.error, existing);
});

test('emitAutoCommitErrorToListeners wraps non-Error unknown values with fallback message', async () => {
  const { emitAutoCommitErrorToListeners } = await importDistModule(
    'storage/backend/autoCommit.js',
  );
  const { StorageEngineError } = await importDistModule('errors/index.js');

  let receivedEvent;

  const listeners = new Set([
    (event) => {
      receivedEvent = event;
    },
  ]);

  emitAutoCommitErrorToListeners(listeners, 'string-error');

  assert.ok(receivedEvent !== undefined);
  assert.ok(receivedEvent.error instanceof StorageEngineError);
  assert.equal(receivedEvent.error.message, 'Unknown auto-commit storage failure.');
  assert.equal(receivedEvent.error.cause, 'string-error');
});
