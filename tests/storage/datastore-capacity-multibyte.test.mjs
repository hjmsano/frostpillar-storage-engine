import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadStorageModule, importDistModule } from '../load-module.mjs';

describe('datastore capacity multibyte', () => {
  test('strict capacity rejects multibyte payload that exceeds byte limit', async () => {
    const { Datastore } = await loadStorageModule();

    const ds = new Datastore({
      key: {
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
      },
      capacity: { maxSize: 60, policy: 'strict' },
    });

    // estimateRecordSizeBytes('k', { v: 'あ'.repeat(15) })
    // = utf8ByteLength(JSON.stringify(['k', { payload: { v: 'あ'.repeat(15) } }]))
    // = 71 UTF-8 bytes >> maxSize 60 — must reject
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { v: 'あ'.repeat(15) } }),
      (err) => {
        assert.ok(
          err.name === 'QuotaExceededError' ||
            err.constructor.name === 'QuotaExceededError',
          `expected QuotaExceededError, got ${err.constructor.name}`,
        );
        return true;
      },
    );
  });

  test('capacity estimation uses UTF-8 byte length, not string length', async () => {
    const { estimateRecordSizeBytes } = await importDistModule(
      'storage/backend/encoding.js',
    );

    // JSON.stringify(['key', { payload: { v: 'あ' } }]) includes structural overhead
    // = '["key",{"payload":{"v":"あ"}}]' = 29 chars but 31 UTF-8 bytes (あ is 3 UTF-8 bytes)
    const result = estimateRecordSizeBytes('key', { v: 'あ' });
    assert.equal(result, 31, `expected 31 UTF-8 bytes, got ${result}`);
  });

  test('ASCII content: byte length equals string length', async () => {
    const { estimateRecordSizeBytes } = await importDistModule(
      'storage/backend/encoding.js',
    );

    // JSON.stringify(['k', { payload: { v: 'abc' } }])
    // = '["k",{"payload":{"v":"abc"}}]' = 29 bytes (ASCII only)
    const result = estimateRecordSizeBytes('k', { v: 'abc' });
    assert.equal(
      result,
      29,
      `expected 29 bytes for ASCII content, got ${result}`,
    );
  });
});
