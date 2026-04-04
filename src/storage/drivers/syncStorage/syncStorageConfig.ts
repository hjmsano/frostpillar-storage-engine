import { ConfigurationError } from '../../../errors/index.js';
import type { SyncStorageConfig } from '../../../types.js';

export interface ParsedSyncStorageConfig {
  keyPrefix: string;
  databaseKey: string;
  maxChunkChars: number;
  maxChunks: number;
  maxItemBytes: number;
  maxTotalBytes: number;
  maxItems: number;
}

export const DEFAULT_SYNC_STORAGE_MAX_TOTAL_BYTES = 102400;

export const parseSyncStorageMaxTotalBytesForBackendLimit = (
  config?: SyncStorageConfig,
): number => {
  const maxTotalBytes = config?.maxTotalBytes ?? DEFAULT_SYNC_STORAGE_MAX_TOTAL_BYTES;
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes <= 0) {
    throw new ConfigurationError(
      'syncStorage.maxTotalBytes must be a positive safe integer.',
    );
  }
  return maxTotalBytes;
};

export const parseSyncStorageConfig = (
  config?: SyncStorageConfig,
): ParsedSyncStorageConfig => {
  const keyPrefix = config?.keyPrefix ?? 'frostpillar';
  const databaseKey = config?.databaseKey ?? 'default';
  const maxChunkChars = config?.maxChunkChars ?? 6000;
  const maxChunks = config?.maxChunks ?? 511;
  const maxItemBytes = config?.maxItemBytes ?? 8192;
  const maxTotalBytes = parseSyncStorageMaxTotalBytesForBackendLimit(config);
  const maxItems = config?.maxItems ?? 512;

  if (!Number.isSafeInteger(maxChunkChars) || maxChunkChars <= 0) {
    throw new ConfigurationError(
      'syncStorage.maxChunkChars must be a positive safe integer.',
    );
  }
  if (!Number.isSafeInteger(maxChunks) || maxChunks <= 0) {
    throw new ConfigurationError(
      'syncStorage.maxChunks must be a positive safe integer.',
    );
  }
  if (!Number.isSafeInteger(maxItemBytes) || maxItemBytes <= 0) {
    throw new ConfigurationError(
      'syncStorage.maxItemBytes must be a positive safe integer.',
    );
  }
  if (!Number.isSafeInteger(maxItems) || maxItems <= 0) {
    throw new ConfigurationError(
      'syncStorage.maxItems must be a positive safe integer.',
    );
  }
  if (maxChunks + 1 > maxItems) {
    throw new ConfigurationError(
      'syncStorage.maxChunks + 1 (manifest item) must be <= syncStorage.maxItems.',
    );
  }

  return {
    keyPrefix,
    databaseKey,
    maxChunkChars,
    maxChunks,
    maxItemBytes,
    maxTotalBytes,
    maxItems,
  };
};
