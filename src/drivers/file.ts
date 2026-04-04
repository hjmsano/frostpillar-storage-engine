import {
  FileBackendController,
} from '../storage/drivers/file/fileBackendController.js';
import type {
  DatastoreDriver,
  FileBackendConfig,
} from '../types.js';

export type FileDriverOptions = FileBackendConfig;

export const fileDriver = (
  options: FileDriverOptions = {},
): DatastoreDriver => {
  return {
    init: (callbacks) => {
      const result = FileBackendController.create({
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
