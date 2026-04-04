import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

test('capacity.maxSize "0B" string rejects with same message as number 0', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  let numberMessage;
  try {
    new Datastore({ capacity: { maxSize: 0 } });
    assert.fail('Expected ConfigurationError for numeric 0');
  } catch (error) {
    assert.ok(error instanceof ConfigurationError);
    numberMessage = error.message;
  }

  let stringMessage;
  try {
    new Datastore({ capacity: { maxSize: '0B' } });
    assert.fail('Expected ConfigurationError for string "0B"');
  } catch (error) {
    assert.ok(error instanceof ConfigurationError);
    stringMessage = error.message;
  }

  assert.equal(
    numberMessage,
    stringMessage,
    'Error messages should be identical for numeric 0 and string "0B"',
  );
});

test('capacity.maxSize "0KB" string also rejects consistently', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: '0KB' } }),
    ConfigurationError,
  );
});

test('valid capacity.maxSize numeric value does not throw', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ capacity: { maxSize: 1024 } });
  await datastore.close();
});

test('valid capacity.maxSize "1KB" string does not throw', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ capacity: { maxSize: '1KB' } });
  await datastore.close();
});

test('valid capacity.maxSize "10MB" string does not throw', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ capacity: { maxSize: '10MB' } });
  await datastore.close();
});

test('valid capacity.maxSize "1GB" string does not throw', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ capacity: { maxSize: '1GB' } });
  await datastore.close();
});

test('capacity.maxSize string without unit rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: '100' } }),
    ConfigurationError,
  );
});

test('capacity.maxSize with unit before number rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: 'KB1' } }),
    ConfigurationError,
  );
});

test('capacity.maxSize with decimal rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: '1.5KB' } }),
    ConfigurationError,
  );
});

test('capacity.maxSize empty string rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: '' } }),
    ConfigurationError,
  );
});

test('capacity.maxSize negative number rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: -1 } }),
    ConfigurationError,
  );
});

test('capacity.maxSize beyond safe integer rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: Number.MAX_SAFE_INTEGER + 1 } }),
    ConfigurationError,
  );
});

test('capacity.maxSize string that overflows safe integer rejects', async () => {
  const { Datastore } = await loadStorageModule();
  const { ConfigurationError } = await importDistModule('errors/index.js');

  assert.throws(
    () => new Datastore({ capacity: { maxSize: '9007199254740992GB' } }),
    ConfigurationError,
  );
});
