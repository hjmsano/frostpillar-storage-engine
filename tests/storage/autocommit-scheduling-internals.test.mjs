import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStorageModule } from '../load-module.mjs';

const createTrackingDriver = (options = {}) => {
  const { frequency = 'immediate', maxPendingBytes } = options;
  let commitCount = 0;
  let lastSnapshotRecordCount = 0;

  return {
    commitCount: () => commitCount,
    lastSnapshotRecordCount: () => lastSnapshotRecordCount,
    autoCommit: { frequency, maxPendingBytes },
    driver: {
      init(context) {
        let pendingBytes = 0;
        let dirtyFromClear = false;

        const doCommit = async () => {
          const snap = context.getSnapshot();
          lastSnapshotRecordCount = (snap.treeJSON.entries ?? []).length;
          commitCount++;
          pendingBytes = 0;
        };

        const controller = {
          handleRecordAppended: async (bytes) => {
            if (frequency === 'immediate') {
              await doCommit();
              return;
            }
            pendingBytes += bytes;
            if (maxPendingBytes !== undefined && pendingBytes >= maxPendingBytes) {
              await doCommit();
            }
          },
          handleCleared: async () => {
            dirtyFromClear = true;
            if (frequency === 'immediate') {
              await doCommit();
            }
          },
          commitNow: async () => {
            await doCommit();
          },
          close: async () => {},
        };

        return {
          controller,
          initialTreeJSON: null,
          initialCurrentSizeBytes: 0,
        };
      },
    },
  };
};

test('autoCommit immediate mode commits on every put', async () => {
  const { Datastore } = await loadStorageModule();

  const mock = createTrackingDriver({ frequency: 'immediate' });
  const ds = new Datastore({
    driver: mock.driver,
    autoCommit: { frequency: 'immediate' },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  await ds.put({ key: 'b', payload: { v: 2 } });

  assert.equal(mock.commitCount(), 2);

  await ds.close();
});

test('autoCommit with maxPendingBytes triggers commit at threshold', async () => {
  const { Datastore } = await loadStorageModule();

  const mock = createTrackingDriver({ frequency: '60s', maxPendingBytes: 1 });
  const ds = new Datastore({
    driver: mock.driver,
    autoCommit: { frequency: '60s', maxPendingBytes: 1 },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });

  assert.equal(mock.commitCount(), 1);

  await ds.close();
});

test('clear() commits cleared state under immediate mode', async () => {
  const { Datastore } = await loadStorageModule();

  const mock = createTrackingDriver({ frequency: 'immediate' });
  const ds = new Datastore({
    driver: mock.driver,
    autoCommit: { frequency: 'immediate' },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });
  const commitsBefore = mock.commitCount();

  await ds.clear();

  assert.ok(mock.commitCount() > commitsBefore);
  assert.equal(mock.lastSnapshotRecordCount(), 0);

  await ds.close();
});

test('autoCommit without driver throws ConfigurationError', async () => {
  const { Datastore, ConfigurationError } = await loadStorageModule();

  assert.throws(() => {
    new Datastore({ autoCommit: { frequency: 'immediate' } });
  }, ConfigurationError);
});

test('scheduled autoCommit without maxPendingBytes does not commit on put', async () => {
  const { Datastore } = await loadStorageModule();

  const mock = createTrackingDriver({ frequency: '60s' });
  const ds = new Datastore({
    driver: mock.driver,
    autoCommit: { frequency: '60s' },
  });

  await ds.put({ key: 'a', payload: { v: 1 } });

  // Long interval, no byte threshold — no auto-commit triggered
  assert.equal(mock.commitCount(), 0);

  // Explicit commit() still works
  await ds.commit();
  assert.equal(mock.commitCount(), 1);

  await ds.close();
});
