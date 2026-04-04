import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ConfigurationError } from '../../errors/index.js';
import type { FileBackendConfig } from '../../types.js';
export {
  parseCapacityConfig,
  parseAutoCommitConfig,
} from './config.shared.js';

const containsPathTraversalToken = (value: string): boolean => {
  return value.includes('..');
};

const hasPathSeparator = (value: string): boolean => {
  return value.includes('/') || value.includes('\\');
};

const isPathWithinBaseDirectory = (
  targetPath: string,
  baseDirectory: string,
): boolean => {
  const relativePath = relative(baseDirectory, targetPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
};

const resolveNearestExistingAncestor = (targetPath: string): string => {
  let currentPath = resolve(targetPath);

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  return currentPath;
};

const resolveCanonicalPathForContainment = (targetPath: string): string => {
  const resolvedTargetPath = resolve(targetPath);
  const nearestExistingAncestor = resolveNearestExistingAncestor(resolvedTargetPath);
  const canonicalAncestor = realpathSync(nearestExistingAncestor);
  const relativeSuffix = relative(nearestExistingAncestor, resolvedTargetPath);

  return resolve(join(canonicalAncestor, relativeSuffix));
};

export const ensureCanonicalPathWithinWorkingDirectory = (
  targetPath: string,
  optionName: string,
): void => {
  const canonicalWorkingDirectory = realpathSync(resolve(process.cwd()));
  const canonicalTargetPath = resolveCanonicalPathForContainment(targetPath);

  if (!isPathWithinBaseDirectory(canonicalTargetPath, canonicalWorkingDirectory)) {
    throw new ConfigurationError(
      `${optionName} must stay within process.cwd().`,
    );
  }
};

const ensureSafeFileNameFragment = (
  value: string,
  optionName: string,
): void => {
  if (hasPathSeparator(value) || containsPathTraversalToken(value)) {
    throw new ConfigurationError(
      `${optionName} must not contain path separators or traversal tokens.`,
    );
  }
};

export const resolveFileDataPath = (config: FileBackendConfig): string => {
  if (config.filePath !== undefined && config.target !== undefined) {
    throw new ConfigurationError(
      'filePath and target cannot be specified together.',
    );
  }

  if (config.filePath !== undefined) {
    const resolvedFilePath = resolve(config.filePath);
    ensureCanonicalPathWithinWorkingDirectory(resolvedFilePath, 'filePath');
    return resolvedFilePath;
  }

  if (config.target === undefined) {
    return resolve('./frostpillar.fpdb');
  }

  if (config.target.kind === 'path') {
    const resolvedFilePath = resolve(config.target.filePath);
    ensureCanonicalPathWithinWorkingDirectory(resolvedFilePath, 'target.filePath');
    return resolvedFilePath;
  }

  const directoryPath = resolve(config.target.directory);
  ensureCanonicalPathWithinWorkingDirectory(directoryPath, 'target.directory');
  const filePrefix = config.target.filePrefix ?? '';
  const fileName = config.target.fileName ?? 'frostpillar';
  ensureSafeFileNameFragment(filePrefix, 'target.filePrefix');
  ensureSafeFileNameFragment(fileName, 'target.fileName');

  const resolvedFilePath = resolve(
    join(directoryPath, `${filePrefix}${fileName}.fpdb`),
  );
  if (!isPathWithinBaseDirectory(resolvedFilePath, directoryPath)) {
    throw new ConfigurationError(
      'Resolved file path must stay within target.directory.',
    );
  }
  return resolvedFilePath;
};
