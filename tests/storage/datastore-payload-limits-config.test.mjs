import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Datastore, ValidationError, ConfigurationError } from '../../dist/index.js';

describe('Datastore payloadLimits configuration', () => {
  describe('default limits (no payloadLimits provided)', () => {
    let ds;
    before(() => { ds = new Datastore({}); });
    after(async () => { await ds.close(); });

    it('rejects payload at depth 65 (default maxDepth=64)', async () => {
      let obj = { value: 'leaf' };
      for (let i = 0; i < 64; i++) { obj = { nested: obj }; }
      await assert.rejects(
        () => ds.put({ key: 'k', payload: obj }),
        (err) => err instanceof ValidationError,
      );
    });

    it('rejects key exceeding 1024 bytes (default maxKeyBytes)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k', payload: { ['k'.repeat(1025)]: 'v' } }),
        (err) => err instanceof ValidationError,
      );
    });

    it('rejects string exceeding 65535 bytes (default maxStringBytes)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k', payload: { data: 'x'.repeat(65536) } }),
        (err) => err instanceof ValidationError,
      );
    });

    it('rejects object with >256 keys (default maxKeysPerObject)', async () => {
      const payload = {};
      for (let i = 0; i < 257; i++) { payload[`key${i}`] = i; }
      await assert.rejects(
        () => ds.put({ key: 'k', payload }),
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('custom maxDepth', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxDepth: 4 } }); });
    after(async () => { await ds.close(); });

    it('accepts payload at custom maxDepth (4)', async () => {
      const payload = { a: { b: { c: { d: 'leaf' } } } }; // depth 4
      await ds.put({ key: 'k1', payload });
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.a.b.c.d, 'leaf');
    });

    it('rejects payload exceeding custom maxDepth (4)', async () => {
      const payload = { a: { b: { c: { d: { e: 'too deep' } } } } }; // depth 5
      await assert.rejects(
        () => ds.put({ key: 'k2', payload }),
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('custom maxKeyBytes', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxKeyBytes: 10 } }); });
    after(async () => { await ds.close(); });

    it('accepts payload key within custom maxKeyBytes (10)', async () => {
      await ds.put({ key: 'k1', payload: { abcdefghij: 'v' } }); // 10 bytes
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.abcdefghij, 'v');
    });

    it('rejects payload key exceeding custom maxKeyBytes (10)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k2', payload: { abcdefghijk: 'v' } }), // 11 bytes
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('custom maxStringBytes', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxStringBytes: 20 } }); });
    after(async () => { await ds.close(); });

    it('accepts string value within custom maxStringBytes (20)', async () => {
      await ds.put({ key: 'k1', payload: { data: 'x'.repeat(20) } });
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.data.length, 20);
    });

    it('rejects string value exceeding custom maxStringBytes (20)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k2', payload: { data: 'x'.repeat(21) } }),
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('custom maxKeysPerObject', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxKeysPerObject: 3 } }); });
    after(async () => { await ds.close(); });

    it('accepts object with keys at custom maxKeysPerObject (3)', async () => {
      await ds.put({ key: 'k1', payload: { a: 1, b: 2, c: 3 } });
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.a, 1);
    });

    it('rejects object with keys exceeding custom maxKeysPerObject (3)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k2', payload: { a: 1, b: 2, c: 3, d: 4 } }),
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('custom maxTotalKeys', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxTotalKeys: 3 } }); });
    after(async () => { await ds.close(); });

    it('accepts payload with total keys at custom maxTotalKeys (3)', async () => {
      await ds.put({ key: 'k1', payload: { a: 1, nested: { b: 2 } } }); // 3 keys: a, nested, b
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.a, 1);
    });

    it('rejects payload with total keys exceeding custom maxTotalKeys (3)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k2', payload: { a: 1, b: 2, nested: { c: 3 } } }), // 4 keys
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('custom maxTotalBytes', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxTotalBytes: 50 } }); });
    after(async () => { await ds.close(); });

    it('accepts payload within custom maxTotalBytes (50)', async () => {
      await ds.put({ key: 'k1', payload: { a: 1 } });
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.a, 1);
    });

    it('rejects payload exceeding custom maxTotalBytes (50)', async () => {
      await assert.rejects(
        () => ds.put({ key: 'k2', payload: { longValue: 'x'.repeat(100) } }),
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('payloadLimits with updateById', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxStringBytes: 10 } }); });
    after(async () => { await ds.close(); });

    it('rejects updateById patch that violates custom maxStringBytes', async () => {
      await ds.put({ key: 'k1', payload: { data: 'short' } });
      const record = await ds.getFirst('k1');
      await assert.rejects(
        () => ds.updateById(record._id, { data: 'x'.repeat(11) }),
        (err) => err instanceof ValidationError,
      );
    });
  });

  describe('payloadLimits with replaceById', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxStringBytes: 10 } }); });
    after(async () => { await ds.close(); });

    it('rejects replaceById payload that violates custom maxStringBytes', async () => {
      await ds.put({ key: 'k1', payload: { data: 'short' } });
      const record = await ds.getFirst('k1');
      await assert.rejects(
        () => ds.replaceById(record._id, { data: 'x'.repeat(11) }),
        (err) => err instanceof ValidationError,
      );
      // Original record must be unchanged
      const after = await ds.getById(record._id);
      assert.equal(after.payload.data, 'short');
    });

    it('accepts replaceById payload within custom maxStringBytes', async () => {
      const all = await ds.getAll();
      const id = all[0]._id;
      const replaced = await ds.replaceById(id, { data: 'x'.repeat(10) });
      assert.equal(replaced, true);
      const record = await ds.getById(id);
      assert.equal(record.payload.data.length, 10);
    });
  });

  describe('payloadLimits ignored when skipPayloadValidation is true', () => {
    let ds;
    before(() => {
      ds = new Datastore({
        skipPayloadValidation: true,
        payloadLimits: { maxDepth: 2 },
      });
    });
    after(async () => { await ds.close(); });

    it('accepts payload exceeding custom maxDepth when validation is skipped', async () => {
      const payload = { a: { b: { c: { d: 'deep' } } } }; // depth 4 > maxDepth 2
      await ds.put({ key: 'k1', payload });
      const result = await ds.getFirst('k1');
      assert.equal(result.payload.a.b.c.d, 'deep');
    });
  });

  describe('payloadLimits config validation', () => {
    it('rejects maxDepth that is not a positive safe integer', () => {
      assert.throws(
        () => new Datastore({ payloadLimits: { maxDepth: 0 } }),
        (err) => err instanceof ConfigurationError,
      );
    });

    it('rejects negative maxKeyBytes', () => {
      assert.throws(
        () => new Datastore({ payloadLimits: { maxKeyBytes: -1 } }),
        (err) => err instanceof ConfigurationError,
      );
    });

    it('rejects non-integer maxStringBytes', () => {
      assert.throws(
        () => new Datastore({ payloadLimits: { maxStringBytes: 1.5 } }),
        (err) => err instanceof ConfigurationError,
      );
    });

    it('rejects NaN maxKeysPerObject', () => {
      assert.throws(
        () => new Datastore({ payloadLimits: { maxKeysPerObject: NaN } }),
        (err) => err instanceof ConfigurationError,
      );
    });

    it('rejects Infinity maxTotalKeys', () => {
      assert.throws(
        () => new Datastore({ payloadLimits: { maxTotalKeys: Infinity } }),
        (err) => err instanceof ConfigurationError,
      );
    });

    it('rejects unsafe integer maxTotalBytes', () => {
      assert.throws(
        () => new Datastore({ payloadLimits: { maxTotalBytes: Number.MAX_SAFE_INTEGER + 1 } }),
        (err) => err instanceof ConfigurationError,
      );
    });

    it('accepts valid partial payloadLimits (only some fields)', () => {
      const ds = new Datastore({ payloadLimits: { maxDepth: 10 } });
      assert.ok(ds);
      ds.close();
    });

    it('accepts empty payloadLimits object (all defaults)', () => {
      const ds = new Datastore({ payloadLimits: {} });
      assert.ok(ds);
      ds.close();
    });
  });

  describe('putMany respects custom payloadLimits', () => {
    let ds;
    before(() => { ds = new Datastore({ payloadLimits: { maxStringBytes: 10 } }); });
    after(async () => { await ds.close(); });

    it('rejects putMany record that violates custom maxStringBytes', async () => {
      await assert.rejects(
        () => ds.putMany([
          { key: 'k1', payload: { data: 'short' } },
          { key: 'k2', payload: { data: 'x'.repeat(11) } },
        ]),
        (err) => err instanceof ValidationError,
      );
    });
  });
});
