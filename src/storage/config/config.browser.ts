import { UnsupportedBackendError } from '../../errors/index.js';
import type { FileBackendConfig } from '../../types.js';
export {
  parseCapacityConfig,
  parseAutoCommitConfig,
} from './config.shared.js';

export const ensureCanonicalPathWithinWorkingDirectory = (
  _targetPath: string,
  _optionName: string,
): void => {
  throw new UnsupportedBackendError(
    'Path canonicalization is unavailable in browser bundle profile "core".',
  );
};

export const resolveFileDataPath = (_config: FileBackendConfig): string => {
  throw new UnsupportedBackendError(
    'File backend path resolution is unavailable in browser bundle profile "core".',
  );
};
