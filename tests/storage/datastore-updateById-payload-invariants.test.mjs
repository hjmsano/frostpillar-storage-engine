import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'string')
      throw new TypeError(`${fieldName} must be string.`);
    if (value.length === 0)
      throw new TypeError(`${fieldName} must not be empty.`);
    return value;
  },
  compare: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
});

describe('updateById merged payload invariants', () => {
  test('updateById rejects merged payload exceeding max keys per object (256)', async () => {
    const { Datastore, ValidationError } = await loadStorageModule();
    const datastore = new Datastore({ key: createStringKeyDefinition() });

    try {
      // Build payload with exactly 256 keys (the maximum allowed per object).
      const payload = Object.fromEntries(
        Array.from({ length: 256 }, (_, i) => [`k${i}`, i]),
      );

      await datastore.put({ key: 'x', payload });

      const records = await datastore.get('x');
      const id = records[0]._id;

      // Patching with a new key would bring the merged object to 257 keys,
      // which exceeds the max-256-keys-per-object constraint.
      await assert.rejects(
        () => datastore.updateById(id, { extraKey: 999 }),
        ValidationError,
      );

      // Verify the stored record is unchanged: still 256 keys, no extraKey.
      const stored = await datastore.getById(id);
      assert.equal(
        Object.keys(stored.payload).length,
        256,
        'payload must still have 256 keys after rejected update',
      );
      assert.equal(
        stored.payload.extraKey,
        undefined,
        'extraKey must not appear in the stored payload',
      );
    } finally {
      await datastore.close();
    }
  });

  test('updateById rejects merged payload exceeding max total bytes (1MB)', async () => {
    const { Datastore, ValidationError } = await loadStorageModule();
    const datastore = new Datastore({ key: createStringKeyDefinition() });

    try {
      // Build a payload with 15 keys, each containing a 65535-byte string.
      // 15 * 65535 = 982,725 bytes of string data, well under the 1,048,576 byte limit.
      const payload = Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`k${i}`, 'a'.repeat(65_535)]),
      );
      await datastore.put({ key: 'y', payload });

      const records = await datastore.get('y');
      const id = records[0]._id;

      // Patching adds a 16th large key: merged total ~982,725 + 65,535 + key bytes > 1,048,576.
      await assert.rejects(
        () => datastore.updateById(id, { extra: 'b'.repeat(65_535) }),
        ValidationError,
      );

      // Verify the stored record is unchanged.
      const stored = await datastore.getById(id);
      assert.equal(
        stored.payload.k0,
        payload.k0,
        'k0 field must be unchanged after rejected update',
      );
      assert.equal(
        stored.payload.extra,
        undefined,
        'extra key must not appear in the stored payload',
      );
    } finally {
      await datastore.close();
    }
  });

  test('updateById succeeds when merged payload is within all limits', async () => {
    const { Datastore } = await loadStorageModule();
    const datastore = new Datastore({ key: createStringKeyDefinition() });

    try {
      // Build payload with 200 keys (well within the 256 per-object limit).
      const payload = Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`k${i}`, i]),
      );

      await datastore.put({ key: 'z', payload });

      const records = await datastore.get('z');
      const id = records[0]._id;

      // Patch replaces an existing key — no new key is added.
      const result = await datastore.updateById(id, { k0: 42 });
      assert.equal(result, true, 'updateById must return true on success');

      const stored = await datastore.getById(id);
      assert.equal(stored.payload.k0, 42, 'k0 must reflect the patched value');
      assert.equal(
        Object.keys(stored.payload).length,
        200,
        'total key count must remain 200 after patch',
      );
    } finally {
      await datastore.close();
    }
  });
});
