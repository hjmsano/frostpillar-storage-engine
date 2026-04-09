import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const publicModuleHref = pathToFileURL(
  path.resolve(process.cwd(), 'dist/index.js'),
).href;

let buildPromise = null;

const ensureBuild = async () => {
  if (buildPromise !== null) {
    return await buildPromise;
  }

  buildPromise = Promise.resolve().then(() => {
    const tscCliPath = path.resolve(
      process.cwd(),
      'node_modules/typescript/bin/tsc',
    );
    const result = spawnSync(
      process.execPath,
      [tscCliPath, '--build', '--force'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    if (result.error !== undefined) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `TypeScript build failed before tests.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      );
    }
  });

  return await buildPromise;
};

const loadPublicModule = async () => {
  await ensureBuild();
  return await import(publicModuleHref);
};

test('public API exports FrostpillarError as root error for family-wide catches', async () => {
  const frostpillarModule = await loadPublicModule();

  assert.equal(typeof frostpillarModule.FrostpillarError, 'function');

  const validationError = new frostpillarModule.ValidationError(
    'invalid payload',
  );
  assert.ok(validationError instanceof frostpillarModule.FrostpillarError);
  assert.ok(validationError instanceof Error);

  const configError = new frostpillarModule.ConfigurationError('bad config');
  assert.ok(configError instanceof frostpillarModule.FrostpillarError);

  const quotaError = new frostpillarModule.QuotaExceededError('full');
  assert.ok(quotaError instanceof frostpillarModule.FrostpillarError);

  const lockedError = new frostpillarModule.DatabaseLockedError('locked');
  assert.ok(lockedError instanceof frostpillarModule.FrostpillarError);
  assert.ok(lockedError instanceof Error);
});

test('public API exports all core error subclasses for granular instanceof checks', async () => {
  const frostpillarModule = await loadPublicModule();

  assert.equal(typeof frostpillarModule.BinaryFormatError, 'function');
  assert.equal(typeof frostpillarModule.ClosedDatastoreError, 'function');
  assert.equal(typeof frostpillarModule.IndexCorruptionError, 'function');
  assert.equal(typeof frostpillarModule.InvalidQueryRangeError, 'function');
  assert.equal(typeof frostpillarModule.PageCorruptionError, 'function');
  assert.equal(typeof frostpillarModule.StorageEngineError, 'function');
  assert.equal(typeof frostpillarModule.UnsupportedBackendError, 'function');

  assert.ok(
    new frostpillarModule.StorageEngineError('x') instanceof
      frostpillarModule.FrostpillarError,
  );
  assert.ok(
    new frostpillarModule.BinaryFormatError('x') instanceof
      frostpillarModule.StorageEngineError,
  );
  assert.ok(
    new frostpillarModule.PageCorruptionError('x') instanceof
      frostpillarModule.StorageEngineError,
  );
  assert.ok(
    new frostpillarModule.IndexCorruptionError('x') instanceof
      frostpillarModule.StorageEngineError,
  );
  assert.ok(
    new frostpillarModule.DatabaseLockedError('x') instanceof
      frostpillarModule.StorageEngineError,
  );
});

test('query-layer error classes are not part of the storage engine public API', async () => {
  const frostpillarModule = await loadPublicModule();

  assert.equal(typeof frostpillarModule.TimestampParseError, 'undefined');
  assert.equal(typeof frostpillarModule.QueryParseError, 'undefined');
  assert.equal(
    typeof frostpillarModule.UnsupportedQueryFeatureError,
    'undefined',
  );
});
