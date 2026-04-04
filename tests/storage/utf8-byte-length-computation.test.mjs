import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { computeUtf8ByteLength } = await import(
  '../../dist/storage/backend/encoding.js'
);

const encoder = new TextEncoder();
const textEncoderByteLength = (value) => encoder.encode(value).byteLength;

describe('computeUtf8ByteLength', () => {
  it('matches TextEncoder for ASCII-only strings', () => {
    const value = 'hello world 1234';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
  });

  it('matches TextEncoder for 2-byte characters (Latin Extended)', () => {
    const value = 'café résumé naïve';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
  });

  it('matches TextEncoder for 3-byte CJK characters', () => {
    const value = '日本語テスト';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
    // CJK chars are 3 bytes each in UTF-8
    assert.strictEqual(computeUtf8ByteLength(value), 18);
  });

  it('matches TextEncoder for 4-byte astral plane characters (emoji)', () => {
    const value = '😀🎉🚀';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
    // Each emoji is a surrogate pair in UTF-16, 4 bytes in UTF-8
    assert.strictEqual(computeUtf8ByteLength(value), 12);
  });

  it('matches TextEncoder for mixed ASCII, CJK, and emoji', () => {
    const value = 'key=日本語,emoji=😀';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
  });

  it('matches TextEncoder for lone high surrogate (U+FFFD replacement)', () => {
    // Lone high surrogate: \uD800 without a following low surrogate
    const value = 'a\uD800b';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
    // 'a' (1) + U+FFFD (3) + 'b' (1) = 5
    assert.strictEqual(computeUtf8ByteLength(value), 5);
  });

  it('matches TextEncoder for lone low surrogate (U+FFFD replacement)', () => {
    const value = 'a\uDC00b';
    assert.strictEqual(
      computeUtf8ByteLength(value),
      textEncoderByteLength(value),
    );
    assert.strictEqual(computeUtf8ByteLength(value), 5);
  });

  it('returns 0 for empty string', () => {
    assert.strictEqual(computeUtf8ByteLength(''), 0);
  });

  it('matches TextEncoder for JSON-serialized object with multibyte keys', () => {
    const json = JSON.stringify({ 名前: '太郎', age: 30 });
    assert.strictEqual(
      computeUtf8ByteLength(json),
      textEncoderByteLength(json),
    );
  });
});
