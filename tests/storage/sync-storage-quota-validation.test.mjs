import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule } from '../load-module.mjs';

describe('syncStorageQuota', async () => {
  const { isQuotaBrowserError, validateSyncStorageCommitQuota } =
    await importDistModule('storage/drivers/syncStorage/syncStorageQuota.js');

  describe('isQuotaBrowserError', () => {
    test('returns true for QuotaExceededError from errors module', async () => {
      const { QuotaExceededError } = await importDistModule('errors/index.js');
      const error = new QuotaExceededError('quota exceeded');
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns true for Error with quota in name', () => {
      const error = new Error('storage full');
      error.name = 'QuotaExceededError';
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns true for Error with quota in message', () => {
      const error = new Error('quota exceeded for this operation');
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns true for Error with max_items in name/message', () => {
      const error = new Error('max_items exceeded');
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns true for Error with quota_bytes in message', () => {
      const error = new Error('quota_bytes limit hit');
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns true for Error with quota_bytes_per_item in message', () => {
      const error = new Error('quota_bytes_per_item exceeded');
      assert.equal(isQuotaBrowserError(error), true);
    });

    test('returns false for non-Error values', () => {
      assert.equal(isQuotaBrowserError('quota'), false);
      assert.equal(isQuotaBrowserError(null), false);
      assert.equal(isQuotaBrowserError(42), false);
    });

    test('returns false for unrelated Error', () => {
      assert.equal(isQuotaBrowserError(new Error('network failure')), false);
    });
  });

  describe('validateSyncStorageCommitQuota', () => {
    const makeState = (overrides = {}) => ({
      maxItems: 512,
      maxItemBytes: 8192,
      maxTotalBytes: 102400,
      ...overrides,
    });

    const resolveChunkKey = (generation, index) =>
      `fp:sync:db:g:${generation}:chunk:${index}`;

    test('passes validation for small snapshot', () => {
      assert.doesNotThrow(() => {
        validateSyncStorageCommitQuota(
          makeState(),
          1,
          ['chunk0'],
          { generation: 1, chunks: 1 },
          resolveChunkKey,
          'fp:sync:db:manifest',
        );
      });
    });

    test('throws QuotaExceededError when items exceed maxItems', async () => {
      const { QuotaExceededError } = await importDistModule('errors/index.js');
      const chunks = Array.from({ length: 5 }, (_, i) => `chunk${i}`);

      assert.throws(
        () =>
          validateSyncStorageCommitQuota(
            makeState({ maxItems: 3 }),
            1,
            chunks,
            { generation: 1, chunks: 5 },
            resolveChunkKey,
            'fp:sync:db:manifest',
          ),
        (error) => error instanceof QuotaExceededError,
      );
    });

    test('throws QuotaExceededError when single item exceeds maxItemBytes', async () => {
      const { QuotaExceededError } = await importDistModule('errors/index.js');
      const largeChunk = 'x'.repeat(5000);

      assert.throws(
        () =>
          validateSyncStorageCommitQuota(
            makeState({ maxItemBytes: 10 }),
            1,
            [largeChunk],
            { generation: 1, chunks: 1 },
            resolveChunkKey,
            'fp:sync:db:manifest',
          ),
        (error) => error instanceof QuotaExceededError,
      );
    });

    test('throws QuotaExceededError when total bytes exceed maxTotalBytes', async () => {
      const { QuotaExceededError } = await importDistModule('errors/index.js');
      const chunk = 'x'.repeat(100);
      const chunks = Array.from({ length: 10 }, () => chunk);

      assert.throws(
        () =>
          validateSyncStorageCommitQuota(
            makeState({ maxTotalBytes: 50 }),
            1,
            chunks,
            { generation: 1, chunks: 10 },
            resolveChunkKey,
            'fp:sync:db:manifest',
          ),
        (error) => error instanceof QuotaExceededError,
      );
    });
  });
});
