import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadStorageModule, importDistModule } from '../load-module.mjs';

const createSandboxDirectory = (name) => {
  const baseDir = resolve(process.cwd(), 'tests/.tmp');
  mkdirSync(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = join(baseDir, `${name}-${uniqueSuffix}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

const createStringKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'string') throw new TypeError(`${fieldName} must be string.`);
    if (value.length === 0) throw new TypeError(`${fieldName} must not be empty.`);
    return value;
  },
  compare: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
});

describe('file backend reopen size accuracy', () => {
  test('post-reopen insert succeeds when actual tree data is within strict capacity', async () => {
    const { Datastore } = await loadStorageModule();
    const { fileDriver } = await importDistModule('drivers/file.js');

    const tempDir = createSandboxDirectory('reopen-size');
    try {
      const filePath = join(tempDir, 'test.db');

      const ds1 = new Datastore({
        key: createStringKeyDefinition(),
        capacity: { maxSize: 230, policy: 'strict' },
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 'x' } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        key: createStringKeyDefinition(),
        capacity: { maxSize: 230, policy: 'strict' },
        driver: fileDriver({ filePath }),
      });
      // Must not throw QuotaExceededError due to inflated size from envelope
      await ds2.put({ key: 'b', payload: { v: 'y' } });

      const allRecords = await ds2.getAll();
      const keys = allRecords.map((r) => r.key).sort();
      assert.deepStrictEqual(keys, ['a', 'b'], 'both records must be present after reopen insert');

      await ds2.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('loaded size matches JSON.stringify(treeJSON) length', async () => {
    const { writeInitialFileSnapshot, loadFileSnapshot } = await importDistModule(
      'storage/drivers/file/fileBackendSnapshot.js',
    );

    const tempDir = mkdtempSync(join(tmpdir(), 'fp-snapshot-size-'));
    try {
      const baseFileName = 'test-db';
      const activeDataFile = `${baseFileName}.g.0`;
      const backend = {
        directoryPath: tempDir,
        baseFileName,
        activeDataFile,
        sidecarPath: join(tempDir, `${baseFileName}.meta.json`),
        commitId: 0,
        lockAcquired: false,
      };

      writeInitialFileSnapshot(backend);

      const loadedSnapshot = loadFileSnapshot(backend);

      const treeJsonString = JSON.stringify(loadedSnapshot.treeJSON);
      const expectedSize = new TextEncoder().encode(treeJsonString).byteLength;
      assert.equal(
        loadedSnapshot.currentSizeBytes,
        expectedSize,
        `currentSizeBytes (${loadedSnapshot.currentSizeBytes}) must equal UTF-8 byte length of JSON.stringify(treeJSON) (${expectedSize}), not the full generation file envelope length`,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
