import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

const loadEncoding = async () => {
  return await importDistModule('storage/backend/encoding.js');
};

const loadBTreeAdapter = async () => {
  return await importDistModule('storage/btree/recordKeyIndexBTree.js');
};

const numericConfig = {
  compareKeys: (left, right) => left - right,
};

const numericAllowDuplicatesConfig = {
  compareKeys: (left, right) => left - right,
  duplicateKeys: 'allow',
};

// ---------------------------------------------------------------------------
// P1-B: computeUtf8ByteLength correctness
// ---------------------------------------------------------------------------

test('computeUtf8ByteLength: ASCII-only string returns correct byte count', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  assert.equal(computeUtf8ByteLength('hello'), 5);
});

test('computeUtf8ByteLength: empty string returns 0', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  assert.equal(computeUtf8ByteLength(''), 0);
});

test('computeUtf8ByteLength: 2-byte character (\\u00e9, é) returns 2', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  assert.equal(computeUtf8ByteLength('\u00e9'), 2);
});

test('computeUtf8ByteLength: 3-byte character (\\u4e16, 世) returns 3', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  assert.equal(computeUtf8ByteLength('\u4e16'), 3);
});

test('computeUtf8ByteLength: 4-byte surrogate pair (\\uD83D\\uDE00, 😀) returns 4', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  assert.equal(computeUtf8ByteLength('\uD83D\uDE00'), 4);
});

test('computeUtf8ByteLength: mixed string matches TextEncoder', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const mixed = 'hello 世界 café 😀🎉';
  assert.equal(computeUtf8ByteLength(mixed), encoder.encode(mixed).byteLength);
});

test('computeUtf8ByteLength: JSON.stringify output matches TextEncoder for representative records', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const records = [
    ['simpleKey', { payload: { name: 'test', value: 42 } }],
    ['日本語キー', { payload: { description: '説明文', count: 1 } }],
    ['emoji🔥', { payload: { icon: '🎉', nested: { deep: 'value' } } }],
  ];
  for (const record of records) {
    const json = JSON.stringify(record);
    assert.equal(
      computeUtf8ByteLength(json),
      encoder.encode(json).byteLength,
      `Mismatch for record: ${json}`,
    );
  }
});

test('computeUtf8ByteLength: lone high surrogate matches TextEncoder (3 bytes)', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const loneHigh = '\uD800';
  assert.equal(
    computeUtf8ByteLength(loneHigh),
    encoder.encode(loneHigh).byteLength,
  );
});

test('computeUtf8ByteLength: lone low surrogate matches TextEncoder (3 bytes)', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const loneLow = '\uDEAD';
  assert.equal(
    computeUtf8ByteLength(loneLow),
    encoder.encode(loneLow).byteLength,
  );
});

test('computeUtf8ByteLength: high surrogate followed by non-surrogate matches TextEncoder', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const broken = '\uD800A';
  assert.equal(
    computeUtf8ByteLength(broken),
    encoder.encode(broken).byteLength,
  );
});

// ---------------------------------------------------------------------------
// Cross-validation: estimateRecordSizeBytes identical before/after
// ---------------------------------------------------------------------------

test('estimateRecordSizeBytes returns identical values with computeUtf8ByteLength', async () => {
  const { estimateRecordSizeBytes } = await loadEncoding();
  const encoder = new TextEncoder();
  const testCases = [
    { key: 'simple', payload: { name: 'test' } },
    { key: '日本語', payload: { value: 'テスト' } },
    { key: 'emoji🔑', payload: { icon: '😀', nested: { a: 1 } } },
  ];
  for (const { key, payload } of testCases) {
    const expected = encoder.encode(
      JSON.stringify([key, { payload }]),
    ).byteLength;
    assert.equal(
      estimateRecordSizeBytes(key, payload),
      expected,
      `Mismatch for key="${key}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// P1-A: findFirst on RecordKeyIndexBTree
// ---------------------------------------------------------------------------

test('findFirst returns entry when key exists', async () => {
  const { RecordKeyIndexBTree } = await loadBTreeAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(10, { sizeBytes: 100 });
  const result = tree.findFirst(10);
  assert.ok(result !== null);
  assert.equal(result.key, 10);
  assert.deepEqual(result.value, { sizeBytes: 100 });
});

test('findFirst returns null when key does not exist', async () => {
  const { RecordKeyIndexBTree } = await loadBTreeAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(10, { sizeBytes: 100 });
  const result = tree.findFirst(99);
  assert.equal(result, null);
});

test('findFirst returns first match when duplicates exist (allow policy)', async () => {
  const { RecordKeyIndexBTree } = await loadBTreeAdapter();
  const tree = new RecordKeyIndexBTree(numericAllowDuplicatesConfig);
  tree.put(5, { sizeBytes: 10 });
  tree.put(5, { sizeBytes: 20 });
  tree.put(5, { sizeBytes: 30 });
  const result = tree.findFirst(5);
  assert.ok(result !== null);
  assert.equal(result.key, 5);
  // Should return the first inserted entry
  assert.equal(result.value.sizeBytes, 10);
});

test('findFirst returns null on empty tree', async () => {
  const { RecordKeyIndexBTree } = await loadBTreeAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const result = tree.findFirst(1);
  assert.equal(result, null);
});
