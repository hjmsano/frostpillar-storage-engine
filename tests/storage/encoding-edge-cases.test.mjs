import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule } from '../load-module.mjs';

describe('encoding edge cases', async () => {
  const { estimateObjectSizeBytes, estimateRecordSizeBytes, estimateKeySizeBytes } =
    await importDistModule('storage/backend/encoding.js');

  describe('estimateObjectSizeBytes – unsupported types', () => {
    test('returns 0 for undefined', () => {
      assert.equal(estimateObjectSizeBytes(undefined), 0);
    });

    test('returns 0 for function', () => {
      assert.equal(estimateObjectSizeBytes(() => {}), 0);
    });

    test('returns 0 for symbol', () => {
      assert.equal(estimateObjectSizeBytes(Symbol('test')), 0);
    });

    test('returns 0 for bigint', () => {
      assert.equal(estimateObjectSizeBytes(BigInt(42)), 0);
    });
  });

  describe('estimateObjectSizeBytes – JSON escaping in strings', () => {
    test('accounts for escaped double quotes', () => {
      const value = 'say "hello"';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });

    test('accounts for escaped backslash', () => {
      const value = 'path\\to\\file';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });

    test('accounts for control characters (tab, newline)', () => {
      const value = 'line1\tline2\nline3';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });

    test('accounts for low control characters (\\u00XX escape)', () => {
      const value = 'null\x00byte\x01and\x02more';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });

    test('handles backspace and form feed', () => {
      const value = 'back\bfeed\f';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });

    test('handles carriage return', () => {
      const value = 'line\r';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });
  });

  describe('estimateObjectSizeBytes – lone surrogates', () => {
    test('matches JSON.stringify byte length for lone high surrogate', () => {
      // Lone high surrogate: JSON.stringify emits \uD800 (6 ASCII bytes)
      const value = 'a\uD800b';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });

    test('matches JSON.stringify byte length for lone low surrogate', () => {
      const value = 'a\uDC00b';
      const expected = Buffer.byteLength(JSON.stringify(value), 'utf8');
      assert.equal(estimateObjectSizeBytes(value), expected);
    });
  });

  describe('estimateObjectSizeBytes – nested objects', () => {
    test('matches JSON.stringify for object with undefined values', () => {
      const obj = { a: 1, b: undefined, c: 'x' };
      const expected = Buffer.byteLength(JSON.stringify(obj), 'utf8');
      assert.equal(estimateObjectSizeBytes(obj), expected);
    });

    test('matches JSON.stringify for deeply nested object', () => {
      const obj = { level1: { level2: { level3: { value: 42 } } } };
      const expected = Buffer.byteLength(JSON.stringify(obj), 'utf8');
      assert.equal(estimateObjectSizeBytes(obj), expected);
    });

    test('matches JSON.stringify for empty object', () => {
      const expected = Buffer.byteLength(JSON.stringify({}), 'utf8');
      assert.equal(estimateObjectSizeBytes({}), expected);
    });

    test('matches JSON.stringify for object with multibyte keys', () => {
      const obj = { 'キー': 'バリュー' };
      const expected = Buffer.byteLength(JSON.stringify(obj), 'utf8');
      assert.equal(estimateObjectSizeBytes(obj), expected);
    });
  });

  describe('estimateRecordSizeBytes', () => {
    test('returns key + payload + overhead', () => {
      const keySize = estimateKeySizeBytes('mykey');
      const payloadSize = estimateObjectSizeBytes({ name: 'test' });
      const result = estimateRecordSizeBytes('mykey', { name: 'test' });
      assert.equal(result, keySize + payloadSize + 15);
    });
  });

  describe('estimateKeySizeBytes', () => {
    test('estimates number key size', () => {
      assert.equal(estimateKeySizeBytes(42), 2);
    });

    test('estimates string key with quotes', () => {
      assert.equal(estimateKeySizeBytes('a'), 3);
    });
  });
});
