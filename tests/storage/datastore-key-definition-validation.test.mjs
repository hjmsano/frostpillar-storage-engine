import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule } from '../load-module.mjs';

describe('datastoreKeyDefinition', async () => {
  const {
    DEFAULT_STRING_KEY_DEFINITION,
    resolveKeyDefinition,
    readRawInsertKey,
  } = await importDistModule('storage/datastore/datastoreKeyDefinition.js');

  describe('DEFAULT_STRING_KEY_DEFINITION', () => {
    test('normalize returns valid non-empty string', () => {
      assert.equal(
        DEFAULT_STRING_KEY_DEFINITION.normalize('hello', 'key'),
        'hello',
      );
    });

    test('normalize throws ValidationError for non-string', () => {
      assert.throws(() => DEFAULT_STRING_KEY_DEFINITION.normalize(123, 'key'), {
        name: 'ValidationError',
      });
    });

    test('normalize throws ValidationError for empty string', () => {
      assert.throws(() => DEFAULT_STRING_KEY_DEFINITION.normalize('', 'key'), {
        name: 'ValidationError',
      });
    });

    test('serialize returns valid non-empty string', () => {
      assert.equal(DEFAULT_STRING_KEY_DEFINITION.serialize('abc'), 'abc');
    });

    test('serialize throws ValidationError for empty string', () => {
      assert.throws(() => DEFAULT_STRING_KEY_DEFINITION.serialize(''), {
        name: 'ValidationError',
      });
    });

    test('serialize throws ValidationError for non-string', () => {
      assert.throws(() => DEFAULT_STRING_KEY_DEFINITION.serialize(42), {
        name: 'ValidationError',
      });
    });

    test('deserialize returns valid non-empty string', () => {
      assert.equal(DEFAULT_STRING_KEY_DEFINITION.deserialize('xyz'), 'xyz');
    });

    test('deserialize throws ValidationError for empty string', () => {
      assert.throws(() => DEFAULT_STRING_KEY_DEFINITION.deserialize(''), {
        name: 'ValidationError',
      });
    });

    test('deserialize throws ValidationError for non-string', () => {
      assert.throws(() => DEFAULT_STRING_KEY_DEFINITION.deserialize(null), {
        name: 'ValidationError',
      });
    });
  });

  describe('resolveKeyDefinition', () => {
    test('returns default when config.key is undefined', () => {
      const result = resolveKeyDefinition({});
      assert.equal(typeof result.normalize, 'function');
      assert.equal(typeof result.compare, 'function');
      assert.equal(typeof result.serialize, 'function');
      assert.equal(typeof result.deserialize, 'function');
    });

    test('returns custom key definition when provided', () => {
      const custom = {
        normalize: (v) => v,
        compare: (a, b) => a - b,
        serialize: (v) => String(v),
        deserialize: (v) => Number(v),
      };
      const result = resolveKeyDefinition({ key: custom });
      assert.equal(result, custom);
    });

    test('throws ConfigurationError when normalize is not a function', () => {
      assert.throws(
        () =>
          resolveKeyDefinition({
            key: {
              normalize: 'notfn',
              compare: () => 0,
              serialize: () => '',
              deserialize: () => '',
            },
          }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws ConfigurationError when compare is not a function', () => {
      assert.throws(
        () =>
          resolveKeyDefinition({
            key: {
              normalize: () => '',
              compare: 42,
              serialize: () => '',
              deserialize: () => '',
            },
          }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws ConfigurationError when serialize is not a function', () => {
      assert.throws(
        () =>
          resolveKeyDefinition({
            key: {
              normalize: () => '',
              compare: () => 0,
              serialize: null,
              deserialize: () => '',
            },
          }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws ConfigurationError when deserialize is not a function', () => {
      assert.throws(
        () =>
          resolveKeyDefinition({
            key: {
              normalize: () => '',
              compare: () => 0,
              serialize: () => '',
              deserialize: undefined,
            },
          }),
        { name: 'ConfigurationError' },
      );
    });
  });

  describe('readRawInsertKey', () => {
    test('returns key and fieldName for record with "key" field', () => {
      const result = readRawInsertKey({ key: 'mykey', payload: {} });
      assert.deepEqual(result, { rawKey: 'mykey', keyFieldName: 'key' });
    });

    test('returns undefined rawKey when key field is explicitly undefined', () => {
      const result = readRawInsertKey({ key: undefined });
      assert.deepEqual(result, { rawKey: undefined, keyFieldName: 'key' });
    });

    test('throws ValidationError when record has no "key" field', () => {
      assert.throws(() => readRawInsertKey({ id: 'abc', payload: {} }), {
        name: 'ValidationError',
      });
    });

    test('throws ValidationError for empty record', () => {
      assert.throws(() => readRawInsertKey({}), { name: 'ValidationError' });
    });
  });
});
