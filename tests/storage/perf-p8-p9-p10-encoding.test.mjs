import assert from 'node:assert/strict';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

const loadEncoding = async () => {
  return await importDistModule('storage/backend/encoding.js');
};

// ---------------------------------------------------------------------------
// P8: computeUtf8ByteLength — platform-native Buffer path
// ---------------------------------------------------------------------------

test('P8: computeUtf8ByteLength with native Buffer produces same results as TextEncoder', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const cases = [
    '',
    'hello',
    '\u00e9', // 2-byte
    '\u4e16\u754c', // 3-byte CJK
    '\uD83D\uDE00', // 4-byte emoji surrogate pair
    'hello 世界 café 😀🎉',
    'a'.repeat(10000),
  ];
  for (const str of cases) {
    assert.equal(
      computeUtf8ByteLength(str),
      encoder.encode(str).byteLength,
      `Mismatch for: ${str.slice(0, 30)}`,
    );
  }
});

test('P8: computeUtf8ByteLength handles lone surrogates correctly', async () => {
  const { computeUtf8ByteLength } = await loadEncoding();
  const encoder = new TextEncoder();
  const cases = ['\uD800', '\uDEAD', '\uD800A'];
  for (const str of cases) {
    assert.equal(
      computeUtf8ByteLength(str),
      encoder.encode(str).byteLength,
      `Mismatch for lone surrogate`,
    );
  }
});

// ---------------------------------------------------------------------------
// P9: estimateObjectSizeBytes — structural JSON size estimation
// ---------------------------------------------------------------------------

test('P9: estimateObjectSizeBytes is exported', async () => {
  const { estimateObjectSizeBytes } = await loadEncoding();
  assert.equal(typeof estimateObjectSizeBytes, 'function');
});

test('P9: estimateObjectSizeBytes(null) === 4', async () => {
  const { estimateObjectSizeBytes } = await loadEncoding();
  assert.equal(estimateObjectSizeBytes(null), 4);
});

test('P9: estimateObjectSizeBytes(true) === 4, false === 5', async () => {
  const { estimateObjectSizeBytes } = await loadEncoding();
  assert.equal(estimateObjectSizeBytes(true), 4);
  assert.equal(estimateObjectSizeBytes(false), 5);
});

test('P9: estimateObjectSizeBytes numbers match JSON.stringify length', async () => {
  const { estimateObjectSizeBytes, computeUtf8ByteLength } =
    await loadEncoding();
  const numbers = [0, 1, -1, 42, 3.14, -100000, 1e20, 0.1, -0.5, 999999999];
  for (const n of numbers) {
    const expected = computeUtf8ByteLength(JSON.stringify(n));
    assert.equal(
      estimateObjectSizeBytes(n),
      expected,
      `Mismatch for number: ${n}`,
    );
  }
});

test('P9: estimateObjectSizeBytes strings match JSON.stringify byte length', async () => {
  const { estimateObjectSizeBytes, computeUtf8ByteLength } =
    await loadEncoding();
  const strings = [
    '',
    'hello',
    'café',
    '世界',
    '😀🎉',
    'line\nbreak',
    'tab\there',
    'quote"inside',
    'back\\slash',
  ];
  for (const s of strings) {
    const expected = computeUtf8ByteLength(JSON.stringify(s));
    assert.equal(
      estimateObjectSizeBytes(s),
      expected,
      `Mismatch for string: ${s}`,
    );
  }
});

test('P9: estimateObjectSizeBytes empty object === 2', async () => {
  const { estimateObjectSizeBytes } = await loadEncoding();
  assert.equal(estimateObjectSizeBytes({}), 2);
});

test('P9: estimateObjectSizeBytes nested objects match JSON.stringify byte length', async () => {
  const { estimateObjectSizeBytes, computeUtf8ByteLength } =
    await loadEncoding();
  const objects = [
    { name: 'test' },
    { a: 1, b: 2 },
    { nested: { deep: { value: 'hello' } } },
    { key: '日本語', count: 42 },
    { emoji: '😀', flag: true, nothing: null },
    { a: 'x', b: 'y', c: 'z', d: 'w' },
  ];
  for (const obj of objects) {
    const expected = computeUtf8ByteLength(JSON.stringify(obj));
    assert.equal(
      estimateObjectSizeBytes(obj),
      expected,
      `Mismatch for object: ${JSON.stringify(obj)}`,
    );
  }
});

test('P9: estimateObjectSizeBytes handles undefined values in objects (omitted like JSON.stringify)', async () => {
  const { estimateObjectSizeBytes, computeUtf8ByteLength } =
    await loadEncoding();
  const obj = { a: 1, b: undefined, c: 'test' };
  const expected = computeUtf8ByteLength(JSON.stringify(obj));
  assert.equal(estimateObjectSizeBytes(obj), expected);
});

// ---------------------------------------------------------------------------
// P9: estimateRecordSizeBytes — structural estimation matches old implementation
// ---------------------------------------------------------------------------

test('P9: estimateRecordSizeBytes matches TextEncoder for diverse inputs', async () => {
  const { estimateRecordSizeBytes } = await loadEncoding();
  const encoder = new TextEncoder();
  const testCases = [
    { key: 'simple', payload: { name: 'test' } },
    { key: '日本語', payload: { value: 'テスト' } },
    { key: 'emoji🔑', payload: { icon: '😀', nested: { a: 1 } } },
    { key: 42, payload: { count: 100 } },
    { key: 'k', payload: {} },
    { key: '', payload: { x: null, y: true, z: false } },
    { key: 'long', payload: { description: 'a'.repeat(1000) } },
    { key: 'special"chars', payload: { val: 'line\nbreak\ttab' } },
    { key: 'multibyte', payload: { cjk: '世界こんにちは', emoji: '🎉🔥💯' } },
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

test('P9: estimateRecordSizeBytes with number key matches TextEncoder', async () => {
  const { estimateRecordSizeBytes } = await loadEncoding();
  const encoder = new TextEncoder();
  const cases = [
    { key: 0, payload: { v: 1 } },
    { key: -1, payload: { v: 2 } },
    { key: 3.14, payload: { v: 3 } },
  ];
  for (const { key, payload } of cases) {
    const expected = encoder.encode(
      JSON.stringify([key, { payload }]),
    ).byteLength;
    assert.equal(
      estimateRecordSizeBytes(key, payload),
      expected,
      `Mismatch for number key=${key}`,
    );
  }
});

test('P9: estimateRecordSizeBytes with null values in payload matches TextEncoder', async () => {
  const { estimateRecordSizeBytes } = await loadEncoding();
  const encoder = new TextEncoder();
  const payload = { a: null, b: null };
  const expected = encoder.encode(
    JSON.stringify(['k', { payload }]),
  ).byteLength;
  assert.equal(estimateRecordSizeBytes('k', payload), expected);
});

// ---------------------------------------------------------------------------
// P10: estimateKeySizeBytes
// ---------------------------------------------------------------------------

test('P10: estimateKeySizeBytes is exported', async () => {
  const { estimateKeySizeBytes } = await loadEncoding();
  assert.equal(typeof estimateKeySizeBytes, 'function');
});

test('P10: estimateKeySizeBytes matches computeUtf8ByteLength(JSON.stringify(key)) for strings', async () => {
  const { estimateKeySizeBytes, computeUtf8ByteLength } = await loadEncoding();
  const keys = [
    'simple',
    '日本語',
    'emoji🔑',
    '',
    'with"quotes',
    'back\\slash',
  ];
  for (const key of keys) {
    const expected = computeUtf8ByteLength(JSON.stringify(key));
    assert.equal(
      estimateKeySizeBytes(key),
      expected,
      `Mismatch for key: ${key}`,
    );
  }
});

test('P10: estimateKeySizeBytes matches computeUtf8ByteLength(JSON.stringify(key)) for numbers', async () => {
  const { estimateKeySizeBytes, computeUtf8ByteLength } = await loadEncoding();
  const keys = [0, 1, -1, 42, 3.14, 1e20];
  for (const key of keys) {
    const expected = computeUtf8ByteLength(JSON.stringify(key));
    assert.equal(
      estimateKeySizeBytes(key),
      expected,
      `Mismatch for number key: ${key}`,
    );
  }
});
