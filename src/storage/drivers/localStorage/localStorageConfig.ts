import { ConfigurationError } from '../../../errors/index.js';
import type { LocalStorageConfig } from '../../../types.js';

export interface ParsedLocalStorageConfig {
  keyPrefix: string;
  databaseKey: string;
  maxChunkChars: number;
  maxChunks: number;
}

export const DEFAULT_LOCAL_STORAGE_MAX_CHUNK_CHARS = 32768;
export const DEFAULT_LOCAL_STORAGE_MAX_CHUNKS = 64;

export const parseLocalStorageConfig = (
  config?: LocalStorageConfig,
): ParsedLocalStorageConfig => {
  const keyPrefix = config?.keyPrefix ?? 'frostpillar';
  const databaseKey = config?.databaseKey ?? 'default';
  const maxChunkChars = config?.maxChunkChars ?? DEFAULT_LOCAL_STORAGE_MAX_CHUNK_CHARS;
  const maxChunks = config?.maxChunks ?? DEFAULT_LOCAL_STORAGE_MAX_CHUNKS;

  if (!Number.isSafeInteger(maxChunkChars) || maxChunkChars <= 0) {
    throw new ConfigurationError(
      'localStorage.maxChunkChars must be a positive safe integer.',
    );
  }
  if (!Number.isSafeInteger(maxChunks) || maxChunks <= 0) {
    throw new ConfigurationError(
      'localStorage.maxChunks must be a positive safe integer.',
    );
  }

  return { keyPrefix, databaseKey, maxChunkChars, maxChunks };
};
