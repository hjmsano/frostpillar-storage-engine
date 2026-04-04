import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { TextEncoder } from 'node:util';
import { build } from 'esbuild';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createTempEntryFile = async (sourceText) => {
  const tempDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'frostpillar-tree-shaking-test-'),
  );
  const entryFilePath = path.join(tempDirectory, 'entry.mjs');
  await writeFile(entryFilePath, sourceText, 'utf8');
  return entryFilePath;
};

test('driver subpath modules expose named driver factories', async () => {
  await loadStorageModule();

  const { fileDriver } = await importDistModule('drivers/file.js');
  const { localStorageDriver } = await importDistModule('drivers/localStorage.js');
  const { indexedDBDriver } = await importDistModule('drivers/indexedDB.js');
  const { opfsDriver } = await importDistModule('drivers/opfs.js');
  const { syncStorageDriver } = await importDistModule('drivers/syncStorage.js');

  assert.equal(typeof fileDriver, 'function');
  assert.equal(typeof localStorageDriver, 'function');
  assert.equal(typeof indexedDBDriver, 'function');
  assert.equal(typeof opfsDriver, 'function');
  assert.equal(typeof syncStorageDriver, 'function');
});

test('root module re-exports browser driver factories for browser bundle access', async () => {
  await loadStorageModule();

  const rootModule = await importDistModule('index.js');

  // Browser-targeted drivers are exported from root per spec §2.
  // ESM/CJS consumers rely on tree-shaking (sideEffects: false) to exclude unused drivers.
  assert.equal(typeof rootModule.localStorageDriver, 'function');
  assert.equal(typeof rootModule.indexedDBDriver, 'function');
  assert.equal(typeof rootModule.opfsDriver, 'function');
  assert.equal(typeof rootModule.syncStorageDriver, 'function');
  // Node-only fileDriver remains subpath-only.
  assert.equal(typeof rootModule.fileDriver, 'undefined');
});

test('browser bundle succeeds for memory mode without node builtins', async () => {
  await loadStorageModule();
  const distIndexPath = path.resolve(process.cwd(), 'dist/index.js');
  const entryFilePath = await createTempEntryFile(
    `import { Datastore } from ${JSON.stringify(distIndexPath)};
const datastore = new Datastore({});
void datastore;`,
  );

  await build({
    entryPoints: [entryFilePath],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
  });
});

test('browser bundle succeeds when selecting localStorage driver only', async () => {
  await loadStorageModule();
  const distIndexPath = path.resolve(process.cwd(), 'dist/index.js');
  const driverModulePath = path.resolve(process.cwd(), 'dist/drivers/localStorage.js');
  const entryFilePath = await createTempEntryFile(
    `import { Datastore } from ${JSON.stringify(distIndexPath)};
import { localStorageDriver } from ${JSON.stringify(driverModulePath)};
const datastore = new Datastore({
  driver: localStorageDriver(),
});
void datastore;`,
  );

  await build({
    entryPoints: [entryFilePath],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
  });
});

test('browser iife bundle exposes all runtime root exports on global object', async () => {
  await loadStorageModule();
  const distIndexPath = path.resolve(process.cwd(), 'dist/index.js');
  const distRootModule = await importDistModule('index.js');
  const result = await build({
    entryPoints: [distIndexPath],
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'FrostpillarStorageEngine',
    write: false,
  });

  assert.ok(result.outputFiles.length > 0);
  const outputText = result.outputFiles[0].text;
  const context = {
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(outputText, context);

  const browserApi = context.FrostpillarStorageEngine;
  assert.equal(typeof browserApi, 'object');
  const runtimeRootExports = Object.entries(distRootModule)
    .filter(([_name, value]) => typeof value !== 'undefined')
    .map(([name]) => name)
    .sort();
  const globalExports = Object.keys(browserApi).sort();

  assert.deepEqual(globalExports, runtimeRootExports);
});

test('root type exports do not expose legacy datastore location config types', async () => {
  await loadStorageModule();
  const rootTypeDefinition = await readFile(
    path.resolve(process.cwd(), 'dist/index.d.ts'),
    'utf8',
  );
  const sharedTypeDefinition = await readFile(
    path.resolve(process.cwd(), 'dist/types.d.ts'),
    'utf8',
  );

  assert.match(rootTypeDefinition, /\bFileBackendConfig\b/);
  assert.match(rootTypeDefinition, /\bDatastoreDriverInitContext\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bDatastoreDriverInitCallbacks\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bBrowserDatastoreConfig\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bFileDatastoreConfig\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bBrowserStorageType\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bTimestampInput\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bTimeseriesRecord\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bInputTimeseriesRecord\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bPersistedTimeseriesRecord\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bInputKeyedRecord\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bPersistedKeyedRecord\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bNativeAggregateExpression\b/);
  assert.doesNotMatch(rootTypeDefinition, /\bNativeAggregateFunction\b/);
});

test('file driver options type is declared as FileBackendConfig alias', async () => {
  await loadStorageModule();
  const fileDriverTypeDefinition = await readFile(
    path.resolve(process.cwd(), 'dist/drivers/file.d.ts'),
    'utf8',
  );

  assert.match(
    fileDriverTypeDefinition,
    /export type FileDriverOptions = FileBackendConfig;/,
  );
  assert.doesNotMatch(
    fileDriverTypeDefinition,
    /export interface FileDriverOptions extends FileBackendConfig/,
  );
});

test('BrowserStorageType declaration is removed from source types', async () => {
  const sourceTypes = await readFile(
    path.resolve(process.cwd(), 'src/types.ts'),
    'utf8',
  );

  assert.doesNotMatch(
    sourceTypes,
    /export type BrowserStorageType =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type TimestampInput =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type TimeseriesRecord =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type PersistedTimeseriesRecord =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type InputTimeseriesRecord =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type TimeRangeQuery =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type InputKeyedRecord/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type PersistedKeyedRecord/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type RecordRangeQuery/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export type NativeAggregateFunction =/u,
  );
  assert.doesNotMatch(
    sourceTypes,
    /export interface NativeAggregateExpression/u,
  );
});

test('build script is configured for clean dist output', async () => {
  const packageJson = JSON.parse(
    await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'),
  );
  const cleanBuildScript = packageJson.scripts['clean:build'];
  const buildScript = packageJson.scripts.build;

  assert.equal(cleanBuildScript, 'rm -rf dist tsconfig.tsbuildinfo');
  assert.match(buildScript, /^pnpm clean:build && /);
});
