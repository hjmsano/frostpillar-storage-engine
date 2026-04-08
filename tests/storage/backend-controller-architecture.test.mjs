import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadStorageModule } from '../load-module.mjs';

const createSandboxDirectory = async (name) => {
  const baseDir = path.resolve(process.cwd(), 'tests/.tmp');
  await mkdir(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = path.join(baseDir, `${name}-${uniqueSuffix}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

const importDistModule = async (relativeDistPath) => {
  await loadStorageModule();
  const moduleHref = pathToFileURL(
    path.resolve(process.cwd(), 'dist', relativeDistPath),
  ).href;
  return await import(moduleHref);
};

test('file, localStorage, and syncStorage controllers extend async durable auto-commit base', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );
  const { FileBackendController } = await importDistModule(
    'storage/drivers/file/fileBackendController.js',
  );
  const { LocalStorageBackendController } = await importDistModule(
    'storage/drivers/localStorage/localStorageBackendController.js',
  );
  const { SyncStorageBackendController } = await importDistModule(
    'storage/drivers/syncStorage/syncStorageBackendController.js',
  );

  assert.equal(
    Object.getPrototypeOf(FileBackendController.prototype),
    AsyncDurableAutoCommitController.prototype,
  );
  assert.equal(
    Object.getPrototypeOf(LocalStorageBackendController.prototype),
    AsyncDurableAutoCommitController.prototype,
  );
  assert.equal(
    Object.getPrototypeOf(SyncStorageBackendController.prototype),
    AsyncDurableAutoCommitController.prototype,
  );
});

test('handleCleared queues background commit even when pending bytes is zero', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let commitCount = 0;

  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency: 'scheduled', intervalMs: 100_000, maxPendingBytes: null },
        () => {},
      );
    }
    async executeSingleCommit() {
      commitCount++;
    }
  }

  const controller = new TestController();

  assert.equal(commitCount, 0);

  await controller.handleCleared();
  // handleCleared queues a background commit immediately, so await settlement
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(
    commitCount >= 1,
    'handleCleared must trigger a commit even with 0 pending bytes',
  );

  await controller.close();
});

test('handleCleared during in-flight commit is not lost', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let commitCount = 0;
  let clearDuringCommit;

  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency: 'scheduled', intervalMs: 100_000, maxPendingBytes: null },
        () => {},
      );
    }
    async executeSingleCommit() {
      commitCount++;
      if (commitCount === 1 && clearDuringCommit) {
        // Simulate handleCleared() arriving during the first commit
        await clearDuringCommit();
      }
    }
  }

  const controller = new TestController();
  clearDuringCommit = () => controller.handleCleared();

  // First handleCleared triggers the commit loop
  await controller.handleCleared();
  // Wait for the commit loop to settle
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(
    commitCount,
    2,
    'second handleCleared during in-flight commit must trigger another commit',
  );

  await controller.close();
});

test('handleCleared retries after background commit failure', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let commitAttempts = 0;
  let autoCommitErrorCalls = 0;

  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency: 'scheduled', intervalMs: 20, maxPendingBytes: null },
        () => {
          autoCommitErrorCalls++;
        },
      );
    }
    async executeSingleCommit() {
      commitAttempts++;
      if (commitAttempts === 1) {
        throw new Error('transient-clear-commit-failure');
      }
    }
  }

  const controller = new TestController();

  await controller.handleCleared();
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.ok(
    commitAttempts >= 2,
    'clear durability signal must be retried after background commit failure',
  );
  assert.equal(autoCommitErrorCalls, 1);

  await controller.close();
});

test('handleCleared on immediate mode triggers foreground commit', async () => {
  const { AsyncDurableAutoCommitController } = await importDistModule(
    'storage/backend/asyncDurableAutoCommitController.js',
  );

  let commitCount = 0;

  class TestController extends AsyncDurableAutoCommitController {
    constructor() {
      super(
        { frequency: 'immediate', intervalMs: null, maxPendingBytes: null },
        () => {},
      );
    }
    async executeSingleCommit() {
      commitCount++;
    }
  }

  const controller = new TestController();
  await controller.handleCleared();
  assert.equal(commitCount, 1);
  await controller.close();
});

test('foreground commit rejection is always an Error instance', async () => {
  const { ConfigurationError, FileBackendController } = await importDistModule(
    'storage/drivers/file/fileBackendController.js',
  );
  const sandbox = await createSandboxDirectory('controller-foreground-error');
  const filePath = path.join(sandbox, 'events.fpdb');

  try {
    const result = FileBackendController.create({
      config: {
        filePath,
      },
      autoCommit: { frequency: 'immediate' },
      testHooks: {
        beforeCommit: () => {
          throw 'non-error-value';
        },
      },
      getSnapshot: () => ({
        treeJSON: { version: 1, config: {}, entries: [] },
      }),
      onAutoCommitError: () => {},
    });

    await assert.rejects(result.controller.commitNow(), (error) => {
      assert.ok(error instanceof Error);
      return true;
    });
    await result.controller.close();

    assert.throws(() => {
      FileBackendController.create({
        config: {
          filePath: path.join(sandbox, 'invalid-hooks.fpdb'),
          __testHooks: {},
        },
        autoCommit: { frequency: 'immediate' },
        getSnapshot: () => ({
          treeJSON: { version: 1, config: {}, entries: [] },
        }),
        onAutoCommitError: () => {},
      });
    }, ConfigurationError);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('DurableBackendController interface includes handleCleared', async () => {
  const controllerSource = await readFile(
    path.resolve(process.cwd(), 'src/storage/backend/types.ts'),
    'utf8',
  );
  assert.match(controllerSource, /handleCleared\(\):\s*Promise<void>/);
});

test('async orchestration source avoids Promise.resolve wrapper chains', async () => {
  const datastoreSource = await readFile(
    path.resolve(process.cwd(), 'src/storage/datastore/Datastore.ts'),
    'utf8',
  );
  const autoCommitSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/backend/asyncDurableAutoCommitController.ts',
    ),
    'utf8',
  );

  assert.doesNotMatch(datastoreSource, /Promise\.resolve\(\)\.then\(async/s);
  assert.doesNotMatch(autoCommitSource, /Promise\.resolve\(\)\.then\(async/s);
});

test('driver source does not reconstruct legacy datastore location config', async () => {
  const localStorageDriverSource = await readFile(
    path.resolve(process.cwd(), 'src/drivers/localStorage.ts'),
    'utf8',
  );
  const syncStorageDriverSource = await readFile(
    path.resolve(process.cwd(), 'src/drivers/syncStorage.ts'),
    'utf8',
  );
  const indexedDBDriverSource = await readFile(
    path.resolve(process.cwd(), 'src/drivers/indexedDB.ts'),
    'utf8',
  );
  const opfsDriverSource = await readFile(
    path.resolve(process.cwd(), 'src/drivers/opfs.ts'),
    'utf8',
  );
  const fileDriverSource = await readFile(
    path.resolve(process.cwd(), 'src/drivers/file.ts'),
    'utf8',
  );

  assert.doesNotMatch(localStorageDriverSource, /location:\s*'browser'/);
  assert.doesNotMatch(syncStorageDriverSource, /location:\s*'browser'/);
  assert.doesNotMatch(indexedDBDriverSource, /location:\s*'browser'/);
  assert.doesNotMatch(opfsDriverSource, /location:\s*'browser'/);
  assert.doesNotMatch(fileDriverSource, /location:\s*'file'/);

  assert.match(
    localStorageDriverSource,
    /from '\.\.\/storage\/drivers\/localStorage\/localStorageConfig\.js'/,
  );
  assert.match(
    syncStorageDriverSource,
    /from '\.\.\/storage\/drivers\/syncStorage\/syncStorageConfig\.js'/,
  );
  assert.doesNotMatch(localStorageDriverSource, /from '\.\/validation\.js'/);
  assert.doesNotMatch(syncStorageDriverSource, /from '\.\/validation\.js'/);
  assert.doesNotMatch(localStorageDriverSource, /\b32768\b/);
  assert.doesNotMatch(localStorageDriverSource, /\b64\b/);
  assert.doesNotMatch(syncStorageDriverSource, /\b102400\b/);
});

test('capacity resolver imports shared config parser directly', async () => {
  const capacityResolverSource = await readFile(
    path.resolve(process.cwd(), 'src/storage/backend/capacityResolver.ts'),
    'utf8',
  );

  assert.match(
    capacityResolverSource,
    /from '\.\.\/config\/config\.shared\.js'/,
  );
  assert.doesNotMatch(
    capacityResolverSource,
    /from '\.\.\/config\/config\.js'/,
  );
});

test('durable backend controller create options require config objects', async () => {
  const fileControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/file/fileBackendController.ts',
    ),
    'utf8',
  );
  const localStorageControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/localStorage/localStorageBackendController.ts',
    ),
    'utf8',
  );
  const syncStorageControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/syncStorage/syncStorageBackendController.ts',
    ),
    'utf8',
  );
  const indexedDBControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/IndexedDB/indexedDBBackendController.ts',
    ),
    'utf8',
  );
  const opfsControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/opfs/opfsBackendController.ts',
    ),
    'utf8',
  );

  assert.match(
    fileControllerSource,
    /interface FileBackendControllerCreateOptions[\s\S]*config: FileBackendConfig;/,
  );
  assert.match(
    localStorageControllerSource,
    /interface LocalStorageBackendControllerCreateOptions[\s\S]*config: LocalStorageConfig;/,
  );
  assert.match(
    syncStorageControllerSource,
    /interface SyncStorageBackendControllerCreateOptions[\s\S]*config: SyncStorageConfig;/,
  );
  assert.match(
    indexedDBControllerSource,
    /interface IndexedDBBackendControllerCreateOptions[\s\S]*config: IndexedDBConfig;/,
  );
  assert.match(
    opfsControllerSource,
    /interface OpfsBackendControllerCreateOptions[\s\S]*config: OpfsConfig;/,
  );
  assert.doesNotMatch(
    localStorageControllerSource,
    /config\?: LocalStorageConfig;/,
  );
  assert.doesNotMatch(
    syncStorageControllerSource,
    /config\?: SyncStorageConfig;/,
  );
  assert.doesNotMatch(indexedDBControllerSource, /config\?: IndexedDBConfig;/);
  assert.doesNotMatch(opfsControllerSource, /config\?: OpfsConfig;/);
});

test('indexedDB controller does not double-default values already parsed by shared config', async () => {
  const indexedDBControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/IndexedDB/indexedDBBackendController.ts',
    ),
    'utf8',
  );

  assert.match(
    indexedDBControllerSource,
    /const idbConfig = parseIndexedDBConfig\(options\.config\);/,
  );
  assert.doesNotMatch(
    indexedDBControllerSource,
    /idbConfig\.databaseName\s*\?\?/,
  );
  assert.doesNotMatch(
    indexedDBControllerSource,
    /idbConfig\.objectStoreName\s*\?\?/,
  );
  assert.doesNotMatch(indexedDBControllerSource, /idbConfig\.version\s*\?\?/);
});

test('opfs metadata parsing reuses shared non-negative-safe-integer validator', async () => {
  const opfsBackendSource = await readFile(
    path.resolve(process.cwd(), 'src/storage/drivers/opfs/opfsBackend.ts'),
    'utf8',
  );

  assert.match(opfsBackendSource, /parseNonNegativeSafeInteger/);
  assert.match(
    opfsBackendSource,
    /parseNonNegativeSafeInteger\(\s*manifest\.commitId,/,
  );
  assert.doesNotMatch(opfsBackendSource, /typeof commitId !== 'number'/);
});

test('indexedDB and opfs controllers do not advance commitId before durable write', async () => {
  const indexedDBControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/IndexedDB/indexedDBBackendController.ts',
    ),
    'utf8',
  );
  const opfsControllerSource = await readFile(
    path.resolve(
      process.cwd(),
      'src/storage/drivers/opfs/opfsBackendController.ts',
    ),
    'utf8',
  );

  // Must not pre-increment: this.commitId += 1 before an await
  assert.doesNotMatch(indexedDBControllerSource, /this\.commitId \+= 1/);
  assert.doesNotMatch(opfsControllerSource, /this\.commitId \+= 1/);

  // Must stage into a local variable and assign only after success
  assert.match(
    indexedDBControllerSource,
    /const nextCommitId = this\.commitId \+ 1/,
  );
  assert.match(
    opfsControllerSource,
    /const nextCommitId = this\.commitId \+ 1/,
  );
  assert.match(indexedDBControllerSource, /this\.commitId = nextCommitId/);
  assert.match(opfsControllerSource, /this\.commitId = nextCommitId/);
});
