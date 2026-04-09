import { ConfigurationError, toErrorInstance } from '../../errors/index.js';
import type {
  DatastoreConfig,
  DatastoreDriverInitResult,
  DatastoreErrorListener,
  PersistedRecord,
} from '../../types.js';
import { emitAutoCommitErrorToListeners } from '../backend/autoCommit.js';
import type { ResolvedIndexConfig } from '../config/config.shared.js';
import type { DurableBackendController } from '../backend/types.js';
import {
  RecordKeyIndexBTree,
  type BTreeJSON,
  type DuplicateKeyPolicy,
} from '../btree/recordKeyIndexBTree.js';
import { backfillMissingSizeBytes } from './datastoreHelpers.js';
import { isPromiseLike } from './datastoreRuntime.js';

export interface BackendInitState {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  readonly keyDefinition: { compare: (a: unknown, b: unknown) => number };
  readonly duplicateKeyPolicy: DuplicateKeyPolicy;
  readonly indexConfig: ResolvedIndexConfig;
  readonly errorListeners: Set<DatastoreErrorListener>;
  backendController: DurableBackendController | null;
  currentSizeBytes: number;
  pendingInit: Promise<void> | null;
  pendingInitError: Error | null;
}

export const applyBackendInitResult = (
  state: BackendInitState,
  result: DatastoreDriverInitResult,
): void => {
  if (result.initialTreeJSON !== null) {
    state.keyIndex = RecordKeyIndexBTree.fromJSON<unknown, PersistedRecord>(
      result.initialTreeJSON as BTreeJSON<unknown, PersistedRecord>,
      {
        compareKeys: (a: unknown, b: unknown) =>
          state.keyDefinition.compare(a, b),
        duplicateKeys: state.duplicateKeyPolicy,
        ...state.indexConfig,
      },
    );
    backfillMissingSizeBytes(state.keyIndex);
  }
  state.currentSizeBytes = result.initialCurrentSizeBytes;
  state.backendController = result.controller;
};

export const initBackend = (
  state: BackendInitState,
  config: DatastoreConfig,
): void => {
  if (config.driver === undefined) {
    if (config.autoCommit !== undefined) {
      throw new ConfigurationError('autoCommit requires a durable driver.');
    }
    return;
  }
  const backendInit = config.driver.init({
    getSnapshot: () => ({ treeJSON: state.keyIndex.toJSON() }),
    autoCommit: config.autoCommit,
    onAutoCommitError: (err: unknown) => {
      emitAutoCommitErrorToListeners(state.errorListeners, err);
    },
  });
  if (!isPromiseLike(backendInit)) {
    applyBackendInitResult(state, backendInit);
    return;
  }
  state.pendingInit = Promise.resolve(backendInit)
    .then((r) => {
      applyBackendInitResult(state, r);
    })
    .catch((err: unknown) => {
      state.pendingInitError = toErrorInstance(
        err,
        'Datastore backend initialization failed with a non-Error value.',
      );
    })
    .finally(() => {
      state.pendingInit = null;
    });
};
