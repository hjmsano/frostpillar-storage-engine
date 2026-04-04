import { StorageEngineError } from '../errors/index.js';

export const parseNonNegativeSafeInteger = (
  value: unknown,
  fieldName: string,
  backendName: string,
): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StorageEngineError(
      `${backendName} ${fieldName} must be a non-negative safe integer.`,
    );
  }
  return value;
};
