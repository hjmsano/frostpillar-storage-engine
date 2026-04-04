import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule } from '../load-module.mjs';

describe('config.shared parsing', async () => {
  const { parseCapacityConfig, parseAutoCommitConfig, parseDuplicateKeyConfig } =
    await importDistModule('storage/config/config.shared.js');

  describe('parseCapacityConfig', () => {
    test('returns null for undefined capacity', () => {
      assert.equal(parseCapacityConfig(undefined), null);
    });

    test('parses numeric maxSize with strict policy', () => {
      assert.deepEqual(parseCapacityConfig({ maxSize: 1024, policy: 'strict' }), {
        maxSizeBytes: 1024,
        policy: 'strict',
      });
    });

    test('parses string maxSize "100B"', () => {
      assert.deepEqual(parseCapacityConfig({ maxSize: '100B' }), {
        maxSizeBytes: 100,
        policy: 'strict',
      });
    });

    test('parses string maxSize "10KB"', () => {
      assert.deepEqual(parseCapacityConfig({ maxSize: '10KB' }), {
        maxSizeBytes: 10240,
        policy: 'strict',
      });
    });

    test('parses string maxSize "1MB"', () => {
      assert.deepEqual(parseCapacityConfig({ maxSize: '1MB' }), {
        maxSizeBytes: 1048576,
        policy: 'strict',
      });
    });

    test('parses string maxSize "1GB"', () => {
      assert.deepEqual(parseCapacityConfig({ maxSize: '1GB' }), {
        maxSizeBytes: 1073741824,
        policy: 'strict',
      });
    });

    test('defaults policy to strict', () => {
      const result = parseCapacityConfig({ maxSize: 512 });
      assert.equal(result.policy, 'strict');
    });

    test('accepts turnover policy', () => {
      const result = parseCapacityConfig({ maxSize: 512, policy: 'turnover' });
      assert.equal(result.policy, 'turnover');
    });

    test('throws for backendLimit string', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: 'backendLimit' }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for invalid string format', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: 'foobar' }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for negative numeric maxSize', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: -10 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for zero numeric maxSize', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: 0 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for non-integer numeric maxSize', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: 1.5 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for invalid policy', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: 512, policy: 'invalid' }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for string maxSize exceeding safe integer range', () => {
      assert.throws(
        () => parseCapacityConfig({ maxSize: '9999999999999999GB' }),
        { name: 'ConfigurationError' },
      );
    });
  });

  describe('parseAutoCommitConfig', () => {
    test('defaults to immediate with no config', () => {
      assert.deepEqual(parseAutoCommitConfig(undefined), {
        frequency: 'immediate',
        intervalMs: null,
        maxPendingBytes: null,
      });
    });

    test('parses explicit immediate frequency', () => {
      assert.deepEqual(parseAutoCommitConfig({ frequency: 'immediate' }), {
        frequency: 'immediate',
        intervalMs: null,
        maxPendingBytes: null,
      });
    });

    test('parses numeric frequency as scheduled', () => {
      assert.deepEqual(parseAutoCommitConfig({ frequency: 5000 }), {
        frequency: 'scheduled',
        intervalMs: 5000,
        maxPendingBytes: null,
      });
    });

    test('parses frequency string "500ms"', () => {
      assert.deepEqual(parseAutoCommitConfig({ frequency: '500ms' }), {
        frequency: 'scheduled',
        intervalMs: 500,
        maxPendingBytes: null,
      });
    });

    test('parses frequency string "5s"', () => {
      assert.deepEqual(parseAutoCommitConfig({ frequency: '5s' }), {
        frequency: 'scheduled',
        intervalMs: 5000,
        maxPendingBytes: null,
      });
    });

    test('parses frequency string "2m"', () => {
      assert.deepEqual(parseAutoCommitConfig({ frequency: '2m' }), {
        frequency: 'scheduled',
        intervalMs: 120000,
        maxPendingBytes: null,
      });
    });

    test('parses frequency string "1h"', () => {
      assert.deepEqual(parseAutoCommitConfig({ frequency: '1h' }), {
        frequency: 'scheduled',
        intervalMs: 3600000,
        maxPendingBytes: null,
      });
    });

    test('includes maxPendingBytes when provided', () => {
      assert.deepEqual(
        parseAutoCommitConfig({ frequency: 'immediate', maxPendingBytes: 4096 }),
        {
          frequency: 'immediate',
          intervalMs: null,
          maxPendingBytes: 4096,
        },
      );
    });

    test('throws for invalid frequency string', () => {
      assert.throws(
        () => parseAutoCommitConfig({ frequency: 'invalid' }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for negative numeric frequency', () => {
      assert.throws(
        () => parseAutoCommitConfig({ frequency: -100 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for zero numeric frequency', () => {
      assert.throws(
        () => parseAutoCommitConfig({ frequency: 0 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for non-integer numeric frequency', () => {
      assert.throws(
        () => parseAutoCommitConfig({ frequency: 1.5 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for negative maxPendingBytes', () => {
      assert.throws(
        () => parseAutoCommitConfig({ maxPendingBytes: -1 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for zero maxPendingBytes', () => {
      assert.throws(
        () => parseAutoCommitConfig({ maxPendingBytes: 0 }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for frequency string with zero amount', () => {
      assert.throws(
        () => parseAutoCommitConfig({ frequency: '0ms' }),
        { name: 'ConfigurationError' },
      );
    });

    test('throws for frequency string exceeding safe integer range', () => {
      assert.throws(
        () => parseAutoCommitConfig({ frequency: '9999999999999999h' }),
        { name: 'ConfigurationError' },
      );
    });
  });

  describe('parseDuplicateKeyConfig', () => {
    test('defaults to allow', () => {
      assert.equal(parseDuplicateKeyConfig(undefined), 'allow');
    });

    test('accepts allow', () => {
      assert.equal(parseDuplicateKeyConfig('allow'), 'allow');
    });

    test('accepts replace', () => {
      assert.equal(parseDuplicateKeyConfig('replace'), 'replace');
    });

    test('accepts reject', () => {
      assert.equal(parseDuplicateKeyConfig('reject'), 'reject');
    });

    test('throws for invalid value', () => {
      assert.throws(
        () => parseDuplicateKeyConfig('invalid'),
        { name: 'ConfigurationError' },
      );
    });
  });
});
