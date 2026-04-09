import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createSandboxDirectory = (name) => {
  const baseDir = resolve(process.cwd(), 'tests/.tmp');
  mkdirSync(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = join(baseDir, `${name}-${uniqueSuffix}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

const findLatestGenerationFile = (sandbox, baseFileName) => {
  const entries = readdirSync(sandbox);
  const generationPrefix = `${baseFileName}.g.`;
  const genFiles = entries
    .filter((e) => e.startsWith(generationPrefix) && !e.endsWith('.tmp'))
    .sort();
  return genFiles.length > 0 ? join(sandbox, genFiles.at(-1)) : null;
};

describe('clear() durable commit integration', () => {
  test('clear() with immediate auto-commit writes empty state to disk', async () => {
    const { Datastore } = await loadStorageModule();
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('clear-immediate-commit');
    const filePath = join(sandbox, 'test.fpdb');

    try {
      const datastore = new Datastore({
        driver: fileDriver({ filePath }),
        autoCommit: { frequency: 'immediate' },
      });

      await datastore.put({ key: 'seed', payload: { v: 1 } });
      await datastore.commit();

      const sidecarPath = `${filePath}.meta.json`;
      assert.ok(existsSync(sidecarPath), 'sidecar must exist after commit');

      const genBefore = findLatestGenerationFile(sandbox, 'test.fpdb');
      assert.ok(genBefore !== null, 'generation file must exist after commit');
      const contentBefore = readFileSync(genBefore, 'utf8');
      assert.ok(
        contentBefore.includes('"seed"'),
        'generation must contain seed record',
      );

      await datastore.clear();

      const genAfter = findLatestGenerationFile(sandbox, 'test.fpdb');
      assert.ok(genAfter !== null, 'generation file must exist after clear');
      const contentAfter = readFileSync(genAfter, 'utf8');
      assert.ok(
        !contentAfter.includes('"seed"'),
        'generation must not contain cleared records',
      );

      const parsed = JSON.parse(contentAfter);
      assert.deepStrictEqual(
        parsed.treeJSON.entries,
        [],
        'generation treeJSON entries must be empty after clear',
      );

      await datastore.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test('clear() state survives reopen', async () => {
    const { Datastore } = await loadStorageModule();
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('clear-reopen-durability');
    const filePath = join(sandbox, 'test.fpdb');

    try {
      const ds1 = new Datastore({
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'alpha', payload: { v: 1 } });
      await ds1.put({ key: 'beta', payload: { v: 2 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        driver: fileDriver({ filePath }),
      });
      const beforeClear = await ds2.getAll();
      assert.equal(
        beforeClear.length,
        2,
        'reopened datastore must have persisted records',
      );

      await ds2.clear();
      await ds2.commit();
      await ds2.close();

      const ds3 = new Datastore({
        driver: fileDriver({ filePath }),
      });
      const afterReopen = await ds3.getAll();
      assert.equal(afterReopen.length, 0, 'clear state must survive reopen');
      await ds3.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
