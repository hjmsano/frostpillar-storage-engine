import { ValidationError } from '../../errors/index.js';
import type { DatastoreErrorListener } from '../../types.js';

export const addErrorListener = (
  listeners: Set<DatastoreErrorListener>,
  event: string,
  listener: DatastoreErrorListener,
  off: (event: string, listener: DatastoreErrorListener) => void,
): (() => void) => {
  if (event !== 'error') {
    throw new ValidationError('Only "error" event is supported.');
  }
  listeners.add(listener);
  return (): void => {
    off(event, listener);
  };
};

export const removeErrorListener = (
  listeners: Set<DatastoreErrorListener>,
  event: string,
  listener: DatastoreErrorListener,
): void => {
  if (event !== 'error') {
    throw new ValidationError('Only "error" event is supported.');
  }
  listeners.delete(listener);
};
