import type {
  AutoCommitConfig,
  BTreeJSON,
  SyncStorageConfig,
} from '../../../types.js';
import { UnsupportedBackendError } from '../../../errors/index.js';
import { parseAutoCommitConfig } from '../../config/config.shared.js';
import { parseSyncStorageConfig } from './syncStorageConfig.js';
import { AsyncDurableAutoCommitController } from '../../backend/asyncDurableAutoCommitController.js';
import {
  commitSyncStorageSnapshot,
  createSyncStorageBackendState,
  detectGlobalSyncStorage,
  loadSyncStorageSnapshot,
} from './syncStorageBackend.js';
import type {
  DurableBackendController,
  SyncStorageBackendState,
} from '../../backend/types.js';

export interface SyncStorageBackendControllerSnapshot {
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface SyncStorageBackendControllerCreateOptions {
  config: SyncStorageConfig;
  autoCommit?: AutoCommitConfig;
  getSnapshot: () => SyncStorageBackendControllerSnapshot;
  onAutoCommitError: (error: unknown) => void;
}

export interface SyncStorageBackendControllerCreateResult {
  controller: SyncStorageBackendController;
  initialTreeJSON: BTreeJSON<unknown, unknown> | null;
  initialCurrentSizeBytes: number;
}

export class SyncStorageBackendController extends AsyncDurableAutoCommitController implements DurableBackendController {
  private readonly backend: SyncStorageBackendState;
  private readonly getSnapshot: () => SyncStorageBackendControllerSnapshot;

  private constructor(
    backend: SyncStorageBackendState,
    autoCommit: ReturnType<typeof parseAutoCommitConfig>,
    getSnapshot: () => SyncStorageBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
  ) {
    super(autoCommit, onAutoCommitError);
    this.backend = backend;
    this.getSnapshot = getSnapshot;
  }

  public static async create(
    options: SyncStorageBackendControllerCreateOptions,
  ): Promise<SyncStorageBackendControllerCreateResult> {
    const adapter = detectGlobalSyncStorage();
    if (adapter === null) {
      throw new UnsupportedBackendError(
        'browser sync storage is not available in the current runtime environment.',
      );
    }

    const syncConfig = parseSyncStorageConfig(options.config);
    const autoCommit = parseAutoCommitConfig(options.autoCommit);

    const backend = createSyncStorageBackendState(
      adapter,
      syncConfig.keyPrefix,
      syncConfig.databaseKey,
      syncConfig.maxChunkChars,
      syncConfig.maxChunks,
      syncConfig.maxItemBytes,
      syncConfig.maxTotalBytes,
      syncConfig.maxItems,
    );
    const loaded = await loadSyncStorageSnapshot(backend);

    const controller = new SyncStorageBackendController(
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

  protected async executeSingleCommit(): Promise<void> {
    const snapshot = this.getSnapshot();
    await commitSyncStorageSnapshot(
      this.backend,
      snapshot.treeJSON,
    );
  }
}
