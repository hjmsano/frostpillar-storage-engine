import type {
  AutoCommitConfig,
  BTreeJSON,
  OpfsConfig,
} from '../../../types.js';
import { StorageEngineError, UnsupportedBackendError } from '../../../errors/index.js';
import { parseAutoCommitConfig } from '../../config/config.shared.js';
import { AsyncDurableAutoCommitController } from '../../backend/asyncDurableAutoCommitController.js';
import {
  commitOpfsSnapshot,
  detectGlobalOpfs,
  loadOpfsSnapshot,
  openOpfsDirectory,
} from './opfsBackend.js';
import type {
  DurableBackendController,
  OpfsDirectoryHandle,
} from '../../backend/types.js';

const DEFAULT_DIRECTORY_NAME = 'frostpillar';

export interface OpfsBackendControllerSnapshot {
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface OpfsBackendControllerCreateOptions {
  config: OpfsConfig;
  autoCommit?: AutoCommitConfig;
  getSnapshot: () => OpfsBackendControllerSnapshot;
  onAutoCommitError: (error: unknown) => void;
}

export interface OpfsBackendControllerCreateResult {
  controller: OpfsBackendController;
  initialTreeJSON: BTreeJSON<unknown, unknown> | null;
  initialCurrentSizeBytes: number;
}

export class OpfsBackendController extends AsyncDurableAutoCommitController implements DurableBackendController {
  private readonly dir: OpfsDirectoryHandle;
  private readonly getSnapshot: () => OpfsBackendControllerSnapshot;
  private activeData: 'a' | 'b';
  private commitId: number;

  private constructor(
    dir: OpfsDirectoryHandle,
    activeData: 'a' | 'b',
    commitId: number,
    autoCommit: ReturnType<typeof parseAutoCommitConfig>,
    getSnapshot: () => OpfsBackendControllerSnapshot,
    onAutoCommitError: (error: unknown) => void,
  ) {
    super(autoCommit, onAutoCommitError);
    this.dir = dir;
    this.activeData = activeData;
    this.commitId = commitId;
    this.getSnapshot = getSnapshot;
  }

  public static async create(
    options: OpfsBackendControllerCreateOptions,
  ): Promise<OpfsBackendControllerCreateResult> {
    const storageRoot = detectGlobalOpfs();
    if (storageRoot === null) {
      throw new UnsupportedBackendError(
        'opfs (Origin Private File System) is not available in the current runtime environment.',
      );
    }

    const opfsConfig = options.config;
    const directoryName = opfsConfig?.directoryName ?? DEFAULT_DIRECTORY_NAME;
    const autoCommit = parseAutoCommitConfig(options.autoCommit);

    const dir = await openOpfsDirectory(storageRoot, directoryName);
    const loaded = await loadOpfsSnapshot(dir);

    const controller = new OpfsBackendController(
      dir,
      loaded.activeData,
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
      throw new StorageEngineError('OPFS commitId has reached Number.MAX_SAFE_INTEGER.');
    }
    const nextCommitId = this.commitId + 1;
    this.activeData = await commitOpfsSnapshot(
      this.dir,
      this.activeData,
      snapshot.treeJSON,
      nextCommitId,
    );
    this.commitId = nextCommitId;
  }
}
