import { ConfigurationError } from '../../../errors/index.js';
import type { IndexedDBConfig } from '../../../types.js';

export interface ParsedIndexedDBConfig {
  databaseName: string;
  objectStoreName: string;
  version: number;
}

const ensureNonEmptyString = (value: string, optionName: string): void => {
  if (value.trim().length === 0) {
    throw new ConfigurationError(`${optionName} must be a non-empty string.`);
  }
};

export const parseIndexedDBConfig = (
  config?: IndexedDBConfig,
): ParsedIndexedDBConfig => {
  const databaseName = config?.databaseName ?? 'frostpillar';
  const objectStoreName = config?.objectStoreName ?? 'frostpillar';
  const version = config?.version ?? 1;

  ensureNonEmptyString(databaseName, 'indexedDB.databaseName');
  ensureNonEmptyString(objectStoreName, 'indexedDB.objectStoreName');
  if (objectStoreName === '_meta') {
    throw new ConfigurationError(
      'indexedDB.objectStoreName must not be "_meta" because it is reserved for internal metadata.',
    );
  }
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new ConfigurationError(
      'indexedDB.version must be a positive safe integer.',
    );
  }

  return {
    databaseName,
    objectStoreName,
    version,
  };
};
