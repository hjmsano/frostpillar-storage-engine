import { StorageEngineError } from '../../errors/index.js';
import type {
  DatastoreErrorEvent,
  DatastoreErrorListener,
} from '../../types.js';

export const emitAutoCommitErrorToListeners = (
  listeners: Set<DatastoreErrorListener>,
  error: unknown,
): void => {
  const storageError =
    error instanceof StorageEngineError
      ? error
      : new StorageEngineError(
          error instanceof Error
            ? error.message
            : 'Unknown auto-commit storage failure.',
          { cause: error },
        );
  const event: DatastoreErrorEvent = {
    source: 'autoCommit',
    error: storageError,
    occurredAt: Date.now(),
  };

  for (const listener of listeners) {
    try {
      const delivered = listener(event);
      void Promise.resolve(delivered).catch((): void => undefined);
    } catch {
      // listener isolation by contract
    }
  }
};
