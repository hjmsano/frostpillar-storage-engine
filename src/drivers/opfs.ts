import {
  OpfsBackendController,
} from '../storage/drivers/opfs/opfsBackendController.js';
import type {
  DatastoreDriver,
  OpfsConfig,
} from '../types.js';

export type OpfsDriverOptions = OpfsConfig;

export const opfsDriver = (
  options: OpfsDriverOptions = {},
): DatastoreDriver => {
  return {
    init: async (callbacks) => {
      const result = await OpfsBackendController.create({
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
