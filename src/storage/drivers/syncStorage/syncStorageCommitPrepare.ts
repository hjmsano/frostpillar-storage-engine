import {
  QuotaExceededError,
  StorageEngineError,
} from '../../../errors/index.js';
import type { BTreeJSON } from '../../../types.js';
import type {
  SyncStorageBackendState,
  SyncStorageManifest,
} from '../../backend/types.js';
import { validateSyncStorageCommitQuota } from './syncStorageQuota.js';
import {
  SYNC_STORAGE_MAGIC,
  SYNC_STORAGE_VERSION,
  manifestKey,
  chunkKey,
} from './syncStorageKeys.js';

export const buildSyncChunkKeyResolver = (
  state: SyncStorageBackendState,
): ((generation: number, index: number) => string) => {
  return (generation, index): string => {
    return chunkKey(state.keyPrefix, state.databaseKey, generation, index);
  };
};

const buildSyncCommitItems = (
  state: SyncStorageBackendState,
  chunks: string[],
  newManifest: SyncStorageManifest,
  nextGeneration: number,
): Record<string, unknown> => {
  const mKey = manifestKey(state.keyPrefix, state.databaseKey);
  const items: Record<string, unknown> = { [mKey]: newManifest };
  for (let i = 0; i < chunks.length; i += 1) {
    items[chunkKey(state.keyPrefix, state.databaseKey, nextGeneration, i)] =
      chunks[i];
  }
  return items;
};

const splitSyncTreeJSONIntoChunks = (
  treeJSON: BTreeJSON<unknown, unknown>,
  maxChunkChars: number,
  maxChunks: number,
): string[] => {
  const dataJson = JSON.stringify(treeJSON);
  const chunks: string[] = [];
  for (let i = 0; i < dataJson.length; i += maxChunkChars) {
    chunks.push(dataJson.slice(i, i + maxChunkChars));
  }
  if (chunks.length > maxChunks) {
    throw new QuotaExceededError(
      `syncStorage snapshot requires ${chunks.length} chunks but maxChunks is ${maxChunks}.`,
    );
  }
  return chunks;
};

const ensureSyncCommitCountersSafe = (state: SyncStorageBackendState): void => {
  if (state.commitId >= Number.MAX_SAFE_INTEGER) {
    throw new StorageEngineError(
      'syncStorage commitId has reached Number.MAX_SAFE_INTEGER.',
    );
  }
  if (state.activeGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new StorageEngineError(
      'syncStorage activeGeneration has reached Number.MAX_SAFE_INTEGER.',
    );
  }
};

export interface PreparedSyncCommit {
  nextCommitId: number;
  nextGeneration: number;
  newSnapshotItems: Record<string, unknown>;
  resolveChunkKey: (gen: number, idx: number) => string;
  chunkCount: number;
}

export const prepareSyncCommit = (
  state: SyncStorageBackendState,
  treeJSON: BTreeJSON<unknown, unknown>,
): PreparedSyncCommit => {
  ensureSyncCommitCountersSafe(state);
  const nextCommitId = state.commitId + 1;
  const nextGeneration = state.activeGeneration + 1;
  const chunks = splitSyncTreeJSONIntoChunks(
    treeJSON,
    state.maxChunkChars,
    state.maxChunks,
  );

  const newManifest: SyncStorageManifest = {
    magic: SYNC_STORAGE_MAGIC,
    version: SYNC_STORAGE_VERSION,
    activeGeneration: nextGeneration,
    commitId: nextCommitId,
    chunkCount: chunks.length,
  };
  const resolveChunkKey = buildSyncChunkKeyResolver(state);
  const mKey = manifestKey(state.keyPrefix, state.databaseKey);
  validateSyncStorageCommitQuota(
    state,
    nextGeneration,
    chunks,
    newManifest,
    resolveChunkKey,
    mKey,
  );

  return {
    nextCommitId,
    nextGeneration,
    newSnapshotItems: buildSyncCommitItems(
      state,
      chunks,
      newManifest,
      nextGeneration,
    ),
    resolveChunkKey,
    chunkCount: chunks.length,
  };
};
