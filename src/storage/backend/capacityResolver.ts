import { ConfigurationError } from '../../errors/index.js';
import type {
  CapacityConfig,
  DatastoreConfig,
} from '../../types.js';
import { parseCapacityConfig } from '../config/config.shared.js';
import type { CapacityState } from './types.js';

const resolveCapacityConfigWithBackendLimit = (
  config: DatastoreConfig,
): CapacityConfig | undefined => {
  if (config.capacity === undefined) {
    return undefined;
  }

  if (config.capacity.maxSize !== 'backendLimit') {
    return config.capacity;
  }

  if (config.driver === undefined) {
    throw new ConfigurationError(
      'capacity.maxSize "backendLimit" requires a durable driver.',
    );
  }

  if (config.driver.resolveBackendLimitBytes === undefined) {
    throw new ConfigurationError(
      'capacity.maxSize "backendLimit" is not supported by the selected driver.',
    );
  }

  const resolvedMaxSize = config.driver.resolveBackendLimitBytes();
  return {
    ...config.capacity,
    maxSize: resolvedMaxSize,
  };
};

export const resolveCapacityState = (
  config: DatastoreConfig,
): CapacityState | null => {
  const resolvedCapacityConfig = resolveCapacityConfigWithBackendLimit(config);
  return parseCapacityConfig(resolvedCapacityConfig);
};
