import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Datastore,
  ConfigurationError,
  FrostpillarError,
  ValidationError,
  StorageEngineError,
  ClosedDatastoreError,
  BinaryFormatError,
  PageCorruptionError,
  IndexCorruptionError,
  QuotaExceededError,
  InvalidQueryRangeError,
  DatabaseLockedError,
  UnsupportedBackendError,
} from '../../dist/index.js';

describe('Config validation', () => {
  it('rejects autoCommit without driver', () => {
    assert.throws(
      () => new Datastore({ autoCommit: { frequency: 'immediate' } }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects invalid duplicateKeys config', () => {
    assert.throws(
      () => new Datastore({ duplicateKeys: 'invalid' }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('accepts valid duplicateKeys: replace', async () => {
    const ds = new Datastore({ duplicateKeys: 'replace' });
    ds.close();
  });

  it('accepts valid duplicateKeys: reject', async () => {
    const ds = new Datastore({ duplicateKeys: 'reject' });
    ds.close();
  });

  it('rejects invalid capacity.maxSize', () => {
    assert.throws(
      () => new Datastore({ capacity: { maxSize: -1 } }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects non-integer capacity.maxSize', () => {
    assert.throws(
      () => new Datastore({ capacity: { maxSize: 1.5 } }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('rejects invalid capacity.maxSize string', () => {
    assert.throws(
      () => new Datastore({ capacity: { maxSize: 'invalid' } }),
      (err) => err instanceof ConfigurationError,
    );
  });

  it('accepts byte-size string formats', async () => {
    const formats = ['100B', '10KB', '1MB', '1GB'];
    for (const maxSize of formats) {
      const ds = new Datastore({ capacity: { maxSize } });
      ds.close();
    }
  });

  it('rejects invalid capacity.policy', () => {
    assert.throws(
      () => new Datastore({ capacity: { maxSize: 1024, policy: 'invalid' } }),
      (err) => err instanceof ConfigurationError,
    );
  });
});

describe('Public error exports', () => {
  it('all error classes are exported and extend FrostpillarError', () => {
    const errorClasses = [
      ValidationError,
      InvalidQueryRangeError,
      ConfigurationError,
      UnsupportedBackendError,
      ClosedDatastoreError,
      StorageEngineError,
      DatabaseLockedError,
      BinaryFormatError,
      PageCorruptionError,
      IndexCorruptionError,
      QuotaExceededError,
    ];

    for (const ErrorClass of errorClasses) {
      assert.equal(typeof ErrorClass, 'function');
      const instance = new ErrorClass('test');
      assert.ok(instance instanceof FrostpillarError);
      assert.ok(instance instanceof Error);
      assert.equal(instance.message, 'test');
    }
  });

  it('StorageEngineError subclasses are correct', () => {
    assert.ok(new DatabaseLockedError('x') instanceof StorageEngineError);
    assert.ok(new BinaryFormatError('x') instanceof StorageEngineError);
    assert.ok(new PageCorruptionError('x') instanceof StorageEngineError);
    assert.ok(new IndexCorruptionError('x') instanceof StorageEngineError);
  });

  it('error name matches class name', () => {
    assert.equal(new ValidationError('x').name, 'ValidationError');
    assert.equal(new ConfigurationError('x').name, 'ConfigurationError');
    assert.equal(new QuotaExceededError('x').name, 'QuotaExceededError');
  });

  it('error supports cause option', () => {
    const cause = new Error('root');
    const err = new StorageEngineError('wrapper', { cause });
    assert.equal(err.cause, cause);
  });
});
