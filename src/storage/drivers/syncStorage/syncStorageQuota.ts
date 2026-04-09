import {
  QuotaExceededError,
  StorageEngineError,
} from '../../../errors/index.js';
import type {
  SyncStorageBackendState,
  SyncStorageManifest,
} from '../../backend/types.js';

const utf8Encoder = new TextEncoder();

const computeSyncStorageItemBytes = (key: string, value: unknown): number => {
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) {
    throw new StorageEngineError(
      `syncStorage value for key "${key}" cannot be serialized.`,
    );
  }
  return (
    utf8Encoder.encode(key).byteLength +
    utf8Encoder.encode(valueJson).byteLength
  );
};

export const isQuotaBrowserError = (error: unknown): boolean => {
  if (error instanceof QuotaExceededError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  // Known browser patterns: "QuotaExceededError", "quota_bytes", "quota_bytes_per_item", "max_items".
  // "quota" subsumes all quota_* variants; "max_items" is the only independent pattern.
  const normalized = `${error.name}:${error.message}`.toLowerCase();
  return normalized.includes('quota') || normalized.includes('max_items');
};

export const validateSyncStorageCommitQuota = (
  state: SyncStorageBackendState,
  generation: number,
  chunks: string[],
  manifest: SyncStorageManifest,
  resolveChunkKey: (generation: number, index: number) => string,
  manifestStorageKey: string,
): void => {
  const pendingItems: { key: string; value: unknown }[] = chunks.map(
    (chunkValue, chunkIndex) => {
      return {
        key: resolveChunkKey(generation, chunkIndex),
        value: chunkValue,
      };
    },
  );
  pendingItems.push({
    key: manifestStorageKey,
    value: manifest,
  });

  if (pendingItems.length > state.maxItems) {
    throw new QuotaExceededError(
      `syncStorage snapshot requires ${pendingItems.length} items but maxItems is ${state.maxItems}.`,
    );
  }

  let totalBytes = 0;
  for (const pendingItem of pendingItems) {
    const itemBytes = computeSyncStorageItemBytes(
      pendingItem.key,
      pendingItem.value,
    );
    if (itemBytes > state.maxItemBytes) {
      throw new QuotaExceededError(
        `syncStorage item "${pendingItem.key}" requires ${itemBytes} bytes but maxItemBytes is ${state.maxItemBytes}.`,
      );
    }
    totalBytes += itemBytes;
  }

  if (totalBytes > state.maxTotalBytes) {
    throw new QuotaExceededError(
      `syncStorage snapshot requires ${totalBytes} bytes but maxTotalBytes is ${state.maxTotalBytes}.`,
    );
  }
};
