import type { SyncStorageBackendState } from '../../backend/types.js';

export const cleanupGenerationChunks = async (
  state: SyncStorageBackendState,
  generation: number,
  knownChunkCount: number | null,
  chunkKeyResolver: (generation: number, index: number) => string,
): Promise<void> => {
  if (knownChunkCount !== null) {
    if (knownChunkCount <= 0) {
      return;
    }
    const knownKeys: string[] = [];
    for (let i = 0; i < knownChunkCount; i += 1) {
      knownKeys.push(chunkKeyResolver(generation, i));
    }
    await state.adapter.removeItems(knownKeys);
    return;
  }

  if (state.maxChunks <= 0) {
    return;
  }

  const speculativeKeys: string[] = [];
  for (let i = 0; i < state.maxChunks; i += 1) {
    speculativeKeys.push(chunkKeyResolver(generation, i));
  }
  const maybeChunks = await state.adapter.getItems(speculativeKeys);
  const discoveredKeys = speculativeKeys.filter((key): boolean => {
    return Object.prototype.hasOwnProperty.call(maybeChunks, key);
  });
  if (discoveredKeys.length === 0) {
    return;
  }
  await state.adapter.removeItems(discoveredKeys);
};
