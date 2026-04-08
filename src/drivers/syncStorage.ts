import { SyncStorageBackendController } from '../storage/drivers/syncStorage/syncStorageBackendController.js';
import { parseSyncStorageMaxTotalBytesForBackendLimit } from '../storage/drivers/syncStorage/syncStorageConfig.js';
import type { DatastoreDriver, SyncStorageConfig } from '../types.js';

export type SyncStorageDriverOptions = SyncStorageConfig;

export const syncStorageDriver = (
  options: SyncStorageDriverOptions = {},
): DatastoreDriver => {
  return {
    init: async (callbacks) => {
      const result = await SyncStorageBackendController.create({
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
      return parseSyncStorageMaxTotalBytesForBackendLimit(options);
    },
  };
};
