import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  PageCorruptionError,
  StorageEngineError,
  toStorageEngineError,
} from '../../../errors/index.js';
import type { BTreeJSON } from '../../../types.js';
import type {
  FileBackendState,
  FileGenerationSnapshot,
  FileSidecarSnapshot,
} from '../../backend/types.js';
import { computeUtf8ByteLength } from '../../backend/encoding.js';
import { RecordKeyIndexBTree } from '../../btree/recordKeyIndexBTree.js';

const writeFsync = (filePath: string, content: string): void => {
  const fd = openSync(filePath, 'w');
  try {
    writeSync(fd, content, null, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const fsyncDirectory = (dirPath: string): void => {
  const fd = openSync(dirPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const SIDE_CAR_MAGIC = 'FPGE_META';
const GENERATION_MAGIC = 'FPGE_DATA';
const FORMAT_VERSION = 2;

const noOpComparator = (): number => 0;

const createEmptyTreeJSON = (): BTreeJSON<unknown, unknown> => {
  const tree = new RecordKeyIndexBTree<unknown, unknown>({
    compareKeys: noOpComparator,
  });
  return tree.toJSON();
};

interface LoadedFileSnapshot {
  currentSizeBytes: number;
  treeJSON: BTreeJSON<unknown, unknown>;
}

const ensureNonNegativeSafeInteger = (
  value: unknown,
  field: string,
): number => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw new PageCorruptionError(
      `${field} must be a non-negative safe integer, got ${String(value)}.`,
    );
  }

  return value;
};

const validateActiveDataFileName = (
  value: unknown,
  baseFileName: string,
): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must be a non-empty string.',
    );
  }

  if (value.includes('/') || value.includes('\\')) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must be a file name without path separators.',
    );
  }

  const expectedPrefix = `${baseFileName}.g.`;
  if (!value.startsWith(expectedPrefix)) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile must follow committed generation file naming.',
    );
  }

  const commitSuffix = value.slice(expectedPrefix.length);
  if (!/^\d+$/.test(commitSuffix)) {
    throw new PageCorruptionError(
      'sidecar.activeDataFile commit suffix must be an unsigned decimal integer.',
    );
  }

  return value;
};

export const writeInitialFileSnapshot = (backend: FileBackendState): void => {
  const generation: FileGenerationSnapshot = {
    magic: GENERATION_MAGIC,
    version: FORMAT_VERSION,
    treeJSON: createEmptyTreeJSON(),
  };
  const activeDataPath = join(backend.directoryPath, backend.activeDataFile);
  const sidecar: FileSidecarSnapshot = {
    magic: SIDE_CAR_MAGIC,
    version: FORMAT_VERSION,
    activeDataFile: backend.activeDataFile,
    commitId: backend.commitId,
  };

  try {
    writeFsync(activeDataPath, JSON.stringify(generation));
    writeFsync(backend.sidecarPath, JSON.stringify(sidecar, null, 2));
  } catch (error) {
    throw toStorageEngineError(
      error,
      'Failed to initialize file backend snapshot',
    );
  }
};

const applySidecarToBackend = (
  backend: FileBackendState,
  parsedSidecar: FileSidecarSnapshot,
): void => {
  if (
    parsedSidecar.magic !== SIDE_CAR_MAGIC ||
    parsedSidecar.version !== FORMAT_VERSION
  ) {
    throw new PageCorruptionError('Invalid sidecar magic/version.');
  }

  backend.activeDataFile = validateActiveDataFileName(
    parsedSidecar.activeDataFile,
    backend.baseFileName,
  );
  backend.commitId = ensureNonNegativeSafeInteger(
    parsedSidecar.commitId,
    'sidecar.commitId',
  );
};

interface LoadedGenerationFile {
  generation: FileGenerationSnapshot;
  treeJsonSizeBytes: number;
}

const loadAndValidateGenerationFile = (
  backend: FileBackendState,
): LoadedGenerationFile => {
  const activeDataPath = join(backend.directoryPath, backend.activeDataFile);
  if (!existsSync(activeDataPath)) {
    throw new PageCorruptionError(
      'Active generation file referenced by sidecar is missing.',
    );
  }

  const generationSource = readFileSync(activeDataPath, 'utf8');
  const parsedGeneration = JSON.parse(
    generationSource,
  ) as FileGenerationSnapshot;
  if (
    parsedGeneration.magic !== GENERATION_MAGIC ||
    parsedGeneration.version !== FORMAT_VERSION
  ) {
    throw new PageCorruptionError('Invalid generation magic/version.');
  }

  const treeJsonSizeBytes = computeUtf8ByteLength(
    JSON.stringify(parsedGeneration.treeJSON),
  );

  return { generation: parsedGeneration, treeJsonSizeBytes };
};

export const loadFileSnapshot = (
  backend: FileBackendState,
): LoadedFileSnapshot => {
  try {
    const sidecarSource = readFileSync(backend.sidecarPath, 'utf8');
    const parsedSidecar = JSON.parse(sidecarSource) as FileSidecarSnapshot;
    applySidecarToBackend(backend, parsedSidecar);
    const validatedGeneration = loadAndValidateGenerationFile(backend);
    const treeJSON = validatedGeneration.generation.treeJSON;
    if (
      typeof treeJSON !== 'object' ||
      treeJSON === null ||
      Array.isArray(treeJSON)
    ) {
      throw new PageCorruptionError(
        'treeJSON must be a non-null plain object.',
      );
    }
    const currentSizeBytes = validatedGeneration.treeJsonSizeBytes;

    return { treeJSON, currentSizeBytes };
  } catch (error) {
    // PageCorruptionError already extends StorageEngineError, so it is passed
    // through unchanged while unknown errors are normalized.
    throw toStorageEngineError(error, 'Failed to load file backend snapshot');
  }
};

export const commitFileBackendSnapshot = (
  backend: FileBackendState,
  treeJSON: BTreeJSON<unknown, unknown>,
): void => {
  if (backend.commitId >= Number.MAX_SAFE_INTEGER) {
    throw new StorageEngineError(
      'File backend commitId has reached Number.MAX_SAFE_INTEGER.',
    );
  }
  const nextCommitId = backend.commitId + 1;
  const nextActiveDataFile = `${backend.baseFileName}.g.${nextCommitId}`;
  const generationTempPath = join(
    backend.directoryPath,
    `${nextActiveDataFile}.tmp`,
  );
  const generationPath = join(backend.directoryPath, nextActiveDataFile);
  const sidecarTempPath = `${backend.sidecarPath}.tmp`;

  const generation: FileGenerationSnapshot = {
    magic: GENERATION_MAGIC,
    version: FORMAT_VERSION,
    treeJSON,
  };
  const sidecar: FileSidecarSnapshot = {
    magic: SIDE_CAR_MAGIC,
    version: FORMAT_VERSION,
    activeDataFile: nextActiveDataFile,
    commitId: nextCommitId,
  };

  const previousActiveDataFile = backend.activeDataFile;

  try {
    writeFsync(generationTempPath, JSON.stringify(generation));
    renameSync(generationTempPath, generationPath);

    writeFsync(sidecarTempPath, JSON.stringify(sidecar, null, 2));
    renameSync(sidecarTempPath, backend.sidecarPath);

    fsyncDirectory(backend.directoryPath);

    backend.activeDataFile = nextActiveDataFile;
    backend.commitId = nextCommitId;
  } catch (error) {
    throw toStorageEngineError(error, 'File commit failed');
  }

  if (previousActiveDataFile !== nextActiveDataFile) {
    const previousPath = join(backend.directoryPath, previousActiveDataFile);
    try {
      if (existsSync(previousPath)) {
        unlinkSync(previousPath);
      }
    } catch {
      // Best-effort cleanup: failing to delete a stale generation file
      // does not compromise data integrity since the sidecar already
      // points to the new generation.
    }
  }
};
