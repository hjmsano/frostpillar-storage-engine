interface FrostpillarErrorOptions {
  cause?: unknown;
}

export class FrostpillarError extends Error {
  declare cause?: unknown;
  constructor(message: string, options?: FrostpillarErrorOptions) {
    super(message);
    this.name = new.target.name;
    if (options !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class ValidationError extends FrostpillarError {}

export class DuplicateKeyError extends ValidationError {}

export class InvalidQueryRangeError extends FrostpillarError {}

export class ConfigurationError extends FrostpillarError {}

export class UnsupportedBackendError extends FrostpillarError {}

export class ClosedDatastoreError extends FrostpillarError {}

export class StorageEngineError extends FrostpillarError {}

export class DatabaseLockedError extends StorageEngineError {}

export class BinaryFormatError extends StorageEngineError {}

export class PageCorruptionError extends StorageEngineError {}

export class IndexCorruptionError extends StorageEngineError {}

export class QuotaExceededError extends FrostpillarError {}

export const toStorageEngineError = (
  error: unknown,
  fallbackMessage: string,
): StorageEngineError => {
  if (error instanceof StorageEngineError) {
    return error;
  }

  if (error instanceof Error) {
    return new StorageEngineError(`${fallbackMessage}: ${error.message}`, {
      cause: error,
    });
  }

  return new StorageEngineError(fallbackMessage, { cause: error });
};

export const toErrorInstance = (
  error: unknown,
  fallbackMessage: string,
): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(fallbackMessage, { cause: error });
};

type AggregateErrorConstructorLike = new (
  errors: Iterable<unknown>,
  message?: string,
) => Error;

interface ErrorWithErrors extends Error {
  errors?: Error[];
}

const readAggregateErrorConstructor =
  (): AggregateErrorConstructorLike | null => {
    const candidate = (globalThis as { AggregateError?: unknown })
      .AggregateError;
    if (typeof candidate !== 'function') {
      return null;
    }
    return candidate as AggregateErrorConstructorLike;
  };

export const createAggregateError = (
  errors: Error[],
  message: string,
): Error => {
  const aggregateErrorConstructor = readAggregateErrorConstructor();
  if (aggregateErrorConstructor !== null) {
    return new aggregateErrorConstructor(errors, message);
  }
  const fallbackError: ErrorWithErrors = new Error(message);
  fallbackError.errors = errors;
  return fallbackError;
};
