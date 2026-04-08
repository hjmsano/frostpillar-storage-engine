import {
  PageCorruptionError,
  QuotaExceededError,
  StorageEngineError,
} from '../../../errors/index.js';
import type { BTreeJSON } from '../../../types.js';
import { isRecordObject } from '../../../validation/typeGuards.js';
import { parseNonNegativeSafeInteger } from '../../../validation/metadata.js';
import type {
  SyncStorageAdapter,
  SyncStorageBackendState,
  SyncStorageManifest,
} from '../../backend/types.js';
import { detectGlobalSyncStorage } from './syncStorageAdapter.js';
import { cleanupGenerationChunks } from './syncStorageChunkMaintenance.js';
import {
  isQuotaBrowserError,
  validateSyncStorageCommitQuota,
} from './syncStorageQuota.js';

import { computeUtf8ByteLength } from '../../backend/encoding.js';

const SYNC_STORAGE_MAGIC = 'FPSYNC_META';
const SYNC_STORAGE_VERSION = 2;

export interface LoadedSyncStorageSnapshot {
  treeJSON: BTreeJSON<unknown, unknown> | null;
  currentSizeBytes: number;
}

const manifestKey = (keyPrefix: string, databaseKey: string): string => {
  return `${keyPrefix}:sync:${databaseKey}:manifest`;
};

const chunkKey = (
  keyPrefix: string,
  databaseKey: string,
  generation: number,
  index: number,
): string => {
  return `${keyPrefix}:sync:${databaseKey}:g:${generation}:chunk:${index}`;
};

export { detectGlobalSyncStorage };

export const createSyncStorageBackendState = (
  adapter: SyncStorageAdapter,
  keyPrefix: string,
  databaseKey: string,
  maxChunkChars: number,
  maxChunks: number,
  maxItemBytes: number,
  maxTotalBytes: number,
  maxItems: number,
): SyncStorageBackendState => {
  return {
    adapter,
    keyPrefix,
    databaseKey,
    maxChunkChars,
    maxChunks,
    maxItemBytes,
    maxTotalBytes,
    maxItems,
    activeGeneration: 0,
    commitId: 0,
    activeChunkCount: 0,
  };
};

const parseSyncManifest = (
  manifestUnknown: unknown,
  maxChunks: number,
): SyncStorageManifest => {
  if (!isRecordObject(manifestUnknown)) {
    throw new StorageEngineError('syncStorage manifest must be an object.');
  }

  const manifest = manifestUnknown as Partial<SyncStorageManifest>;
  if (
    manifest.magic !== SYNC_STORAGE_MAGIC ||
    manifest.version !== SYNC_STORAGE_VERSION
  ) {
    throw new StorageEngineError(
      'syncStorage manifest magic/version mismatch.',
    );
  }

  const chunkCount = parseNonNegativeSafeInteger(
    manifest.chunkCount,
    'manifest.chunkCount',
    'syncStorage',
  );
  if (chunkCount > maxChunks) {
    throw new StorageEngineError(
      `syncStorage snapshot requires ${chunkCount} chunks but maxChunks is ${maxChunks}.`,
    );
  }

  return manifest as SyncStorageManifest;
};

interface LoadedSyncChunks {
  treeJSON: BTreeJSON<unknown, unknown>;
  rawJsonLength: number;
}

const loadSyncChunksAndDecodeTreeJSON = async (
  state: SyncStorageBackendState,
  activeGeneration: number,
  chunkCount: number,
): Promise<LoadedSyncChunks> => {
  const chunkKeys: string[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    chunkKeys.push(
      chunkKey(state.keyPrefix, state.databaseKey, activeGeneration, i),
    );
  }
  const chunkValuesByKey =
    chunkKeys.length === 0 ? {} : await state.adapter.getItems(chunkKeys);
  const chunks: string[] = [];
  for (const cKey of chunkKeys) {
    const chunkValue = chunkValuesByKey[cKey];
    if (typeof chunkValue !== 'string') {
      throw new StorageEngineError(
        `syncStorage chunk "${cKey}" is missing or not a string.`,
      );
    }
    chunks.push(chunkValue);
  }

  const treeJson = chunks.join('');
  let parsedTreeJSON: unknown;
  try {
    parsedTreeJSON = JSON.parse(treeJson);
  } catch {
    throw new StorageEngineError('syncStorage chunk data JSON is malformed.');
  }
  if (
    typeof parsedTreeJSON !== 'object' ||
    parsedTreeJSON === null ||
    Array.isArray(parsedTreeJSON)
  ) {
    throw new PageCorruptionError('treeJSON must be a non-null plain object.');
  }
  return {
    treeJSON: parsedTreeJSON as BTreeJSON<unknown, unknown>,
    rawJsonLength: computeUtf8ByteLength(treeJson),
  };
};

export const loadSyncStorageSnapshot = async (
  state: SyncStorageBackendState,
): Promise<LoadedSyncStorageSnapshot> => {
  const mKey = manifestKey(state.keyPrefix, state.databaseKey);
  const manifestMap = await state.adapter.getItems([mKey]);
  const manifestUnknown = manifestMap[mKey];

  if (manifestUnknown === undefined) {
    return { treeJSON: null, currentSizeBytes: 0 };
  }

  const manifest = parseSyncManifest(manifestUnknown, state.maxChunks);
  const activeGeneration = parseNonNegativeSafeInteger(
    manifest.activeGeneration,
    'manifest.activeGeneration',
    'syncStorage',
  );
  const commitId = parseNonNegativeSafeInteger(
    manifest.commitId,
    'manifest.commitId',
    'syncStorage',
  );
  const chunkCount = parseNonNegativeSafeInteger(
    manifest.chunkCount,
    'manifest.chunkCount',
    'syncStorage',
  );

  const { treeJSON, rawJsonLength } = await loadSyncChunksAndDecodeTreeJSON(
    state,
    activeGeneration,
    chunkCount,
  );
  const currentSizeBytes = rawJsonLength;

  state.activeGeneration = activeGeneration;
  state.commitId = commitId;
  state.activeChunkCount = chunkCount;

  return { treeJSON, currentSizeBytes };
};

const buildSyncChunkKeyResolver = (
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
    const cKey = chunkKey(
      state.keyPrefix,
      state.databaseKey,
      nextGeneration,
      i,
    );
    items[cKey] = chunks[i];
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

export const commitSyncStorageSnapshot = async (
  state: SyncStorageBackendState,
  treeJSON: BTreeJSON<unknown, unknown>,
): Promise<void> => {
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

  const newSnapshotItems = buildSyncCommitItems(
    state,
    chunks,
    newManifest,
    nextGeneration,
  );

  // Stale chunks in the next generation are maintenance-only and uncommitted.
  // Commit write should proceed even when this cleanup fails transiently.
  try {
    await cleanupGenerationChunks(state, nextGeneration, null, resolveChunkKey);
  } catch {
    // Ignore cleanup-only failures and proceed with commit write.
  }

  try {
    await state.adapter.setItems(newSnapshotItems);
  } catch (error: unknown) {
    if (isQuotaBrowserError(error)) {
      throw new QuotaExceededError('syncStorage quota exceeded during commit.');
    }
    throw new StorageEngineError('syncStorage write failed during commit.', {
      cause: error,
    });
  }

  const previousGeneration = state.activeGeneration;
  const previousChunkCount = state.activeChunkCount;
  state.activeGeneration = nextGeneration;
  state.commitId = nextCommitId;
  state.activeChunkCount = chunks.length;

  await cleanupGenerationChunks(
    state,
    previousGeneration,
    previousChunkCount,
    resolveChunkKey,
  );
};
