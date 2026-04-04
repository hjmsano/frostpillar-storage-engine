import { PageCorruptionError, StorageEngineError, toStorageEngineError } from '../../../errors/index.js';
import type { BTreeJSON } from '../../../types.js';
import { parseNonNegativeSafeInteger } from '../../../validation/metadata.js';
import type {
  OpfsDirectoryHandle,
  OpfsManifest,
  OpfsStorageRoot,
} from '../../backend/types.js';

import { computeUtf8ByteLength } from '../../backend/encoding.js';

const OPFS_MAGIC = 'FPOPFS_META';
const OPFS_VERSION_VALUE = 2;
const META_FILE = 'meta.json';
const DATA_FILE_A = 'data-a.json';
const DATA_FILE_B = 'data-b.json';

const isNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'NotFoundError';
};

const isManifestObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

export interface LoadedOpfsSnapshot {
  treeJSON: BTreeJSON<unknown, unknown> | null;
  currentSizeBytes: number;
  commitId: number;
  activeData: 'a' | 'b';
}

// ---------------------------------------------------------------------------
// Global detection
// ---------------------------------------------------------------------------

export const detectGlobalOpfs = (): OpfsStorageRoot | null => {
  try {
    const nav = globalThis as {
      navigator?: { storage?: { getDirectory?: unknown } };
    };
    if (typeof nav.navigator?.storage?.getDirectory === 'function') {
      return nav.navigator.storage as OpfsStorageRoot;
    }
    return null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

export const openOpfsDirectory = async (
  storageRoot: OpfsStorageRoot,
  directoryName: string,
): Promise<OpfsDirectoryHandle> => {
  const root = await storageRoot.getDirectory();
  return root.getDirectoryHandle(directoryName, { create: true });
};

// ---------------------------------------------------------------------------
// Load snapshot
// ---------------------------------------------------------------------------

const parseOpfsManifest = (
  metaText: string,
): { manifest: Record<string, unknown>; commitId: number; activeData: 'a' | 'b' } => {
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(metaText);
  } catch {
    throw new StorageEngineError('OPFS meta.json JSON is malformed.');
  }

  if (!isManifestObject(manifestRaw)) {
    throw new StorageEngineError('OPFS meta.json must be a JSON object.');
  }

  const manifest = manifestRaw;
  if (manifest.magic !== OPFS_MAGIC || manifest.version !== OPFS_VERSION_VALUE) {
    throw new StorageEngineError('OPFS meta.json magic/version mismatch.');
  }
  if (manifest.activeData !== 'a' && manifest.activeData !== 'b') {
    throw new StorageEngineError('OPFS meta.json activeData must be "a" or "b".');
  }
  const commitId = parseNonNegativeSafeInteger(
    manifest.commitId,
    'meta.json commitId',
    'OPFS',
  );

  return { manifest, commitId, activeData: manifest.activeData };
};

interface LoadedOpfsDataFile {
  treeJSON: BTreeJSON<unknown, unknown>;
  rawJsonLength: number;
}

const loadOpfsDataFile = async (
  dir: OpfsDirectoryHandle,
  dataFileName: string,
): Promise<LoadedOpfsDataFile> => {
  let dataText: string;
  try {
    const dataHandle = await dir.getFileHandle(dataFileName, { create: false });
    const dataFile = await dataHandle.getFile();
    dataText = await dataFile.text();
  } catch {
    throw new StorageEngineError(`OPFS active data file "${dataFileName}" not found.`);
  }

  let parsedTreeJSON: unknown;
  try {
    parsedTreeJSON = JSON.parse(dataText);
  } catch {
    throw new StorageEngineError('OPFS data file JSON is malformed.');
  }
  if (typeof parsedTreeJSON !== 'object' || parsedTreeJSON === null || Array.isArray(parsedTreeJSON)) {
    throw new PageCorruptionError('treeJSON must be a non-null plain object.');
  }
  return {
    treeJSON: parsedTreeJSON as BTreeJSON<unknown, unknown>,
    rawJsonLength: computeUtf8ByteLength(dataText),
  };
};

export const loadOpfsSnapshot = async (
  dir: OpfsDirectoryHandle,
): Promise<LoadedOpfsSnapshot> => {
  let metaText: string;
  try {
    const metaHandle = await dir.getFileHandle(META_FILE, { create: false });
    const metaFile = await metaHandle.getFile();
    metaText = await metaFile.text();
  } catch (error: unknown) {
    if (!isNotFoundError(error)) {
      throw toStorageEngineError(error, 'OPFS meta.json read failed');
    }
    return {
      treeJSON: null,
      currentSizeBytes: 0,
      commitId: 0,
      activeData: 'a',
    };
  }

  const { commitId, activeData } = parseOpfsManifest(metaText);
  const dataFileName = activeData === 'a' ? DATA_FILE_A : DATA_FILE_B;
  const { treeJSON, rawJsonLength } = await loadOpfsDataFile(dir, dataFileName);
  const currentSizeBytes = rawJsonLength;

  return { treeJSON, currentSizeBytes, commitId, activeData };
};

// ---------------------------------------------------------------------------
// Commit snapshot (ping-pong)
// ---------------------------------------------------------------------------

export const commitOpfsSnapshot = async (
  dir: OpfsDirectoryHandle,
  currentActiveData: 'a' | 'b',
  treeJSON: BTreeJSON<unknown, unknown>,
  commitId: number,
): Promise<'a' | 'b'> => {
  const nextActiveData: 'a' | 'b' = currentActiveData === 'a' ? 'b' : 'a';
  const dataFileName = nextActiveData === 'a' ? DATA_FILE_A : DATA_FILE_B;

  const dataJson = JSON.stringify(treeJSON);

  try {
    // Write to the inactive data file first
    const dataHandle = await dir.getFileHandle(dataFileName, { create: true });
    const dataWritable = await dataHandle.createWritable();
    await dataWritable.write(dataJson);
    await dataWritable.close();

    // Then update meta to point to the newly written file
    const newManifest: OpfsManifest = {
      magic: OPFS_MAGIC,
      version: OPFS_VERSION_VALUE,
      activeData: nextActiveData,
      commitId,
    };

    const metaHandle = await dir.getFileHandle(META_FILE, { create: true });
    const metaWritable = await metaHandle.createWritable();
    await metaWritable.write(JSON.stringify(newManifest));
    await metaWritable.close();
  } catch (error: unknown) {
    throw toStorageEngineError(error, 'OPFS commit failed');
  }

  return nextActiveData;
};
