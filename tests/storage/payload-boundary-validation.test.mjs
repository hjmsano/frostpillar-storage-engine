import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule } from '../load-module.mjs';

describe('payload boundary validation', async () => {
  const { validateAndNormalizePayload, deepFreezePayload } =
    await importDistModule('validation/payload.js');
  const { estimateObjectSizeBytes } = await importDistModule(
    'storage/backend/encoding.js',
  );

  describe('validateAndNormalizePayload – depth limit', () => {
    test('accepts payload at depth 63 (within MAX_PAYLOAD_DEPTH=64)', () => {
      let obj = { value: 'leaf' };
      for (let i = 0; i < 62; i++) {
        obj = { nested: obj };
      }
      assert.doesNotThrow(() => validateAndNormalizePayload(obj));
    });

    test('rejects payload exceeding depth 64', () => {
      let obj = { value: 'leaf' };
      for (let i = 0; i < 65; i++) {
        obj = { nested: obj };
      }
      assert.throws(() => validateAndNormalizePayload(obj), {
        name: 'ValidationError',
      });
    });
  });

  describe('validateAndNormalizePayload – key limits', () => {
    test('rejects key exceeding MAX_PAYLOAD_KEY_BYTES (1024)', () => {
      const longKey = 'k'.repeat(1025);
      const payload = { [longKey]: 'value' };
      assert.throws(() => validateAndNormalizePayload(payload), {
        name: 'ValidationError',
      });
    });

    test('accepts key within MAX_PAYLOAD_KEY_BYTES', () => {
      const key = 'k'.repeat(1024);
      const payload = { [key]: 'value' };
      assert.doesNotThrow(() => validateAndNormalizePayload(payload));
    });

    test('rejects object with more than MAX_PAYLOAD_KEYS_PER_OBJECT (256)', () => {
      const payload = {};
      for (let i = 0; i < 257; i++) {
        payload[`key${i}`] = i;
      }
      assert.throws(() => validateAndNormalizePayload(payload), {
        name: 'ValidationError',
      });
    });
  });

  describe('validateAndNormalizePayload – string byte limit', () => {
    test('rejects string value exceeding MAX_PAYLOAD_STRING_BYTES (65535)', () => {
      const payload = { data: 'x'.repeat(65536) };
      assert.throws(() => validateAndNormalizePayload(payload), {
        name: 'ValidationError',
      });
    });

    test('accepts string value at MAX_PAYLOAD_STRING_BYTES', () => {
      const payload = { data: 'x'.repeat(65535) };
      assert.doesNotThrow(() => validateAndNormalizePayload(payload));
    });
  });

  describe('validateAndNormalizePayload – circular references', () => {
    test('rejects circular payload references', () => {
      const payload = { a: 1 };
      payload.self = payload;
      assert.throws(() => validateAndNormalizePayload(payload), {
        name: 'ValidationError',
      });
    });
  });

  describe('validateAndNormalizePayload – non-plain objects', () => {
    test('rejects Date value', () => {
      assert.throws(() => validateAndNormalizePayload({ date: new Date() }), {
        name: 'ValidationError',
      });
    });

    test('rejects RegExp value', () => {
      assert.throws(() => validateAndNormalizePayload({ pattern: /test/ }), {
        name: 'ValidationError',
      });
    });

    test('rejects Map as payload', () => {
      assert.throws(() => validateAndNormalizePayload(new Map()), {
        name: 'ValidationError',
      });
    });

    test('rejects function value', () => {
      assert.throws(() => validateAndNormalizePayload({ fn: () => {} }), {
        name: 'ValidationError',
      });
    });
  });

  describe('validateAndNormalizePayload – size bytes', () => {
    test('returns sizeBytes including root wrapper overhead', () => {
      const result = validateAndNormalizePayload({ a: 1 });
      assert.equal(typeof result.sizeBytes, 'number');
      assert.ok(result.sizeBytes > 15);
    });

    test('cloned payload is independent from original', () => {
      const original = { name: 'test', nested: { x: 1 } };
      const result = validateAndNormalizePayload(original);
      // P3-C: cloned payload is no longer frozen.
      result.payload.name = 'changed';
      // Original is unaffected (clone is independent)
      assert.equal(original.name, 'test');
    });
  });

  describe('validateAndNormalizePayload – JSON escaping in size estimation', () => {
    // JSON_ROOT_WRAPPER_OVERHEAD = 15
    const ROOT_OVERHEAD = 15;

    test('string value with double quotes accounts for escape overhead', () => {
      const payload = { msg: 'say "hello"' };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });

    test('string value with backslashes accounts for escape overhead', () => {
      const payload = { path: 'C:\\Users\\test' };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });

    test('string value with newlines accounts for escape overhead', () => {
      const payload = { text: 'line1\nline2\rline3' };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });

    test('string value with control characters accounts for \\uXXXX escape', () => {
      const payload = { ctrl: 'a\x01b\x02c' };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });

    test('key with special characters accounts for escape overhead', () => {
      const payload = { 'key"with\\escapes': 'value' };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });

    test('plain ASCII strings match estimateObjectSizeBytes exactly', () => {
      // Use false (not true) so boolean worst-case (5) matches exact (5).
      const payload = { name: 'hello', count: 42, flag: false, empty: null };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });

    test('nested objects with special chars match estimateObjectSizeBytes', () => {
      const payload = { outer: { inner: 'tab\there\nnewline' } };
      const result = validateAndNormalizePayload(payload);
      const expected = estimateObjectSizeBytes(payload) + ROOT_OVERHEAD;
      assert.equal(result.sizeBytes, expected);
    });
  });

  describe('validateAndNormalizePayload – total bytes limit', () => {
    test('rejects payload exceeding MAX_PAYLOAD_TOTAL_BYTES (1MB)', () => {
      const payload = {};
      for (let i = 0; i < 256; i++) {
        payload[`k${String(i).padStart(4, '0')}`] = 'x'.repeat(65535);
      }
      assert.throws(() => validateAndNormalizePayload(payload), {
        name: 'ValidationError',
      });
    });
  });

  describe('deepFreezePayload', () => {
    test('freezes top-level object', () => {
      const payload = { a: 1, b: 'two' };
      deepFreezePayload(payload);
      assert.ok(Object.isFrozen(payload));
    });

    test('freezes nested objects', () => {
      const payload = { nested: { deep: { value: 42 } } };
      deepFreezePayload(payload);
      assert.ok(Object.isFrozen(payload));
      assert.ok(Object.isFrozen(payload.nested));
      assert.ok(Object.isFrozen(payload.nested.deep));
    });

    test('returns the same payload reference', () => {
      const payload = { a: 1 };
      const result = deepFreezePayload(payload);
      assert.equal(result, payload);
    });
  });
});
