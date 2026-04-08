import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule } from '../load-module.mjs';

describe('localStorageLayout', async () => {
  const {
    manifestKey,
    chunkKey,
    cleanupGenerationChunks,
    isQuotaBrowserError,
  } = await importDistModule(
    'storage/drivers/localStorage/localStorageLayout.js',
  );

  describe('manifestKey', () => {
    test('generates correct manifest key', () => {
      assert.equal(manifestKey('fp', 'mydb'), 'fp:ls:mydb:manifest');
    });

    test('handles empty prefix and database key', () => {
      assert.equal(manifestKey('', ''), ':ls::manifest');
    });
  });

  describe('chunkKey', () => {
    test('generates correct chunk key', () => {
      assert.equal(chunkKey('fp', 'mydb', 1, 0), 'fp:ls:mydb:g:1:chunk:0');
    });

    test('uses generation and index in key', () => {
      assert.equal(chunkKey('fp', 'db', 5, 3), 'fp:ls:db:g:5:chunk:3');
    });
  });

  describe('cleanupGenerationChunks', () => {
    test('removes known chunk count items', () => {
      const removed = [];
      const state = {
        keyPrefix: 'fp',
        databaseKey: 'db',
        maxChunks: 10,
        adapter: {
          removeItem: (key) => removed.push(key),
          getItem: () => null,
        },
      };

      cleanupGenerationChunks(state, 1, 3);

      assert.deepEqual(removed, [
        'fp:ls:db:g:1:chunk:0',
        'fp:ls:db:g:1:chunk:1',
        'fp:ls:db:g:1:chunk:2',
      ]);
    });

    test('returns early when knownChunkCount is 0', () => {
      const removed = [];
      const state = {
        keyPrefix: 'fp',
        databaseKey: 'db',
        maxChunks: 10,
        adapter: {
          removeItem: (key) => removed.push(key),
          getItem: () => null,
        },
      };

      cleanupGenerationChunks(state, 1, 0);
      assert.deepEqual(removed, []);
    });

    test('returns early when knownChunkCount is negative', () => {
      const removed = [];
      const state = {
        keyPrefix: 'fp',
        databaseKey: 'db',
        maxChunks: 10,
        adapter: {
          removeItem: (key) => removed.push(key),
          getItem: () => null,
        },
      };

      cleanupGenerationChunks(state, 1, -1);
      assert.deepEqual(removed, []);
    });

    test('probes and removes existing chunks when knownChunkCount is null', () => {
      const removed = [];
      const existingKeys = new Set([
        'fp:ls:db:g:2:chunk:0',
        'fp:ls:db:g:2:chunk:1',
      ]);
      const state = {
        keyPrefix: 'fp',
        databaseKey: 'db',
        maxChunks: 5,
        adapter: {
          removeItem: (key) => removed.push(key),
          getItem: (key) => (existingKeys.has(key) ? '{}' : null),
        },
      };

      cleanupGenerationChunks(state, 2, null);

      assert.deepEqual(removed, [
        'fp:ls:db:g:2:chunk:0',
        'fp:ls:db:g:2:chunk:1',
      ]);
    });

    test('returns early when maxChunks is 0 and knownChunkCount is null', () => {
      const removed = [];
      const state = {
        keyPrefix: 'fp',
        databaseKey: 'db',
        maxChunks: 0,
        adapter: {
          removeItem: (key) => removed.push(key),
          getItem: () => '{}',
        },
      };

      cleanupGenerationChunks(state, 1, null);
      assert.deepEqual(removed, []);
    });
  });

  describe('isQuotaBrowserError', () => {
    test('returns true for QuotaExceededError', () => {
      const error = new DOMException('quota exceeded', 'QuotaExceededError');
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns true for NS_ERROR_DOM_QUOTA_REACHED', () => {
      const error = new Error('quota reached');
      error.name = 'NS_ERROR_DOM_QUOTA_REACHED';
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns false for non-Error values', () => {
      assert.equal(isQuotaBrowserError('quota exceeded'), false);
      assert.equal(isQuotaBrowserError(null), false);
      assert.equal(isQuotaBrowserError(undefined), false);
    });

    test('returns false for regular errors', () => {
      assert.equal(isQuotaBrowserError(new Error('some error')), false);
      assert.equal(isQuotaBrowserError(new TypeError('type error')), false);
    });
  });
});
