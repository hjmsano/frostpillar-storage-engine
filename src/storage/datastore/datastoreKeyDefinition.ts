import {
  ConfigurationError,
  ValidationError,
} from '../../errors/index.js';
import type {
  DatastoreConfig,
  DatastoreKeyDefinition,
} from '../../types.js';

const ensureNonEmptyStringKey = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string.`);
  }
  if (value.length === 0) {
    throw new ValidationError(`${fieldName} must be a non-empty string.`);
  }
  return value;
};

export const DEFAULT_STRING_KEY_DEFINITION: DatastoreKeyDefinition<
string,
string
> = {
  normalize: (value: string, fieldName: string): string => {
    return ensureNonEmptyStringKey(value, fieldName);
  },
  compare: (left: string, right: string): number => {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  },
  serialize: (key: string): string => {
    return ensureNonEmptyStringKey(key, 'key');
  },
  deserialize: (serialized: string): string => {
    return ensureNonEmptyStringKey(serialized, 'serialized key');
  },
};

const validateKeyDefinition = (
  definition: DatastoreKeyDefinition<unknown, unknown>,
): void => {
  if (typeof definition.normalize !== 'function') {
    throw new ConfigurationError('config.key.normalize must be a function.');
  }
  if (typeof definition.compare !== 'function') {
    throw new ConfigurationError('config.key.compare must be a function.');
  }
  if (typeof definition.serialize !== 'function') {
    throw new ConfigurationError('config.key.serialize must be a function.');
  }
  if (typeof definition.deserialize !== 'function') {
    throw new ConfigurationError('config.key.deserialize must be a function.');
  }
};

export const resolveKeyDefinition = (
  config: DatastoreConfig,
): DatastoreKeyDefinition<unknown, unknown> => {
  if (config.key === undefined) {
    return DEFAULT_STRING_KEY_DEFINITION as DatastoreKeyDefinition<unknown, unknown>;
  }
  validateKeyDefinition(config.key);
  return config.key;
};

export const readRawInsertKey = (
  rawRecord: Record<string, unknown>,
): { rawKey: unknown; keyFieldName: string } => {
  if (Object.prototype.hasOwnProperty.call(rawRecord, 'key')) {
    return {
      rawKey: rawRecord.key,
      keyFieldName: 'key',
    };
  }
  throw new ValidationError('Record must include "key".');
};
