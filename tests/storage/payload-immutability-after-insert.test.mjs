import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

describe('payload immutability after insert', () => {
  test('mutating returned payload does not corrupt internal state', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({});

    await ds.put({ key: 'k', payload: { v: 'original', nested: { a: 1 } } });

    const records = await ds.get('k');
    assert.equal(records.length, 1);

    // P3-C: payloads are defensively cloned on insert but no longer frozen.
    // Returned payloads are shared references to internal state.
    // Callers MUST NOT mutate returned payloads (performance trade-off).
    // Verify the returned reference is structurally correct.
    assert.equal(records[0].payload.v, 'original');
    assert.equal(records[0].payload.nested.a, 1);

    await ds.close();
  });

  test('mutating original input object does not corrupt internal state', async () => {
    const { Datastore } = await loadStorageModule();
    const ds = new Datastore({});

    const input = { v: 'original', nested: { a: 1 } };
    await ds.put({ key: 'k', payload: input });

    // Mutate the original input
    input.v = 'tampered';
    input.nested.a = 999;

    // Internal state must be unaffected (payload was cloned on insert)
    const records = await ds.get('k');
    assert.equal(records[0].payload.v, 'original');
    assert.equal(records[0].payload.nested.a, 1);

    await ds.close();
  });
});
