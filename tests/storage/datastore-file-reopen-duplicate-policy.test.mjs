import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

describe('file backend reopen preserves duplicateKeys policy for empty DB', () => {
  test("reopen with duplicateKeys: 'replace' preserves policy for empty DB", async () => {
    const { Datastore } = await loadStorageModule();
    const { fileDriver } = await importDistModule('drivers/file.js');

    const sandbox = createSandboxDirectory('reopen-replace');
    const filePath = join(sandbox, 'test.db');
    try {
      const ds1 = new Datastore({
        key: createStringKeyDefinition(),
        duplicateKeys: 'replace',
        driver: fileDriver({ filePath }),
      });
      await ds1.close();

      const ds2 = new Datastore({
        key: createStringKeyDefinition(),
        duplicateKeys: 'replace',
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'x', payload: { v: 1 } });
      await ds2.put({ key: 'x', payload: { v: 2 } });

      const count = await ds2.count();
      assert.equal(count, 1, "replace policy must be preserved after reopen: count must be 1");

      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("reopen with duplicateKeys: 'reject' preserves policy for empty DB", async () => {
    const { Datastore } = await loadStorageModule();
    const { fileDriver } = await importDistModule('drivers/file.js');

    const sandbox = createSandboxDirectory('reopen-reject');
    const filePath = join(sandbox, 'test.db');
    try {
      const ds1 = new Datastore({
        key: createStringKeyDefinition(),
        duplicateKeys: 'reject',
        driver: fileDriver({ filePath }),
      });
      await ds1.close();

      const ds2 = new Datastore({
        key: createStringKeyDefinition(),
        duplicateKeys: 'reject',
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'x', payload: { v: 1 } });

      await assert.rejects(
        () => ds2.put({ key: 'x', payload: { v: 2 } }),
        (error) => error instanceof Error && error.name === 'ValidationError',
        "reject policy must be preserved after reopen: second put must throw ValidationError",
      );

      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("reopen with duplicateKeys: 'replace' preserves policy for non-empty DB", async () => {
    const { Datastore } = await loadStorageModule();
    const { fileDriver } = await importDistModule('drivers/file.js');

    const sandbox = createSandboxDirectory('reopen-replace-nonempty');
    const filePath = join(sandbox, 'test.db');
    try {
      const ds1 = new Datastore({
        key: createStringKeyDefinition(),
        duplicateKeys: 'replace',
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 1 } });
      await ds1.put({ key: 'b', payload: { v: 2 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        key: createStringKeyDefinition(),
        duplicateKeys: 'replace',
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'a', payload: { v: 99 } });

      const count = await ds2.count();
      assert.equal(count, 2, "replace must apply: 'a' replaced, 'b' kept → count 2");

      const records = await ds2.get('a');
      assert.equal(records[0].payload.v, 99, "'a' must reflect replaced value");

      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
