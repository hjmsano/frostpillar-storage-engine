import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => {
  return {
    normalize: (value, fieldName) => {
      if (typeof value !== 'string') {
        throw new TypeError(`${fieldName} must be string.`);
      }
      if (value.length === 0) {
        throw new TypeError(`${fieldName} must not be empty.`);
      }
      return value;
    },
    compare: (left, right) => {
      return left.localeCompare(right);
    },
    serialize: (key) => {
      return key;
    },
    deserialize: (serialized) => {
      return serialized;
    },
  };
};

const computeRecordBytes = (key, payload) => {
  return new TextEncoder().encode(JSON.stringify([key, { payload }])).byteLength;
};

test('turnover capacity eviction with custom string keys evicts by btree key order (lowest key first)', async () => {
  const { Datastore } = await loadStorageModule();
  const payloadValue = 'x'.repeat(24);
  const firstPayload = { id: 'first', value: payloadValue };
  const secondPayload = { id: 'second', value: payloadValue };
  const thirdPayload = { id: 'third', value: payloadValue };
  const firstBytes = computeRecordBytes('z-key', firstPayload);
  const secondBytes = computeRecordBytes('a-key', secondPayload);
  const thirdBytes = computeRecordBytes('m-key', thirdPayload);
  const maxSizeBytes = Math.max(
    firstBytes + secondBytes,
    secondBytes + thirdBytes,
  );

  const datastore = new Datastore({
    key: createStringKeyDefinition(),
    capacity: {
      maxSize: maxSizeBytes,
      policy: 'turnover',
    },
  });

  // Insert in order: z-key (first), a-key (second), m-key (third)
  // Turnover evicts by btree key order (lowest key first), not insertion order.
  // When m-key is inserted and capacity is exceeded, 'a-key' (lowest key) is evicted.
  await datastore.put({
    key: 'z-key',
    payload: firstPayload,
  });
  await datastore.put({
    key: 'a-key',
    payload: secondPayload,
  });
  await datastore.put({
    key: 'm-key',
    payload: thirdPayload,
  });

  // 'a-key' is the lowest key — it gets evicted first by btree popFirst()
  const aKeyRange = await datastore.getRange('a-key', 'a-key');
  assert.equal(aKeyRange.length, 0, 'a-key (lowest key) should be evicted by turnover');

  // 'z-key' was inserted first but has a higher key — it survives
  const zKeyRange = await datastore.getRange('z-key', 'z-key');
  assert.equal(zKeyRange.length, 1);
  assert.equal(zKeyRange[0].payload.id, 'first');

  const mKeyRange = await datastore.getRange('m-key', 'm-key');
  assert.equal(mKeyRange.length, 1);
  assert.equal(mKeyRange[0].payload.id, 'third');

  await datastore.close();
});
