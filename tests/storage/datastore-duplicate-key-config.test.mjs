import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

const isConfigurationError = (error) =>
  error instanceof Error && error.name === 'ConfigurationError';

test('Datastore accepts no duplicateKeys config and defaults to allow', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({});
  await datastore.close();
});

test('Datastore accepts duplicateKeys: allow', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ duplicateKeys: 'allow' });
  await datastore.close();
});

test('Datastore accepts duplicateKeys: replace', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ duplicateKeys: 'replace' });
  await datastore.close();
});

test('Datastore accepts duplicateKeys: reject', async () => {
  const { Datastore } = await loadStorageModule();
  const datastore = new Datastore({ duplicateKeys: 'reject' });
  await datastore.close();
});

test('Datastore throws ConfigurationError for numeric duplicateKeys value', async () => {
  const { Datastore } = await loadStorageModule();
  assert.throws(
    () => new Datastore({ duplicateKeys: 42 }),
    isConfigurationError,
  );
});

test('Datastore throws ConfigurationError for boolean duplicateKeys value', async () => {
  const { Datastore } = await loadStorageModule();
  assert.throws(
    () => new Datastore({ duplicateKeys: true }),
    isConfigurationError,
  );
});

test('Datastore throws ConfigurationError for an unrecognized string duplicateKeys value', async () => {
  const { Datastore } = await loadStorageModule();
  assert.throws(
    () => new Datastore({ duplicateKeys: 'upsert' }),
    isConfigurationError,
  );
});

test('Datastore throws ConfigurationError for null duplicateKeys value', async () => {
  const { Datastore } = await loadStorageModule();
  assert.throws(
    () => new Datastore({ duplicateKeys: null }),
    isConfigurationError,
  );
});

test('Datastore throws ConfigurationError for object duplicateKeys value', async () => {
  const { Datastore } = await loadStorageModule();
  assert.throws(
    () => new Datastore({ duplicateKeys: {} }),
    isConfigurationError,
  );
});
