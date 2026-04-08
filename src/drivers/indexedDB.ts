import { IndexedDBBackendController } from '../storage/drivers/IndexedDB/indexedDBBackendController.js';
import type { DatastoreDriver, IndexedDBConfig } from '../types.js';

export type IndexedDBDriverOptions = IndexedDBConfig;

export const indexedDBDriver = (
  options: IndexedDBDriverOptions = {},
): DatastoreDriver => {
  return {
    init: async (callbacks) => {
      const result = await IndexedDBBackendController.create({
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
  };
};
