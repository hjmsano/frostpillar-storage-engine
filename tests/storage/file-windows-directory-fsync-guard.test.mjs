import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('directory fsync is supported on POSIX platforms and skipped on win32', async () => {
  const { snapshotMod } = await loadModules();
  const { isDirectoryFsyncSupported } = snapshotMod;

  assert.equal(typeof isDirectoryFsyncSupported, 'function');
  assert.equal(isDirectoryFsyncSupported('linux'), true);
  assert.equal(isDirectoryFsyncSupported('darwin'), true);
  assert.equal(isDirectoryFsyncSupported('win32'), false);
});

test('commit succeeds with directory fsync skipped when platform reports win32', async () => {
  const { snapshotMod, btreeMod } = await loadModules();
  const { writeInitialFileSnapshot, commitFileBackendSnapshot } = snapshotMod;
  const { RecordKeyIndexBTree } = btreeMod;

  const tempDir = mkdtempSync(join(tmpdir(), 'fp-win32-fsync-guard-'));
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  );
  try {
    const baseFileName = 'test-db';
    const backend = {
      directoryPath: tempDir,
      baseFileName,
      activeDataFile: `${baseFileName}.g.0`,
      sidecarPath: join(tempDir, `${baseFileName}.meta.json`),
      commitId: 0,
      lockAcquired: false,
    };
    writeInitialFileSnapshot(backend);

    const tree = new RecordKeyIndexBTree({
      compareKeys: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    });
    tree.put('k1', { payload: { event: 'guard' }, sizeBytes: 1 });

    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    commitFileBackendSnapshot(backend, tree.toJSON());

    assert.equal(backend.commitId, 1);
    assert.equal(backend.activeDataFile, `${baseFileName}.g.1`);
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
