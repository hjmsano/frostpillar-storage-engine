import type { LocalStorageBackendState } from '../../backend/types.js';

export const manifestKey = (keyPrefix: string, databaseKey: string): string =>
  `${keyPrefix}:ls:${databaseKey}:manifest`;

export const chunkKey = (
  keyPrefix: string,
  databaseKey: string,
  generation: number,
  index: number,
): string => `${keyPrefix}:ls:${databaseKey}:g:${generation}:chunk:${index}`;

export const cleanupGenerationChunks = (
  state: LocalStorageBackendState,
  generation: number,
  knownChunkCount: number | null,
): void => {
  if (knownChunkCount !== null) {
    if (knownChunkCount <= 0) {
      return;
    }
    for (let i = 0; i < knownChunkCount; i += 1) {
      try {
        state.adapter.removeItem(
          chunkKey(state.keyPrefix, state.databaseKey, generation, i),
        );
      } catch {
        // best-effort cleanup; continue deleting remaining chunks
      }
    }
    return;
  }

  if (state.maxChunks <= 0) {
    return;
  }

  for (let i = 0; i < state.maxChunks; i += 1) {
    const key = chunkKey(state.keyPrefix, state.databaseKey, generation, i);
    if (state.adapter.getItem(key) !== null) {
      try {
        state.adapter.removeItem(key);
      } catch {
        // best-effort cleanup; continue deleting remaining chunks
      }
    }
  }
};

export const isQuotaBrowserError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  );
};
