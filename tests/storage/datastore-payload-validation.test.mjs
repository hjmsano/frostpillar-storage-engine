import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore, ValidationError } from '../../dist/index.js';

describe('Datastore payload validation', () => {
  let ds;

  before(() => {
    ds = new Datastore({});
  });

  after(async () => {
    await ds.close();
  });

  it('rejects non-object payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: 'string' }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects null payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: null }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects array payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: [1, 2, 3] }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects reserved key __proto__', async () => {
    const payload = Object.create(null);
    Object.defineProperty(payload, '__proto__', {
      value: 'evil',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    await assert.rejects(
      () => ds.put({ key: 'k', payload }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects reserved key constructor', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { constructor: 'evil' } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects reserved key prototype', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { prototype: 'evil' } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects empty-string key in payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { '': 'empty' } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects whitespace-only key in payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { '   ': 'spaces' } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects Infinity in payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { v: Infinity } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects NaN in payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { v: NaN } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects bigint in payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { v: 42n } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('rejects array value in payload', async () => {
    await assert.rejects(
      () => ds.put({ key: 'k', payload: { v: [1, 2] } }),
      (err) => err instanceof ValidationError,
    );
  });

  it('accepts valid nested payload', async () => {
    await ds.put({
      key: 'nested',
      payload: {
        a: 'string',
        b: 42,
        c: true,
        d: null,
        e: { nested: 'yes' },
      },
    });
    const result = await ds.getFirst('nested');
    assert.equal(result.payload.a, 'string');
    assert.equal(result.payload.b, 42);
    assert.equal(result.payload.c, true);
    assert.equal(result.payload.d, null);
    assert.deepStrictEqual(result.payload.e, { nested: 'yes' });
  });

  it('accepts empty object payload', async () => {
    await ds.put({ key: 'empty', payload: {} });
    const result = await ds.getFirst('empty');
    assert.deepStrictEqual(result.payload, {});
  });

  // Regression: put/putMany must throw ValidationError for invalid record shapes
  it('put(null) throws ValidationError', async () => {
    await assert.rejects(
      () => ds.put(null),
      (err) => err instanceof ValidationError && err.message === 'Record must be a non-null object',
    );
  });

  it('put(undefined) throws ValidationError', async () => {
    await assert.rejects(
      () => ds.put(undefined),
      (err) => err instanceof ValidationError && err.message === 'Record must be a non-null object',
    );
  });

  it('put({ payload: {} }) (missing key) throws ValidationError', async () => {
    await assert.rejects(
      () => ds.put({ payload: {} }),
      (err) => err instanceof ValidationError,
    );
  });

  it('putMany([null]) throws ValidationError', async () => {
    await assert.rejects(
      () => ds.putMany([null]),
      (err) => err instanceof ValidationError && err.message === 'Record must be a non-null object',
    );
  });

  it('putMany([undefined]) throws ValidationError', async () => {
    await assert.rejects(
      () => ds.putMany([undefined]),
      (err) => err instanceof ValidationError && err.message === 'Record must be a non-null object',
    );
  });
});
