import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

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

// Size accounting helper:
// estimateRecordSizeBytes = utf8ByteLength(JSON.stringify([key, { payload }]))
// key 'a' + payload { v: 'x' } -> ["a",{"payload":{"v":"x"}}] = 27 bytes
// key 'b' + payload { v: 'b'.repeat(40) } = 66 bytes
// key 'c' + payload { v: 'c'.repeat(40) } = 66 bytes
// Total after a+b+c = 159 bytes, maxSize = 180
//
// Replace 'a' with { v: 'A'.repeat(80) }:
//   new size = 106 bytes
//   capacityDelta (old) = 106 - 27 = 79
//   turnover evicts from front (smallest key first): 'a' is evicted first!
//   after evicting 'a' (27): currentSize = 132, needed headroom = 79, 132+79=211 > 180
//   after evicting 'b' (66): currentSize = 66, needed headroom = 79, 66+79=145 <= 180 → done
//
// BUG: capacityDelta=79 but 'a' was evicted, so insert is fresh (not replace).
//   currentSizeBytes = 66 + 79 = 145  (undercount; actual = c:66 + a:106 = 172)
//
// FIX: after turnover, detect 'a' is gone → effectiveDelta = 106 (full size).
//   currentSizeBytes = 66 + 106 = 172  (accurate)

describe("replace+turnover: target key evicted during capacity enforcement", () => {
  test('target key evicted during turnover does not undercount currentSizeBytes', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 180, policy: 'turnover' },
    });

    try {
      // Insert a(27), b(66), c(66) → total 159 bytes, fits in maxSize=180
      await datastore.put({ key: 'a', payload: { v: 'x' } });
      await datastore.put({ key: 'b', payload: { v: 'b'.repeat(40) } });
      await datastore.put({ key: 'c', payload: { v: 'c'.repeat(40) } });

      assert.equal(await datastore.count(), 3, 'precondition: 3 records inserted');

      // Replace 'a' with large payload (106 bytes).
      // Turnover must evict 'a' (smallest key) and 'b' to make room.
      // The target key 'a' is itself evicted during enforcement.
      await datastore.put({ key: 'a', payload: { v: 'A'.repeat(80) } });

      // After the replace: 'a' should exist (re-inserted as new), 'b' should be gone
      assert.equal(await datastore.has('a'), true, "key 'a' must exist after replace");
      assert.equal(await datastore.has('b'), false, "key 'b' must have been evicted by turnover");
      assert.equal(await datastore.has('c'), true, "key 'c' must still exist");
      assert.equal(await datastore.count(), 2, "store must contain exactly a and c");

      // Verify correct data
      const aRecords = await datastore.get('a');
      assert.equal(aRecords.length, 1);
      assert.equal(aRecords[0].payload.v, 'A'.repeat(80));

      // Actual stored data: a(106) + c(66) = 172 bytes.
      // With the bug, currentSizeBytes = 145 (undercount by 27).
      // With the fix, currentSizeBytes = 172.
      //
      // Invariant: inserting a record that fits in the gap between undercounted
      // and accurate sizes should NOT push the store past maxSize without eviction.
      // We verify by attempting to insert a record that would fit
      // under the buggy count but not under the accurate count.
      //
      // key 'd' + payload { v: '' } = 26 bytes
      // With correct accounting (172 used), 172+26=198 > 180 → turnover must evict 'a'.
      // With buggy accounting (145 used), 145+26=171 <= 180 → no eviction needed, all survive.
      //
      // So: after inserting 'd', if 'a' is gone → correct accounting was used.
      // If both 'a' and 'c' still exist with 'd' present → bug: 172+26=198 > maxSize undetected.
      await datastore.put({ key: 'd', payload: { v: '' } });

      const hasA = await datastore.has('a');
      const hasC = await datastore.has('c');
      const hasD = await datastore.has('d');

      assert.equal(hasD, true, "key 'd' must be present after insert");

      // If both 'a' and 'c' survived alongside 'd', total bytes = 106+66+26 = 198 > maxSize(180).
      // That would mean the store exceeded capacity without eviction — a bug.
      if (hasA && hasC) {
        // Calculate actual bytes in store to confirm the invariant violation
        const count = await datastore.count();
        assert.fail(
          `capacity invariant violated: all 3 records (a+c+d) present with total ~198 bytes exceeds maxSize=180. count=${count}`,
        );
      }

      // Either 'a' or 'c' must have been evicted to make room for 'd'.
      assert.equal(
        hasA || hasC,
        true,
        "at least one of a/c must survive after inserting d (store is not empty)",
      );
    } finally {
      await datastore.close();
    }
  });

  test('replace+turnover: target key NOT evicted uses correct delta accounting', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({
      key: createStringKeyDefinition(),
      duplicateKeys: 'replace',
      capacity: { maxSize: 500, policy: 'turnover' },
    });

    try {
      // Insert a(27), b(66), z(66) → total 159 bytes, fits comfortably in maxSize=500
      await datastore.put({ key: 'a', payload: { v: 'x' } });
      await datastore.put({ key: 'b', payload: { v: 'b'.repeat(40) } });
      await datastore.put({ key: 'z', payload: { v: 'z'.repeat(40) } });

      assert.equal(await datastore.count(), 3, 'precondition: 3 records inserted');

      // Replace 'z' (last key, won't be evicted by turnover since 'a' comes first).
      // Delta = (new z size) - 51. With maxSize=500 this comfortably fits without eviction.
      await datastore.put({ key: 'z', payload: { v: 'Z'.repeat(80) } });

      // All keys must survive — no eviction needed
      assert.equal(await datastore.has('a'), true, "key 'a' must not be evicted");
      assert.equal(await datastore.has('b'), true, "key 'b' must not be evicted");
      assert.equal(await datastore.has('z'), true, "key 'z' must exist with updated payload");
      assert.equal(await datastore.count(), 3, "all 3 records must be present");

      // Verify correct data for replaced key
      const zRecords = await datastore.get('z');
      assert.equal(zRecords.length, 1);
      assert.equal(zRecords[0].payload.v, 'Z'.repeat(80));

      // Delta accounting: new z is 106 bytes, old z was 66 bytes, delta=40.
      // Total after replace: 27 + 66 + 106 = 199 bytes.
      // Insert another record that would fail if delta accounting overcounted.
      // key 'e' + payload { v: 'e'.repeat(200) } = 226 bytes
      // 199 + 226 = 425 <= 500 → must succeed
      await datastore.put({ key: 'e', payload: { v: 'e'.repeat(200) } });

      assert.equal(await datastore.has('e'), true, "key 'e' must be inserted successfully");
      assert.equal(await datastore.count(), 4, "all 4 records must be present");
    } finally {
      await datastore.close();
    }
  });
});
