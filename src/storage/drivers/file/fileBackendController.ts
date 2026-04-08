import { existsSync } from 'node:fs';
import { ConfigurationError } from '../../../errors/index.js';
import type {
  AutoCommitConfig,
  BTreeJSON,
  FileBackendConfig,
} from '../../../types.js';
import { AsyncDurableAutoCommitController } from '../../backend/asyncDurableAutoCommitController.js';
import { parseAutoCommitConfig } from '../../config/config.shared.js';
import {
  cleanupStaleGenerationFiles,
  createFileBackend,
  releaseFileLock,
} from './fileBackend.js';
import {
  commitFileBackendSnapshot,
  loadFileSnapshot,
  writeInitialFileSnapshot,
} from './fileBackendSnapshot.js';
import type {
  DurableBackendController,
  FileBackendState,
} from '../../backend/types.js';

export interface FileBackendControllerSnapshot {
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface FileBackendControllerCreateOptions {
  config: FileBackendConfig;
  autoCommit?: AutoCommitConfig;
  testHooks?: FileBackendControllerTestHooks;
  getSnapshot: () => FileBackendControllerSnapshot;
  onAutoCommitError: (error: unknown) => void;
}

export interface FileBackendControllerTestHooks {
  beforeCommit?: () => void | Promise<void>;
  afterCommit?: () => void | Promise<void>;
}

interface FileBackendConfigWithLegacyTestHooks extends FileBackendConfig {
  __testHooks?: unknown;
}

export interface FileBackendControllerCreateResult {
  controller: FileBackendController;
  initialTreeJSON: BTreeJSON<unknown, unknown> | null;
  initialCurrentSizeBytes: number;
}

export class FileBackendController
  extends AsyncDurableAutoCommitController
  implements DurableBackendController
{
  private readonly backend: FileBackendState;
  private readonly getSnapshot: () => FileBackendControllerSnapshot;
  private readonly testHooks: FileBackendControllerTestHooks | null;

  private constructor(
    backend: FileBackendState,
    autoCommit: ReturnType<typeof parseAutoCommitConfig>,
    getSnapshot: () => FileBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
    testHooks: FileBackendControllerTestHooks | null,
  ) {
    super(autoCommit, onAutoCommitError);
    this.backend = backend;
    this.getSnapshot = getSnapshot;
    this.testHooks = testHooks;
  }

  public static create(
    options: FileBackendControllerCreateOptions,
  ): FileBackendControllerCreateResult {
    validateNoLegacyTestHooks(options.config);

    const autoCommit = parseAutoCommitConfig(options.autoCommit);
    const backend = createFileBackend(options.config);

    let initialTreeJSON: BTreeJSON<unknown, unknown> | null = null;
    let initialCurrentSizeBytes = 0;

    try {
      if (!existsSync(backend.sidecarPath)) {
        writeInitialFileSnapshot(backend);
      } else {
        const loaded = loadFileSnapshot(backend);
        initialTreeJSON = loaded.treeJSON;
        initialCurrentSizeBytes = loaded.currentSizeBytes;
        cleanupStaleGenerationFiles(backend);
      }
    } catch (error: unknown) {
      if (backend.lockAcquired) {
        releaseFileLock(backend);
      }
      throw error;
    }

    const controller = new FileBackendController(
      backend,
      autoCommit,
      options.getSnapshot,
      options.onAutoCommitError,
      normalizeTestHooks(options.testHooks),
    );
    return {
      controller,
      initialTreeJSON,
      initialCurrentSizeBytes,
    };
  }

  protected async executeSingleCommit(): Promise<void> {
    await this.testHooks?.beforeCommit?.();

    const snapshot = this.getSnapshot();
    commitFileBackendSnapshot(this.backend, snapshot.treeJSON);

    await this.testHooks?.afterCommit?.();
  }

  protected onCloseAfterDrain(): Promise<void> {
    if (this.backend.lockAcquired) {
      releaseFileLock(this.backend);
    }
    return Promise.resolve();
  }
}

const validateNoLegacyTestHooks = (config: FileBackendConfig): void => {
  const withLegacyHooks = config as FileBackendConfigWithLegacyTestHooks;
  if (!('__testHooks' in withLegacyHooks)) {
    return;
  }
  throw new ConfigurationError(
    'config.__testHooks is not supported. Pass testHooks via FileBackendController.create options.',
  );
};

const normalizeTestHooks = (
  testHooks: FileBackendControllerTestHooks | undefined,
): FileBackendControllerTestHooks | null => {
  if (testHooks === undefined) {
    return null;
  }
  return testHooks;
};
