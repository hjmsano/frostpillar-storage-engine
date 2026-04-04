import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadStorageModule } from '../load-module.mjs';

const importDistModule = async (relativeDistPath) => {
  await loadStorageModule();
  const moduleHref = pathToFileURL(
    path.resolve(process.cwd(), 'dist', relativeDistPath),
  ).href;
  return await import(moduleHref);
};

const createSampleTreeJSON = () => ({
  version: 1,
  config: {},
  entries: [['k', { key: 'k', payload: { value: 'v' } }]],
});

test('localStorage commit cleanup probe is bounded by maxChunks', async () => {
  const { commitLocalStorageSnapshot, createLocalStorageBackendState } = await importDistModule(
    'storage/drivers/localStorage/localStorageBackend.js',
  );

  const getItemCalls = [];
  const removeItemCalls = [];
  const store = new Map();
  const attackerControlledContiguousRange = 1000;
  const state = createLocalStorageBackendState(
    {
      getItem: (key) => {
        getItemCalls.push(key);
        const matched = /:g:(\d+):chunk:(\d+)$/.exec(key);
        if (matched !== null) {
          const generation = Number.parseInt(matched[1], 10);
          const index = Number.parseInt(matched[2], 10);
          if (generation === 1 && index < attackerControlledContiguousRange) {
            return 'stale';
          }
        }
        return store.get(key) ?? null;
      },
      setItem: (key, value) => {
        store.set(key, String(value));
      },
      removeItem: (key) => {
        removeItemCalls.push(key);
        store.delete(key);
      },
    },
    'frostpillar',
    'bounded-cleanup',
    4096,
    4,
  );

  commitLocalStorageSnapshot(state, createSampleTreeJSON());

  assert.ok(getItemCalls.length <= 4);
  assert.ok(removeItemCalls.length <= 4);
  assert.equal(state.activeChunkCount, 1);
});
