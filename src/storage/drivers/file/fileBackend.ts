import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  DatabaseLockedError,
  toStorageEngineError,
} from '../../../errors/index.js';
import type { FileBackendConfig } from '../../../types.js';
import {
  ensureCanonicalPathWithinWorkingDirectory,
  resolveFileDataPath,
} from '../../config/config.node.js';
import type { FileBackendState } from '../../backend/types.js';

type NodeErrorWithCode = Error & { code?: string };

const toNodeErrorCode = (error: unknown): string | undefined => {
  if (error instanceof Error) {
    const nodeError = error as NodeErrorWithCode;
    return nodeError.code;
  }

  return undefined;
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // ESRCH = no such process (genuinely dead).
    // EPERM = process exists but owned by another user — treat as alive.
    const code = (error as NodeErrorWithCode).code;
    if (code === 'ESRCH') {
      return false;
    }
    return true;
  }
};

const tryRecoverStaleLock = (lockPath: string): boolean => {
  try {
    const content = readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(content) as { pid?: unknown };
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) {
      return false; // malformed — conservative, don't remove
    }
    if (isProcessAlive(parsed.pid)) {
      return false; // process is alive — genuine lock
    }
    // PID is dead — stale lock
    unlinkSync(lockPath);
    return true;
  } catch {
    return false; // unreadable — conservative
  }
};

const writeLockFile = (lockPath: string): void => {
  const descriptor = openSync(lockPath, 'wx');
  try {
    const pidContent = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });
    writeSync(descriptor, pidContent, null, 'utf8');
  } finally {
    closeSync(descriptor);
  }
};

const verifyLockOwnership = (lockPath: string): void => {
  try {
    const content = readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(content) as { pid?: unknown };
    if (parsed.pid !== process.pid) {
      throw new DatabaseLockedError(
        'Lock was overtaken by another process during stale lock recovery.',
      );
    }
  } catch (error: unknown) {
    if (error instanceof DatabaseLockedError) {
      throw error;
    }
    throw new DatabaseLockedError(
      'Lock file became unreadable during stale lock recovery.',
    );
  }
};

const acquireFileLock = (lockPath: string): void => {
  // Normal lifecycle: releaseFileLock() removes the lock file on close(), so
  // lock files do not accumulate under normal operation. A lock file persisting
  // after this process exits signals abnormal termination (crash / SIGKILL).
  // That stale file is recovered lazily by tryRecoverStaleLock() the next time
  // any process attempts to acquire the same datastore path — so no proactive
  // sweep is needed and none is performed here.
  try {
    writeLockFile(lockPath);
  } catch (error) {
    const code = toNodeErrorCode(error);
    if (code === 'EEXIST') {
      if (tryRecoverStaleLock(lockPath)) {
        try {
          writeLockFile(lockPath);
          verifyLockOwnership(lockPath);
          return;
        } catch (retryError: unknown) {
          if (retryError instanceof DatabaseLockedError) {
            throw retryError;
          }
          throw new DatabaseLockedError(
            'Datastore is locked by another process.',
          );
        }
      }
      throw new DatabaseLockedError(
        'Datastore is locked by another process.',
      );
    }

    throw toStorageEngineError(
      error,
      'Failed to acquire file lock.',
    );
  }
};

const cleanupFileTempArtifacts = (backend: FileBackendState): void => {
  try {
    const sidecarTempPath = `${backend.sidecarPath}.tmp`;
    if (existsSync(sidecarTempPath)) {
      unlinkSync(sidecarTempPath);
    }

    const entries = readdirSync(backend.directoryPath);
    const generationPrefix = `${backend.baseFileName}.g.`;
    for (const entry of entries) {
      if (entry.startsWith(generationPrefix) && entry.endsWith('.tmp')) {
        unlinkSync(join(backend.directoryPath, entry));
      }
    }
  } catch (error) {
    throw toStorageEngineError(
      error,
      'Failed to cleanup temporary durability artifacts',
    );
  }
};

export const createFileBackend = (config: FileBackendConfig): FileBackendState => {
  const dataFilePath = resolveFileDataPath(config);
  const directoryPath = dirname(dataFilePath);
  const baseFileName = basename(dataFilePath);
  const sidecarPath = `${dataFilePath}.meta.json`;
  const lockPath = `${dataFilePath}.lock`;

  ensureCanonicalPathWithinWorkingDirectory(
    dataFilePath,
    'resolvedDataFilePath',
  );
  mkdirSync(directoryPath, { recursive: true });
  acquireFileLock(lockPath);

  const backend: FileBackendState = {
    dataFilePath,
    directoryPath,
    baseFileName,
    sidecarPath,
    lockPath,
    activeDataFile: `${baseFileName}.g.0`,
    commitId: 0,
    lockAcquired: true,
  };

  try {
    cleanupFileTempArtifacts(backend);
  } catch (error) {
    releaseFileLock(backend);
    throw error;
  }

  return backend;
};

export const cleanupStaleGenerationFiles = (backend: FileBackendState): void => {
  try {
    const entries = readdirSync(backend.directoryPath);
    const generationPrefix = `${backend.baseFileName}.g.`;
    for (const entry of entries) {
      if (
        entry.startsWith(generationPrefix) &&
        !entry.endsWith('.tmp') &&
        entry !== backend.activeDataFile
      ) {
        unlinkSync(join(backend.directoryPath, entry));
      }
    }
  } catch {
    // Best-effort cleanup: stale generation files do not affect
    // data integrity since the sidecar always points to the active one.
  }
};

export const releaseFileLock = (backend: FileBackendState): void => {
  try {
    if (existsSync(backend.lockPath)) {
      unlinkSync(backend.lockPath);
    }
    backend.lockAcquired = false;
  } catch (error) {
    throw toStorageEngineError(
      error,
      'Failed to release file lock during close()',
    );
  }
};
