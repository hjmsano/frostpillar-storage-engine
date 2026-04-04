import {
  PageCorruptionError,
  QuotaExceededError,
  StorageEngineError,
} from '../../../errors/index.js';
import type { BTreeJSON } from '../../../types.js';
import { parseNonNegativeSafeInteger } from '../../../validation/metadata.js';
import {
  chunkKey,
  cleanupGenerationChunks,
  isQuotaBrowserError,
  manifestKey,
} from './localStorageLayout.js';
import type {
  LocalStorageAdapter,
  LocalStorageBackendState,
  LocalStorageManifest,
} from '../../backend/types.js';
import { computeUtf8ByteLength } from '../../backend/encoding.js';

const LS_MAGIC = 'FPLS_META';
const LS_VERSION = 2;

export interface LoadedLocalStorageSnapshot {
  treeJSON: BTreeJSON<unknown, unknown> | null;
  currentSizeBytes: number;
}

export const detectGlobalLocalStorage = (): LocalStorageAdapter | null => {
  try {
    const g = globalThis as { localStorage?: LocalStorageAdapter | null };
    const ls = g.localStorage;
    if (ls === null || ls === undefined) {
      return null;
    }
    return ls;
  } catch {
    return null;
  }
};

export const createLocalStorageBackendState = (
  adapter: LocalStorageAdapter,
  keyPrefix: string,
  databaseKey: string,
  maxChunkChars: number,
  maxChunks: number,
): LocalStorageBackendState => ({
  adapter,
  keyPrefix,
  databaseKey,
  maxChunkChars,
  maxChunks,
  activeGeneration: 0,
  commitId: 0,
  activeChunkCount: 0,
});

const parseLocalStorageManifest = (
  manifestRaw: string,
  maxChunks: number,
): LocalStorageManifest => {
  let manifest: LocalStorageManifest;
  try {
    manifest = JSON.parse(manifestRaw) as LocalStorageManifest;
  } catch {
    throw new StorageEngineError('localStorage manifest JSON is malformed.');
  }

  if (manifest.magic !== LS_MAGIC || manifest.version !== LS_VERSION) {
    throw new StorageEngineError(
      'localStorage manifest magic/version mismatch.',
    );
  }

  const chunkCount = parseNonNegativeSafeInteger(
    manifest.chunkCount,
    'manifest.chunkCount',
    'localStorage',
  );
  if (chunkCount > maxChunks) {
    throw new StorageEngineError(
      `localStorage snapshot requires ${chunkCount} chunks but maxChunks is ${maxChunks}.`,
    );
  }

  return manifest;
};

interface LoadedLocalStorageChunks {
  treeJSON: BTreeJSON<unknown, unknown>;
  rawJsonLength: number;
}

const loadLocalStorageChunks = (
  state: LocalStorageBackendState,
  activeGeneration: number,
  chunkCount: number,
): LoadedLocalStorageChunks => {
  const chunks: string[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const cKey = chunkKey(
      state.keyPrefix,
      state.databaseKey,
      activeGeneration,
      i,
    );
    const chunkValue = state.adapter.getItem(cKey);
    if (typeof chunkValue !== 'string') {
      throw new StorageEngineError(
        `localStorage chunk "${cKey}" is missing or not a string.`,
      );
    }
    chunks.push(chunkValue);
  }

  const treeJson = chunks.join('');
  let parsedTreeJSON: unknown;
  try {
    parsedTreeJSON = JSON.parse(treeJson);
  } catch {
    throw new StorageEngineError('localStorage chunk data JSON is malformed.');
  }
  if (typeof parsedTreeJSON !== 'object' || parsedTreeJSON === null || Array.isArray(parsedTreeJSON)) {
    throw new PageCorruptionError('treeJSON must be a non-null plain object.');
  }
  return {
    treeJSON: parsedTreeJSON as BTreeJSON<unknown, unknown>,
    rawJsonLength: computeUtf8ByteLength(treeJson),
  };
};

export const loadLocalStorageSnapshot = (
  state: LocalStorageBackendState,
): LoadedLocalStorageSnapshot => {
  const mKey = manifestKey(state.keyPrefix, state.databaseKey);
  const manifestRaw = state.adapter.getItem(mKey);

  if (manifestRaw === null) {
    return { treeJSON: null, currentSizeBytes: 0 };
  }

  const manifest = parseLocalStorageManifest(manifestRaw, state.maxChunks);
  const activeGeneration = parseNonNegativeSafeInteger(
    manifest.activeGeneration,
    'manifest.activeGeneration',
    'localStorage',
  );
  const commitId = parseNonNegativeSafeInteger(
    manifest.commitId,
    'manifest.commitId',
    'localStorage',
  );
  const chunkCount = parseNonNegativeSafeInteger(
    manifest.chunkCount,
    'manifest.chunkCount',
    'localStorage',
  );

  const { treeJSON, rawJsonLength } = loadLocalStorageChunks(state, activeGeneration, chunkCount);
  const currentSizeBytes = rawJsonLength;

  state.activeGeneration = activeGeneration;
  state.commitId = commitId;
  state.activeChunkCount = chunkCount;

  return { treeJSON, currentSizeBytes };
};

const splitTreeJSONIntoChunks = (
  treeJSON: BTreeJSON<unknown, unknown>,
  maxChunkChars: number,
  maxChunks: number,
  driverName: string,
): string[] => {
  const dataJson = JSON.stringify(treeJSON);
  const chunks: string[] = [];
  for (let i = 0; i < dataJson.length; i += maxChunkChars) {
    chunks.push(dataJson.slice(i, i + maxChunkChars));
  }
  if (chunks.length > maxChunks) {
    throw new QuotaExceededError(
      `${driverName} snapshot requires ${chunks.length} chunks but maxChunks is ${maxChunks}.`,
    );
  }
  return chunks;
};

const ensureCommitCountersSafe = (state: LocalStorageBackendState): void => {
  if (state.commitId >= Number.MAX_SAFE_INTEGER) {
    throw new StorageEngineError(
      'localStorage commitId has reached Number.MAX_SAFE_INTEGER.',
    );
  }
  if (state.activeGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new StorageEngineError(
      'localStorage activeGeneration has reached Number.MAX_SAFE_INTEGER.',
    );
  }
};

interface PreparedLocalStorageCommit {
  nextCommitId: number;
  nextGeneration: number;
  chunks: string[];
  manifestJson: string;
}

const prepareLocalStorageCommit = (
  state: LocalStorageBackendState,
  treeJSON: BTreeJSON<unknown, unknown>,
): PreparedLocalStorageCommit => {
  const nextCommitId = state.commitId + 1;
  const nextGeneration = state.activeGeneration + 1;
  const chunks = splitTreeJSONIntoChunks(
    treeJSON,
    state.maxChunkChars,
    state.maxChunks,
    'localStorage',
  );
  const newManifest: LocalStorageManifest = {
    magic: LS_MAGIC,
    version: LS_VERSION,
    activeGeneration: nextGeneration,
    commitId: nextCommitId,
    chunkCount: chunks.length,
  };

  return {
    nextCommitId,
    nextGeneration,
    chunks,
    manifestJson: JSON.stringify(newManifest),
  };
};

const writeLocalStorageCommit = (
  state: LocalStorageBackendState,
  preparedCommit: PreparedLocalStorageCommit,
): void => {
  try {
    // Retry on the same generation index after failures must not read stale chunks.
    cleanupGenerationChunks(state, preparedCommit.nextGeneration, null);

    for (let i = 0; i < preparedCommit.chunks.length; i += 1) {
      state.adapter.setItem(
        chunkKey(
          state.keyPrefix,
          state.databaseKey,
          preparedCommit.nextGeneration,
          i,
        ),
        preparedCommit.chunks[i],
      );
    }
    state.adapter.setItem(
      manifestKey(state.keyPrefix, state.databaseKey),
      preparedCommit.manifestJson,
    );
  } catch (error) {
    if (isQuotaBrowserError(error) || error instanceof QuotaExceededError) {
      throw new QuotaExceededError(
        'localStorage quota exceeded during commit.',
      );
    }
    throw new StorageEngineError('localStorage write failed during commit.');
  }
};

export const commitLocalStorageSnapshot = (
  state: LocalStorageBackendState,
  treeJSON: BTreeJSON<unknown, unknown>,
): void => {
  ensureCommitCountersSafe(state);
  const preparedCommit = prepareLocalStorageCommit(state, treeJSON);
  writeLocalStorageCommit(state, preparedCommit);

  // Update state before cleanup so that a cleanup failure does not leave
  // stale generation/commitId values while storage already points to the new manifest.
  const previousGeneration = state.activeGeneration;
  const previousChunkCount = state.activeChunkCount;
  state.activeGeneration = preparedCommit.nextGeneration;
  state.commitId = preparedCommit.nextCommitId;
  state.activeChunkCount = preparedCommit.chunks.length;

  // Clean up old generation chunks after manifest switch (best-effort)
  cleanupGenerationChunks(
    state,
    previousGeneration,
    previousChunkCount,
  );
};
