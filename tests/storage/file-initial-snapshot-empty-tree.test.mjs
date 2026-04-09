import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { importDistModule } from '../load-module.mjs';

const loadModules = async () => {
  const snapshotMod = await importDistModule(
    'storage/drivers/file/fileBackendSnapshot.js',
  );
  const btreeMod = await importDistModule(
    'storage/btree/recordKeyIndexBTree.js',
  );
  return { snapshotMod, btreeMod };
};

test('writeInitialFileSnapshot produces treeJSON matching empty RecordKeyIndexBTree.toJSON()', async () => {
  const { snapshotMod, btreeMod } = await loadModules();
  const { writeInitialFileSnapshot } = snapshotMod;
  const { RecordKeyIndexBTree } = btreeMod;

  const tempDir = mkdtempSync(join(tmpdir(), 'fp-snapshot-test-'));
  try {
    const baseFileName = 'test-db';
    const activeDataFile = `${baseFileName}.g.0`;
    const backend = {
      directoryPath: tempDir,
      baseFileName,
      activeDataFile,
      sidecarPath: join(tempDir, `${baseFileName}.meta.json`),
      commitId: 0,
      lockAcquired: false,
    };

    writeInitialFileSnapshot(backend);

    const generationRaw = readFileSync(join(tempDir, activeDataFile), 'utf8');
    const generation = JSON.parse(generationRaw);
    const persistedTreeJSON = generation.treeJSON;

    const emptyTree = new RecordKeyIndexBTree({
      compareKeys: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    });
    const expectedTreeJSON = emptyTree.toJSON();

    assert.deepStrictEqual(
      persistedTreeJSON,
      expectedTreeJSON,
      'Initial snapshot treeJSON must match dynamically generated empty tree JSON',
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
