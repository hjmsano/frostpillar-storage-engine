import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore, ValidationError } from '../../dist/index.js';

describe('Datastore event listener', () => {
  let ds;

  before(() => {
    ds = new Datastore({});
  });

  after(async () => {
    await ds.close();
  });

  it('on("error") registers a listener and returns unsubscribe fn', () => {
    const listener = () => {};
    const unsub = ds.on('error', listener);
    assert.equal(typeof unsub, 'function');
    unsub();
  });

  it('on() throws for unsupported event', () => {
    assert.throws(
      () => ds.on('unknown', () => {}),
      (err) => err instanceof ValidationError,
    );
  });

  it('off() throws for unsupported event', () => {
    assert.throws(
      () => ds.off('unknown', () => {}),
      (err) => err instanceof ValidationError,
    );
  });

  it('off() removes a registered listener without error', () => {
    const listener = () => {};
    ds.on('error', listener);
    ds.off('error', listener);
  });
});

describe('Datastore close behavior', () => {
  it('double close does not throw', async () => {
    const ds = new Datastore({});
    await ds.put({ key: 'a', payload: { v: 1 } });
    await ds.close();
    await ds.close();
  });

  it('operations after close reject', async () => {
    const ds = new Datastore({});
    await ds.close();

    await assert.rejects(() => ds.put({ key: 'a', payload: { v: 1 } }));
    await assert.rejects(() => ds.get('a'));
    await assert.rejects(() => ds.count());
  });
});
