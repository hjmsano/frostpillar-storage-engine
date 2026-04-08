import { LocalStorageBackendController } from '../storage/drivers/localStorage/localStorageBackendController.js';
import { parseLocalStorageConfig } from '../storage/drivers/localStorage/localStorageConfig.js';
import type { DatastoreDriver, LocalStorageConfig } from '../types.js';

export type LocalStorageDriverOptions = LocalStorageConfig;

export const localStorageDriver = (
  options: LocalStorageDriverOptions = {},
): DatastoreDriver => {
  return {
    init: (callbacks) => {
      const result = LocalStorageBackendController.create({
        config: options,
        autoCommit: callbacks.autoCommit,
        getSnapshot: callbacks.getSnapshot,
        onAutoCommitError: callbacks.onAutoCommitError,
      });
      return {
        controller: result.controller,
        initialTreeJSON: result.initialTreeJSON,
        initialCurrentSizeBytes: result.initialCurrentSizeBytes,
      };
    },
    resolveBackendLimitBytes: () => {
      const { maxChunkChars, maxChunks } = parseLocalStorageConfig(options);
      return maxChunkChars * maxChunks;
    },
  };
};
