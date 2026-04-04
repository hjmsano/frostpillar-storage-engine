import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

const loadAdapter = async () => {
  const mod = await importDistModule('storage/btree/recordKeyIndexBTree.js');
  return mod;
};

const numericConfig = {
  compareKeys: (left, right) => left - right,
};

const stringConfig = {
  compareKeys: (left, right) => left.localeCompare(right),
};

// --- put ---

test('put returns EntryId (number)', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id = tree.put(1, 'hello');
  assert.equal(typeof id, 'number');
});

test('put returns distinct EntryIds for subsequent puts', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id1 = tree.put(1, 'a');
  const id2 = tree.put(2, 'b');
  assert.notEqual(id1, id2);
});

// --- peekById ---

test('peekById returns correct entry', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id = tree.put(42, 'value');
  const entry = tree.peekById(id);
  assert.ok(entry !== null);
  assert.equal(entry.key, 42);
  assert.equal(entry.value, 'value');
  assert.equal(entry.entryId, id);
});

test('peekById returns null for unknown entryId', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.peekById(999), null);
});

// --- updateById ---

test('updateById updates value and returns updated entry', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id = tree.put(1, 'old');
  const updated = tree.updateById(id, 'new');
  assert.ok(updated !== null);
  assert.equal(updated.value, 'new');
  const current = tree.peekById(id);
  assert.ok(current !== null);
  assert.equal(current.value, 'new');
});

test('updateById returns null for unknown entryId', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.updateById(999, 'x'), null);
});

// --- removeById ---

test('removeById removes entry and returns it', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id = tree.put(10, 'data');
  const removed = tree.removeById(id);
  assert.ok(removed !== null);
  assert.equal(removed.key, 10);
  assert.equal(removed.value, 'data');
  assert.equal(tree.size(), 0);
  assert.equal(tree.peekById(id), null);
});

test('removeById returns null for unknown entryId', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.removeById(999), null);
});

// --- rangeQuery ---

test('rangeQuery returns entries in range', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  tree.put(2, 'b');
  tree.put(3, 'c');
  tree.put(4, 'd');
  const results = tree.rangeQuery(2, 3);
  assert.equal(results.length, 2);
  assert.equal(results[0].key, 2);
  assert.equal(results[1].key, 3);
});

test('rangeQuery with same start and end returns exact key entries', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree({ ...numericConfig, duplicateKeys: 'allow' });
  tree.put(5, 'first');
  tree.put(5, 'second');
  tree.put(6, 'other');
  const results = tree.rangeQuery(5, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].key, 5);
  assert.equal(results[1].key, 5);
});

test('rangeQuery returns empty array for out-of-range', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  const results = tree.rangeQuery(10, 20);
  assert.equal(results.length, 0);
});

// --- deleteRange ---

test('deleteRange removes entries and returns count', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  tree.put(2, 'b');
  tree.put(3, 'c');
  tree.put(4, 'd');
  const count = tree.deleteRange(2, 3);
  assert.equal(count, 2);
  assert.equal(tree.size(), 2);
  assert.equal(tree.rangeQuery(2, 3).length, 0);
});

test('deleteRange returns 0 when range is empty', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  const count = tree.deleteRange(10, 20);
  assert.equal(count, 0);
  assert.equal(tree.size(), 1);
});

// --- snapshot ---

test('snapshot returns all entries', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(3, 'c');
  tree.put(1, 'a');
  tree.put(2, 'b');
  const snap = tree.snapshot();
  assert.equal(snap.length, 3);
  assert.deepEqual(snap.map((e) => e.key), [1, 2, 3]);
});

test('snapshot returns empty array for empty tree', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.deepEqual(tree.snapshot(), []);
});

// --- popFirst ---

test('popFirst returns and removes oldest (smallest key) entry', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(3, 'c');
  tree.put(1, 'a');
  tree.put(2, 'b');
  const first = tree.popFirst();
  assert.ok(first !== null);
  assert.equal(first.key, 1);
  assert.equal(tree.size(), 2);
});

test('popFirst returns null on empty tree', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.popFirst(), null);
});

// --- size ---

test('size returns entry count', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.size(), 0);
  tree.put(1, 'a');
  assert.equal(tree.size(), 1);
  tree.put(2, 'b');
  assert.equal(tree.size(), 2);
  tree.removeById(tree.put(3, 'c') - 1 + 1); // keep same count logic
});

test('size decrements after removeById', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id = tree.put(1, 'a');
  tree.put(2, 'b');
  tree.removeById(id);
  assert.equal(tree.size(), 1);
});

// --- hasKey ---

test('hasKey returns true when key exists', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(7, 'v');
  assert.equal(tree.hasKey(7), true);
});

test('hasKey returns false when key does not exist', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.hasKey(7), false);
});

test('hasKey returns false after all entries with key are removed', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const id = tree.put(7, 'v');
  tree.removeById(id);
  assert.equal(tree.hasKey(7), false);
});

// --- keys ---

test('keys returns iterator of keys', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(3, 'c');
  tree.put(1, 'a');
  tree.put(2, 'b');
  const keysList = [...tree.keys()];
  assert.deepEqual(keysList, [1, 2, 3]);
});

// --- toJSON / fromJSON ---

test('toJSON returns BTreeJSON object', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  const json = tree.toJSON();
  assert.equal(typeof json, 'object');
  assert.ok('version' in json);
  assert.ok('entries' in json);
});

test('fromJSON roundtrip preserves entries', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  tree.put(2, 'b');
  tree.put(3, 'c');
  const json = tree.toJSON();
  const restored = RecordKeyIndexBTree.fromJSON(json, numericConfig);
  const snap = restored.snapshot();
  assert.equal(snap.length, 3);
  assert.deepEqual(snap.map((e) => e.key), [1, 2, 3]);
  assert.deepEqual(snap.map((e) => e.value), ['a', 'b', 'c']);
});

test('fromJSON restores adapter with working operations', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(10, 'ten');
  tree.put(20, 'twenty');
  const json = tree.toJSON();
  const restored = RecordKeyIndexBTree.fromJSON(json, numericConfig);
  assert.equal(restored.size(), 2);
  assert.equal(restored.hasKey(10), true);
  assert.equal(restored.hasKey(20), true);
  const id = restored.put(15, 'fifteen');
  assert.equal(restored.size(), 3);
  const range = restored.rangeQuery(10, 15);
  assert.equal(range.length, 2);
  assert.equal(restored.removeById(id)?.value, 'fifteen');
  assert.equal(restored.size(), 2);
});

// --- clear ---

test('clear empties the tree', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  tree.put(2, 'b');
  tree.clear();
  assert.equal(tree.size(), 0);
  assert.deepEqual(tree.snapshot(), []);
});

// --- Comparator clamping (OPT-2: hot-path uses clampComparatorResult, no validation) ---

test('non-finite comparator result (Infinity) is clamped — put does not throw', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree({
    compareKeys: (left, right) => {
      if (left === right) return 0;
      return Number.POSITIVE_INFINITY;
    },
  });
  tree.put(1, 'a');
  assert.doesNotThrow(() => tree.put(2, 'b'));
  assert.equal(tree.size(), 2);
});

test('non-integer comparator result (float) is clamped — put does not throw', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree({
    compareKeys: (left, right) => {
      if (left === right) return 0;
      return 0.5;
    },
  });
  tree.put(1, 'a');
  assert.doesNotThrow(() => tree.put(2, 'b'));
  assert.equal(tree.size(), 2);
});

test('NaN comparator result is rejected by BTree wrapped comparator', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const { IndexCorruptionError } = await importDistModule('errors/index.js');
  const tree = new RecordKeyIndexBTree({
    compareKeys: (left, right) => {
      if (left === right) return 0;
      return Number.NaN;
    },
  });
  tree.put(1, 'a');
  // NaN is detected by buildWrappedComparator and throws IndexCorruptionError
  assert.throws(() => tree.put(2, 'b'), IndexCorruptionError);
});

// --- DuplicateKeyPolicy ---

test("duplicateKeys 'reject' mode: second put with same key throws BTreeValidationError", async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const { BTreeValidationError } = await import('@frostpillar/frostpillar-btree');
  const tree = new RecordKeyIndexBTree({
    ...numericConfig,
    duplicateKeys: 'reject',
  });
  tree.put(1, 'a');
  assert.throws(
    () => tree.put(1, 'b'),
    BTreeValidationError,
  );
});

test("duplicateKeys 'replace' mode: second put overwrites and size stays 1", async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree({
    ...numericConfig,
    duplicateKeys: 'replace',
  });
  tree.put(1, 'original');
  tree.put(1, 'replacement');
  assert.equal(tree.size(), 1);
  const snap = tree.snapshot();
  assert.equal(snap[0].value, 'replacement');
});

test("duplicateKeys 'allow' mode: multiple entries per key", async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree({
    ...numericConfig,
    duplicateKeys: 'allow',
  });
  tree.put(1, 'first');
  tree.put(1, 'second');
  tree.put(1, 'third');
  assert.equal(tree.size(), 3);
  const range = tree.rangeQuery(1, 1);
  assert.equal(range.length, 3);
});

test("default duplicateKeys is 'allow'", async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(5, 'a');
  tree.put(5, 'b');
  assert.equal(tree.size(), 2);
});

// --- putMany ---

test('putMany inserts multiple pre-sorted entries and returns EntryId array', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const ids = tree.putMany([
    { key: 1, value: 'a' },
    { key: 2, value: 'b' },
    { key: 3, value: 'c' },
  ]);
  assert.equal(ids.length, 3);
  assert.equal(tree.size(), 3);
  const snap = tree.snapshot();
  assert.deepEqual(snap.map((e) => e.key), [1, 2, 3]);
  assert.deepEqual(snap.map((e) => e.value), ['a', 'b', 'c']);
});

test('putMany returns empty array for empty input', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const ids = tree.putMany([]);
  assert.deepEqual(ids, []);
  assert.equal(tree.size(), 0);
});

test('putMany returns distinct EntryIds', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const ids = tree.putMany([
    { key: 10, value: 'x' },
    { key: 20, value: 'y' },
  ]);
  assert.notEqual(ids[0], ids[1]);
});

test('putMany entries are retrievable via peekById', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  const ids = tree.putMany([
    { key: 5, value: 'five' },
    { key: 15, value: 'fifteen' },
  ]);
  const e0 = tree.peekById(ids[0]);
  assert.ok(e0 !== null);
  assert.equal(e0.key, 5);
  assert.equal(e0.value, 'five');
  const e1 = tree.peekById(ids[1]);
  assert.ok(e1 !== null);
  assert.equal(e1.key, 15);
  assert.equal(e1.value, 'fifteen');
});

test('putMany with unsorted entries throws BTreeValidationError', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const { BTreeValidationError } = await import('@frostpillar/frostpillar-btree');
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.throws(
    () => tree.putMany([
      { key: 3, value: 'c' },
      { key: 1, value: 'a' },
    ]),
    BTreeValidationError,
  );
});

test('putMany with string keys inserts in sorted order', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(stringConfig);
  const ids = tree.putMany([
    { key: 'apple', value: 1 },
    { key: 'banana', value: 2 },
    { key: 'cherry', value: 3 },
  ]);
  assert.equal(ids.length, 3);
  assert.equal(tree.size(), 3);
  const snap = tree.snapshot();
  assert.deepEqual(snap.map((e) => e.key), ['apple', 'banana', 'cherry']);
});

// --- peekLast ---

test('peekLast returns null on empty tree', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  assert.equal(tree.peekLast(), null);
});

test('peekLast returns the rightmost (largest key) entry', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(1, 'a');
  tree.put(3, 'c');
  tree.put(2, 'b');
  const last = tree.peekLast();
  assert.ok(last !== null);
  assert.equal(last.key, 3);
  assert.equal(last.value, 'c');
});

test('peekLast does not remove the entry', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(10, 'x');
  tree.put(20, 'y');
  const last = tree.peekLast();
  assert.ok(last !== null);
  assert.equal(last.key, 20);
  assert.equal(tree.size(), 2);
});

test('peekLast with single entry returns that entry', async () => {
  const { RecordKeyIndexBTree } = await loadAdapter();
  const tree = new RecordKeyIndexBTree(numericConfig);
  tree.put(42, 'only');
  const last = tree.peekLast();
  assert.ok(last !== null);
  assert.equal(last.key, 42);
  assert.equal(last.value, 'only');
});
