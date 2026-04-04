import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Datastore } from '../../dist/index.js';
import { fileDriver } from '../../dist/drivers/file.js';

const createTempDir = () => {
  const base = path.join(process.cwd(), '.tmp-test');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'frostpillar-test-'));
};

describe('File backend integration', () => {
  let tempDir;

  after(() => {
    const base = path.join(process.cwd(), '.tmp-test');
    if (fs.existsSync(base)) {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('persists and reloads data from file', async () => {
    tempDir = createTempDir();

    const ds1 = new Datastore({
      driver: fileDriver({
        target: { kind: 'directory', directory: tempDir },
      }),
    });

    await ds1.put({ key: 'persistent', payload: { data: 'hello' } });
    await ds1.commit();
    await ds1.close();

    const ds2 = new Datastore({
      driver: fileDriver({
        target: { kind: 'directory', directory: tempDir },
      }),
    });

    const result = await ds2.getFirst('persistent');
    assert.notEqual(result, null);
    assert.equal(result.key, 'persistent');
    assert.equal(result.payload.data, 'hello');

    await ds2.close();
  });

  it('survives put, update, delete, then reload', async () => {
    tempDir = createTempDir();

    const ds1 = new Datastore({
      driver: fileDriver({
        target: { kind: 'directory', directory: tempDir },
      }),
    });

    await ds1.put({ key: 'a', payload: { v: 1 } });
    await ds1.put({ key: 'b', payload: { v: 2 } });
    await ds1.put({ key: 'c', payload: { v: 3 } });

    const all = await ds1.getAll();
    const bId = all.find((r) => r.key === 'b')._id;
    await ds1.updateById(bId, { v: 22 });
    await ds1.delete('c');
    await ds1.commit();
    await ds1.close();

    const ds2 = new Datastore({
      driver: fileDriver({
        target: { kind: 'directory', directory: tempDir },
      }),
    });

    const count = await ds2.count();
    assert.equal(count, 2);

    const bResult = await ds2.getFirst('b');
    assert.equal(bResult.payload.v, 22);

    const cResult = await ds2.getFirst('c');
    assert.equal(cResult, null);

    await ds2.close();
  });

  it('clear and reload produces empty store', async () => {
    tempDir = createTempDir();

    const ds1 = new Datastore({
      driver: fileDriver({
        target: { kind: 'directory', directory: tempDir },
      }),
    });

    await ds1.put({ key: 'x', payload: { v: 1 } });
    await ds1.clear();
    await ds1.commit();
    await ds1.close();

    const ds2 = new Datastore({
      driver: fileDriver({
        target: { kind: 'directory', directory: tempDir },
      }),
    });

    const count = await ds2.count();
    assert.equal(count, 0);
    await ds2.close();
  });
});
