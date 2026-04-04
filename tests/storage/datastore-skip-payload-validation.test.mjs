import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importDistModule, loadStorageModule } from '../load-module.mjs';

const createStringKeyDefinition = () => ({
  normalize: (value, fieldName) => {
    if (typeof value !== 'string') throw new TypeError(`${fieldName} must be string.`);
    if (value.length === 0) throw new TypeError(`${fieldName} must not be empty.`);
    return value;
  },
  compare: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  serialize: (key) => key,
  deserialize: (serialized) => serialized,
});

// ---------------------------------------------------------------------------
// P6: skipPayloadValidation — Trusted Input Mode
// ---------------------------------------------------------------------------

describe('P6: skipPayloadValidation', () => {
  test('put() succeeds and record is retrievable', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
    });
    try {
      await ds.put({ key: 'a', payload: { name: 'hello', count: 42 } });
      const records = await ds.get('a');
      assert.equal(records.length, 1);
      assert.equal(records[0].payload.name, 'hello');
      assert.equal(records[0].payload.count, 42);
    } finally {
      await ds.close();
    }
  });

  test('payload is stored by reference (no deep clone)', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
    });
    try {
      const payload = { v: 'original' };
      await ds.put({ key: 'ref', payload });
      // Mutate the original object after put
      payload.v = 'mutated';
      const records = await ds.get('ref');
      // Because skipPayloadValidation stores by reference, mutation is visible
      assert.equal(records[0].payload.v, 'mutated');
    } finally {
      await ds.close();
    }
  });

  test('putMany() succeeds for batch', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
    });
    try {
      await ds.putMany([
        { key: 'x', payload: { n: 1 } },
        { key: 'y', payload: { n: 2 } },
        { key: 'z', payload: { n: 3 } },
      ]);
      assert.equal(await ds.count(), 3);
    } finally {
      await ds.close();
    }
  });

  test('with strict capacity: put() respects quota', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
      capacity: { maxSize: 200, policy: 'strict' },
    });
    try {
      await ds.put({ key: 'small', payload: { v: 'ok' } });
      const records = await ds.get('small');
      assert.equal(records.length, 1);

      await assert.rejects(
        () => ds.put({ key: 'big', payload: { v: 'x'.repeat(300) } }),
        (err) => err instanceof QuotaExceededError,
      );
    } finally {
      await ds.close();
    }
  });

  test('with strict capacity: putMany() batch atomicity preserved', async () => {
    const { Datastore } = await loadStorageModule();
    const { QuotaExceededError } = await importDistModule('errors/index.js');
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
      capacity: { maxSize: 120, policy: 'strict' },
    });
    try {
      await assert.rejects(
        () => ds.putMany([
          { key: 'k1', payload: { v: 'a'.repeat(30) } },
          { key: 'k2', payload: { v: 'b'.repeat(30) } },
          { key: 'k3', payload: { v: 'c'.repeat(30) } },
        ]),
        (err) => err instanceof QuotaExceededError,
      );
      assert.equal(await ds.count(), 0);
    } finally {
      await ds.close();
    }
  });

  test('updateById succeeds and tracks size correctly', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
      capacity: { maxSize: 2000, policy: 'strict' },
    });
    try {
      await ds.put({ key: 'u', payload: { name: 'before' } });
      const records = await ds.get('u');
      const id = records[0]._id;
      const updated = await ds.updateById(id, { name: 'after', extra: 'field' });
      assert.equal(updated, true);
      const after = await ds.getById(id);
      assert.equal(after.payload.name, 'after');
      assert.equal(after.payload.extra, 'field');
    } finally {
      await ds.close();
    }
  });

  test('default (false): validation still runs, rejects invalid payload', async () => {
    const { Datastore } = await loadStorageModule();
    const { ValidationError } = await importDistModule('errors/index.js');
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      // skipPayloadValidation NOT set — default false
    });
    try {
      await assert.rejects(
        () => ds.put({ key: 'bad', payload: [1, 2, 3] }),
        (err) => err instanceof ValidationError,
      );
    } finally {
      await ds.close();
    }
  });

  test('skipPayloadValidation=true allows values that would normally be rejected', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({
      key: createStringKeyDefinition(),
      skipPayloadValidation: true,
    });
    try {
      // __proto__ key would be rejected by validation, but allowed when skipped
      await ds.put({ key: 'proto', payload: { '__proto__': 'test' } });
      const records = await ds.get('proto');
      assert.equal(records.length, 1);
    } finally {
      await ds.close();
    }
  });
});
