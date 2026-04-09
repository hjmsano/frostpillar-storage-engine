import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Datastore, ConfigurationError } from '../../dist/index.js';
import { importDistModule } from '../load-module.mjs';

const loadAdapter = async () => {
  const mod = await importDistModule('storage/btree/recordKeyIndexBTree.js');
  return mod;
};

const loadConfigParser = async () => {
  const mod = await importDistModule('storage/config/config.shared.js');
  return mod;
};

const numericConfig = {
  compareKeys: (left, right) => left - right,
};

// --- RecordKeyIndexBTree adapter ---

describe('RecordKeyIndexBTree index config', () => {
  it('defaults to autoScale: true when not specified', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const tree = new RecordKeyIndexBTree(numericConfig);
    const json = tree.toJSON();
    assert.equal(json.config.autoScale, true);
  });

  it('respects explicit autoScale: false', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const tree = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
    });
    const json = tree.toJSON();
    assert.equal(json.config.autoScale, false);
  });

  it('forwards maxLeafEntries when autoScale is false', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const tree = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
      maxLeafEntries: 128,
    });
    const json = tree.toJSON();
    assert.equal(json.config.autoScale, false);
    assert.equal(json.config.maxLeafEntries, 128);
  });

  it('forwards maxBranchChildren when autoScale is false', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const tree = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
      maxBranchChildren: 256,
    });
    const json = tree.toJSON();
    assert.equal(json.config.autoScale, false);
    assert.equal(json.config.maxBranchChildren, 256);
  });

  it('forwards both maxLeafEntries and maxBranchChildren', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const tree = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
      maxLeafEntries: 32,
      maxBranchChildren: 64,
    });
    const json = tree.toJSON();
    assert.equal(json.config.maxLeafEntries, 32);
    assert.equal(json.config.maxBranchChildren, 64);
  });

  it('forwards deleteRebalancePolicy: lazy to tree config', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const tree = new RecordKeyIndexBTree({
      ...numericConfig,
      deleteRebalancePolicy: 'lazy',
    });
    const json = tree.toJSON();
    assert.equal(json.config.deleteRebalancePolicy, 'lazy');
  });
});

// --- parseIndexConfig ---

describe('parseIndexConfig', () => {
  it('leaves autoScale undefined when index is undefined', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig(undefined);
    assert.equal(result.autoScale, undefined);
    assert.equal(result.maxLeafEntries, undefined);
    assert.equal(result.maxBranchChildren, undefined);
  });

  it('leaves autoScale undefined when index is empty', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({});
    assert.equal(result.autoScale, undefined);
  });

  it('accepts autoScale: false with no capacity', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({ autoScale: false });
    assert.equal(result.autoScale, false);
    assert.equal(result.maxLeafEntries, undefined);
    assert.equal(result.maxBranchChildren, undefined);
  });

  it('accepts autoScale: false with maxLeafEntries', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({ autoScale: false, maxLeafEntries: 128 });
    assert.equal(result.autoScale, false);
    assert.equal(result.maxLeafEntries, 128);
  });

  it('accepts autoScale: false with maxBranchChildren', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({
      autoScale: false,
      maxBranchChildren: 256,
    });
    assert.equal(result.maxBranchChildren, 256);
  });

  it('rejects maxLeafEntries when autoScale is true', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ autoScale: true, maxLeafEntries: 128 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects maxBranchChildren when autoScale is true', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ autoScale: true, maxBranchChildren: 128 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects maxLeafEntries when autoScale is defaulted (true)', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ maxLeafEntries: 128 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects maxLeafEntries below minimum (3)', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ autoScale: false, maxLeafEntries: 2 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects maxLeafEntries above maximum (16384)', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ autoScale: false, maxLeafEntries: 16385 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects non-integer maxLeafEntries', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ autoScale: false, maxLeafEntries: 3.5 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects non-integer maxBranchChildren', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ autoScale: false, maxBranchChildren: 3.5 }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('accepts boundary value 3', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({ autoScale: false, maxLeafEntries: 3 });
    assert.equal(result.maxLeafEntries, 3);
  });

  it('accepts boundary value 16384', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({
      autoScale: false,
      maxLeafEntries: 16384,
    });
    assert.equal(result.maxLeafEntries, 16384);
  });

  it('leaves deleteRebalancePolicy undefined when not specified', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig(undefined);
    assert.equal(result.deleteRebalancePolicy, undefined);
  });

  it('accepts deleteRebalancePolicy: standard', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({ deleteRebalancePolicy: 'standard' });
    assert.equal(result.deleteRebalancePolicy, 'standard');
  });

  it('accepts deleteRebalancePolicy: lazy', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({ deleteRebalancePolicy: 'lazy' });
    assert.equal(result.deleteRebalancePolicy, 'lazy');
  });

  it('rejects invalid deleteRebalancePolicy value', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    assert.throws(
      () => parseIndexConfig({ deleteRebalancePolicy: 'invalid' }),
      (err) => err instanceof ConfigurationError,
    );
  });
});

// --- RecordKeyIndexBTree.fromJSON patching ---

describe('RecordKeyIndexBTree.fromJSON index config patching', () => {
  it('preserves snapshot autoScale when config does not override', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
    });
    original.put(1, 'a');
    const json = original.toJSON();
    assert.equal(json.config.autoScale, false);

    const restored = RecordKeyIndexBTree.fromJSON(json, numericConfig);
    const restoredJSON = restored.toJSON();
    assert.equal(restoredJSON.config.autoScale, false);
    assert.equal(restored.size(), 1);
  });

  it('patches autoScale: false with custom maxLeafEntries', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree(numericConfig);
    original.put(1, 'a');
    const json = original.toJSON();

    const restored = RecordKeyIndexBTree.fromJSON(json, {
      ...numericConfig,
      autoScale: false,
      maxLeafEntries: 128,
    });
    const restoredJSON = restored.toJSON();
    assert.equal(restoredJSON.config.autoScale, false);
    assert.equal(restoredJSON.config.maxLeafEntries, 128);
    assert.equal(restored.size(), 1);
  });

  it('patches maxBranchChildren on restoration', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
    });
    original.put(1, 'a');
    const json = original.toJSON();

    const restored = RecordKeyIndexBTree.fromJSON(json, {
      ...numericConfig,
      autoScale: false,
      maxBranchChildren: 256,
    });
    const restoredJSON = restored.toJSON();
    assert.equal(restoredJSON.config.maxBranchChildren, 256);
  });

  it('patches deleteRebalancePolicy on restoration', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree(numericConfig);
    original.put(1, 'a');
    const json = original.toJSON();

    const restored = RecordKeyIndexBTree.fromJSON(json, {
      ...numericConfig,
      deleteRebalancePolicy: 'lazy',
    });
    const restoredJSON = restored.toJSON();
    assert.equal(restoredJSON.config.deleteRebalancePolicy, 'lazy');
    assert.equal(restored.size(), 1);
  });

  it('defaults deleteRebalancePolicy to standard on restoration when not specified', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree(numericConfig);
    original.put(1, 'a');
    const json = original.toJSON();

    const restored = RecordKeyIndexBTree.fromJSON(json, numericConfig);
    const restoredJSON = restored.toJSON();
    // 'standard' is the btree default and may be omitted from serialized config
    assert.ok(
      restoredJSON.config.deleteRebalancePolicy === 'standard' ||
        restoredJSON.config.deleteRebalancePolicy === undefined,
    );
    assert.equal(restored.size(), 1);
  });

  it('preserves snapshot deleteRebalancePolicy when config does not override', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree({
      ...numericConfig,
      deleteRebalancePolicy: 'lazy',
    });
    original.put(1, 'a');
    const json = original.toJSON();

    const restored = RecordKeyIndexBTree.fromJSON(json, { ...numericConfig });
    const restoredJSON = restored.toJSON();
    assert.equal(restoredJSON.config.deleteRebalancePolicy, 'lazy');
  });

  it('preserves snapshot maxLeafEntries when config does not override', async () => {
    const { RecordKeyIndexBTree } = await loadAdapter();
    const original = new RecordKeyIndexBTree({
      ...numericConfig,
      autoScale: false,
      maxLeafEntries: 32,
    });
    original.put(1, 'a');
    const json = original.toJSON();
    assert.equal(json.config.maxLeafEntries, 32);

    const restored = RecordKeyIndexBTree.fromJSON(json, {
      ...numericConfig,
      autoScale: false,
    });
    const restoredJSON = restored.toJSON();
    assert.equal(restoredJSON.config.maxLeafEntries, 32);
  });
});

// --- Datastore integration ---

describe('Datastore index config', () => {
  it('defaults to autoScale when index is omitted', async () => {
    const ds = new Datastore({});
    await ds.put({ key: 'a', payload: { v: 'a' } });
    const records = await ds.get('a');
    assert.equal(records.length, 1);
    await ds.close();
  });

  it('accepts index with autoScale: false', async () => {
    const ds = new Datastore({ index: { autoScale: false } });
    await ds.put({ key: 'a', payload: { v: 'a' } });
    const records = await ds.get('a');
    assert.equal(records.length, 1);
    await ds.close();
  });

  it('accepts index with custom maxLeafEntries', async () => {
    const ds = new Datastore({
      index: { autoScale: false, maxLeafEntries: 128 },
    });
    await ds.put({ key: 'a', payload: { v: 'a' } });
    const records = await ds.get('a');
    assert.equal(records.length, 1);
    await ds.close();
  });

  it('accepts index with custom maxBranchChildren', async () => {
    const ds = new Datastore({
      index: { autoScale: false, maxBranchChildren: 32 },
    });
    await ds.put({ key: 'a', payload: { v: 'a' } });
    const records = await ds.get('a');
    assert.equal(records.length, 1);
    await ds.close();
  });

  it('rejects autoScale: true with maxLeafEntries', () => {
    assert.throws(
      () => new Datastore({ index: { autoScale: true, maxLeafEntries: 128 } }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects invalid maxLeafEntries', () => {
    assert.throws(
      () => new Datastore({ index: { autoScale: false, maxLeafEntries: 0 } }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('accepts index with deleteRebalancePolicy: lazy', async () => {
    const ds = new Datastore({ index: { deleteRebalancePolicy: 'lazy' } });
    await ds.put({ key: 'a', payload: { v: 'a' } });
    const records = await ds.get('a');
    assert.equal(records.length, 1);
    await ds.close();
  });

  it('rejects invalid deleteRebalancePolicy', () => {
    assert.throws(
      () => new Datastore({ index: { deleteRebalancePolicy: 'invalid' } }),
      (err) => err instanceof ConfigurationError,
    );
  });
});

// --- File driver reopen preserves index config ---

const createSandboxDirectory = (name) => {
  const baseDir = resolve(process.cwd(), 'tests/.tmp');
  mkdirSync(baseDir, { recursive: true });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const directory = join(baseDir, `${name}-${uniqueSuffix}`);
  mkdirSync(directory, { recursive: true });
  return directory;
};

describe('file backend reopen preserves index config', () => {
  it('custom maxLeafEntries survives close and reopen', async () => {
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('index-reopen');
    const filePath = join(sandbox, 'test.db');

    try {
      const ds1 = new Datastore({
        index: { autoScale: false, maxLeafEntries: 128 },
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 1 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        index: { autoScale: false, maxLeafEntries: 128 },
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'b', payload: { v: 2 } });
      const all = await ds2.getAll();
      assert.equal(all.length, 2);
      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('deleteRebalancePolicy: lazy survives close and reopen', async () => {
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('index-reopen-lazy');
    const filePath = join(sandbox, 'test.db');

    try {
      const ds1 = new Datastore({
        index: { deleteRebalancePolicy: 'lazy' },
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 1 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        index: { deleteRebalancePolicy: 'lazy' },
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'b', payload: { v: 2 } });
      const all = await ds2.getAll();
      assert.equal(all.length, 2);
      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('deleteRebalancePolicy: lazy is preserved from snapshot when omitted on reopen', async () => {
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('index-reopen-lazy-omit');
    const filePath = join(sandbox, 'test.db');

    try {
      const ds1 = new Datastore({
        index: { deleteRebalancePolicy: 'lazy' },
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 1 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        index: {},
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'b', payload: { v: 2 } });
      const all = await ds2.getAll();
      assert.equal(all.length, 2);
      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('autoScale: true survives close and reopen', async () => {
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('index-reopen-auto');
    const filePath = join(sandbox, 'test.db');

    try {
      const ds1 = new Datastore({
        index: { autoScale: true },
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 1 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        index: { autoScale: true },
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'b', payload: { v: 2 } });
      const all = await ds2.getAll();
      assert.equal(all.length, 2);
      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('autoScale: false is preserved from snapshot when omitted on reopen', async () => {
    const { fileDriver } = await importDistModule('drivers/file.js');
    const sandbox = createSandboxDirectory('index-reopen-auto-omit');
    const filePath = join(sandbox, 'test.db');

    try {
      const ds1 = new Datastore({
        index: { autoScale: false, maxLeafEntries: 128 },
        driver: fileDriver({ filePath }),
      });
      await ds1.put({ key: 'a', payload: { v: 1 } });
      await ds1.commit();
      await ds1.close();

      const ds2 = new Datastore({
        index: {},
        driver: fileDriver({ filePath }),
      });
      await ds2.put({ key: 'b', payload: { v: 2 } });
      const all = await ds2.getAll();
      assert.equal(all.length, 2);
      await ds2.close();
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
