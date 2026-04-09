import type {
  AutoCommitConfig,
  BTreeJSON,
  IndexedDBConfig,
} from '../../../types.js';
import {
  StorageEngineError,
  UnsupportedBackendError,
  toErrorInstance,
} from '../../../errors/index.js';
import { parseAutoCommitConfig } from '../../config/config.shared.js';
import { parseIndexedDBConfig } from './indexedDBConfig.js';
import { AsyncDurableAutoCommitController } from '../../backend/asyncDurableAutoCommitController.js';
import {
  commitIndexedDBSnapshot,
  detectGlobalIndexedDB,
  loadIndexedDBSnapshot,
  openIndexedDB,
} from './indexedDBBackend.js';
import type {
  DurableBackendController,
  IDBDatabaseHandle,
} from '../../backend/types.js';

export interface IndexedDBBackendControllerSnapshot {
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface IndexedDBBackendControllerCreateOptions {
  config: IndexedDBConfig;
  autoCommit?: AutoCommitConfig;
  getSnapshot: () => IndexedDBBackendControllerSnapshot;
  onAutoCommitError: (error: unknown) => void;
}

export interface IndexedDBBackendControllerCreateResult {
  controller: IndexedDBBackendController;
  initialTreeJSON: BTreeJSON<unknown, unknown> | null;
  initialCurrentSizeBytes: number;
}

export class IndexedDBBackendController
  extends AsyncDurableAutoCommitController
  implements DurableBackendController
{
  private db: IDBDatabaseHandle;
  private readonly objectStoreName: string;
  private readonly getSnapshot: () => IndexedDBBackendControllerSnapshot;
  private commitId: number;

  private constructor(
    db: IDBDatabaseHandle,
    objectStoreName: string,
    commitId: number,
    autoCommit: ReturnType<typeof parseAutoCommitConfig>,
    getSnapshot: () => IndexedDBBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
  ) {
    super(autoCommit, onAutoCommitError);
    this.db = db;
    this.objectStoreName = objectStoreName;
    this.commitId = commitId;
    this.getSnapshot = getSnapshot;
  }

  public static async create(
    options: IndexedDBBackendControllerCreateOptions,
  ): Promise<IndexedDBBackendControllerCreateResult> {
    const factory = detectGlobalIndexedDB();
    if (factory === null) {
      throw new UnsupportedBackendError(
        'indexedDB is not available in the current runtime environment.',
      );
    }

    const idbConfig = parseIndexedDBConfig(options.config);
    const { databaseName, objectStoreName, version } = idbConfig;
    const autoCommit = parseAutoCommitConfig(options.autoCommit);

    const db = await openIndexedDB(
      factory,
      databaseName,
      objectStoreName,
      version,
    );
    let loaded: Awaited<ReturnType<typeof loadIndexedDBSnapshot>>;
    try {
      loaded = await loadIndexedDBSnapshot(db, objectStoreName);
    } catch (error: unknown) {
      try {
        db.close();
      } catch {
        // Preserve the original bootstrap failure as the primary error.
      }
      throw toErrorInstance(
        error,
        'IndexedDB bootstrap failed with a non-Error value.',
      );
    }

    const controller = new IndexedDBBackendController(
      db,
      objectStoreName,
      loaded.commitId,
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
    if (this.commitId >= Number.MAX_SAFE_INTEGER) {
      throw new StorageEngineError(
        'IndexedDB commitId has reached Number.MAX_SAFE_INTEGER.',
      );
    }
    const nextCommitId = this.commitId + 1;
    await commitIndexedDBSnapshot(
      this.db,
      this.objectStoreName,
      snapshot.treeJSON,
      nextCommitId,
    );
    this.commitId = nextCommitId;
  }

  protected onCloseAfterDrain(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}
