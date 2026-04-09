import type {
  AutoCommitConfig,
  BTreeJSON,
  LocalStorageConfig,
} from '../../../types.js';
import { UnsupportedBackendError } from '../../../errors/index.js';
import { AsyncDurableAutoCommitController } from '../../backend/asyncDurableAutoCommitController.js';
import { parseAutoCommitConfig } from '../../config/config.shared.js';
import { parseLocalStorageConfig } from './localStorageConfig.js';
import {
  commitLocalStorageSnapshot,
  createLocalStorageBackendState,
  detectGlobalLocalStorage,
  loadLocalStorageSnapshot,
} from './localStorageBackend.js';
import type {
  DurableBackendController,
  LocalStorageBackendState,
} from '../../backend/types.js';

export interface LocalStorageBackendControllerSnapshot {
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface LocalStorageBackendControllerCreateOptions {
  config: LocalStorageConfig;
  autoCommit?: AutoCommitConfig;
  getSnapshot: () => LocalStorageBackendControllerSnapshot;
  onAutoCommitError: (error: unknown) => void;
}

export interface LocalStorageBackendControllerCreateResult {
  controller: LocalStorageBackendController;
  initialTreeJSON: BTreeJSON<unknown, unknown> | null;
  initialCurrentSizeBytes: number;
}

export class LocalStorageBackendController
  extends AsyncDurableAutoCommitController
  implements DurableBackendController
{
  private readonly backend: LocalStorageBackendState;
  private readonly getSnapshot: () => LocalStorageBackendControllerSnapshot;

  private constructor(
    backend: LocalStorageBackendState,
    autoCommit: ReturnType<typeof parseAutoCommitConfig>,
    getSnapshot: () => LocalStorageBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
  ) {
    super(autoCommit, onAutoCommitError);
    this.backend = backend;
    this.getSnapshot = getSnapshot;
  }

  public static create(
    options: LocalStorageBackendControllerCreateOptions,
  ): LocalStorageBackendControllerCreateResult {
    const adapter = detectGlobalLocalStorage();
    if (adapter === null) {
      throw new UnsupportedBackendError(
        'localStorage is not available in the current runtime environment.',
      );
    }

    const lsConfig = parseLocalStorageConfig(options.config);
    const autoCommit = parseAutoCommitConfig(options.autoCommit);

    const backend = createLocalStorageBackendState(
      adapter,
      lsConfig.keyPrefix,
      lsConfig.databaseKey,
      lsConfig.maxChunkChars,
      lsConfig.maxChunks,
    );

    const loaded = loadLocalStorageSnapshot(backend);

    const controller = new LocalStorageBackendController(
      backend,
      autoCommit,
      options.getSnapshot,
      options.onAutoCommitError,
    );

    return {
      controller,
      initialTreeJSON: loaded.treeJSON,
      initialCurrentSizeBytes: loaded.currentSizeBytes,
    };
  }

  protected executeSingleCommit(): Promise<void> {
    const snapshot = this.getSnapshot();
    commitLocalStorageSnapshot(this.backend, snapshot.treeJSON);
    return Promise.resolve();
  }
}
