import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    const tree = new RecordKeyIndexBTree({ ...numericConfig, autoScale: false });
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
});

// --- parseIndexConfig ---

describe('parseIndexConfig', () => {
  it('defaults to autoScale: true when index is undefined', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig(undefined);
    assert.equal(result.autoScale, true);
    assert.equal(result.maxLeafEntries, undefined);
    assert.equal(result.maxBranchChildren, undefined);
  });

  it('defaults to autoScale: true when index is empty', async () => {
    const { parseIndexConfig } = await loadConfigParser();
    const result = parseIndexConfig({});
    assert.equal(result.autoScale, true);
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
    const result = parseIndexConfig({ autoScale: false, maxBranchChildren: 256 });
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
    const result = parseIndexConfig({ autoScale: false, maxLeafEntries: 16384 });
    assert.equal(result.maxLeafEntries, 16384);
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
});
