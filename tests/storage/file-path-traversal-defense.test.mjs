import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureCanonicalPathWithinWorkingDirectory,
  resolveFileDataPath,
} from '../../dist/storage/config/config.node.js';
import { ConfigurationError } from '../../dist/errors/index.js';

describe('file path traversal defense', () => {
  test('ensureCanonicalPathWithinWorkingDirectory rejects absolute path outside cwd', () => {
    assert.throws(
      () =>
        ensureCanonicalPathWithinWorkingDirectory('/etc/passwd', 'filePath'),
      (error) =>
        error instanceof ConfigurationError &&
        error.message.includes('must stay within process.cwd()'),
    );
  });

  test('ensureCanonicalPathWithinWorkingDirectory rejects relative traversal outside cwd', () => {
    assert.throws(
      () =>
        ensureCanonicalPathWithinWorkingDirectory(
          '../../etc/passwd',
          'filePath',
        ),
      (error) =>
        error instanceof ConfigurationError &&
        error.message.includes('must stay within process.cwd()'),
    );
  });

  test('ensureCanonicalPathWithinWorkingDirectory accepts path within cwd', () => {
    assert.doesNotThrow(() =>
      ensureCanonicalPathWithinWorkingDirectory('./data/test.fpdb', 'filePath'),
    );
  });

  test('resolveFileDataPath rejects filePath with traversal outside cwd', () => {
    assert.throws(
      () => resolveFileDataPath({ filePath: '../../etc/secret.fpdb' }),
      (error) => error instanceof ConfigurationError,
    );
  });

  test('resolveFileDataPath rejects target.filePath with absolute escape', () => {
    assert.throws(
      () =>
        resolveFileDataPath({
          target: { kind: 'path', filePath: '/tmp/escape.fpdb' },
        }),
      (error) => error instanceof ConfigurationError,
    );
  });

  test('resolveFileDataPath rejects target.filePrefix with path separators', () => {
    assert.throws(
      () =>
        resolveFileDataPath({
          target: { kind: 'directory', directory: '.', filePrefix: '../' },
        }),
      (error) =>
        error instanceof ConfigurationError &&
        error.message.includes('must not contain path separators'),
    );
  });

  test('resolveFileDataPath rejects target.fileName with traversal token', () => {
    assert.throws(
      () =>
        resolveFileDataPath({
          target: { kind: 'directory', directory: '.', fileName: '..secret' },
        }),
      (error) =>
        error instanceof ConfigurationError &&
        error.message.includes(
          'must not contain path separators or traversal tokens',
        ),
    );
  });

  test('resolveFileDataPath rejects target.fileName with backslash separator', () => {
    assert.throws(
      () =>
        resolveFileDataPath({
          target: { kind: 'directory', directory: '.', fileName: 'a\\b' },
        }),
      (error) =>
        error instanceof ConfigurationError &&
        error.message.includes('must not contain path separators'),
    );
  });

  test('resolveFileDataPath rejects both filePath and target specified together', () => {
    assert.throws(
      () =>
        resolveFileDataPath({
          filePath: './data.fpdb',
          target: { kind: 'path', filePath: './other.fpdb' },
        }),
      (error) =>
        error instanceof ConfigurationError &&
        error.message.includes(
          'filePath and target cannot be specified together',
        ),
    );
  });

  test('resolveFileDataPath accepts safe relative filePath within cwd', () => {
    const result = resolveFileDataPath({ filePath: './tests/.tmp/safe.fpdb' });
    assert.ok(result.endsWith('safe.fpdb'));
  });

  test('resolveFileDataPath defaults to ./frostpillar.fpdb when no config', () => {
    const result = resolveFileDataPath({});
    assert.ok(result.endsWith('frostpillar.fpdb'));
  });
});
