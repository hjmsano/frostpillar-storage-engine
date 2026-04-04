export { Datastore } from './storage/datastore/Datastore.js';

export type {
  AutoCommitConfig,
  AutoCommitFrequencyInput,
  CapacityConfig,
  CapacityPolicy,
  DatastoreConfig,
  DuplicateKeyPolicy,
  DatastoreDriver,
  DatastoreDriverController,
  DatastoreDriverInitContext,
  DatastoreDriverInitResult,
  DatastoreDriverSnapshot,
  DatastoreErrorEvent,
  DatastoreErrorListener,
  DatastoreKeyDefinition,
  EntryId,
  FileBackendConfig,
  FileTargetByDirectoryConfig,
  FileTargetByPathConfig,
  FileTargetConfig,
  InputRecord,
  IndexedDBConfig,
  KeyedRecord,
  LocalStorageConfig,
  OpfsConfig,
  PersistedRecord,
  RecordPayload,
  SyncStorageConfig,
} from './types.js';

export {
  BinaryFormatError,
  ClosedDatastoreError,
  ConfigurationError,
  DatabaseLockedError,
  FrostpillarError,
  IndexCorruptionError,
  InvalidQueryRangeError,
  PageCorruptionError,
  QuotaExceededError,
  StorageEngineError,
  UnsupportedBackendError,
  ValidationError,
} from './errors/index.js';

export { localStorageDriver } from './drivers/localStorage.js';
export { indexedDBDriver } from './drivers/indexedDB.js';
export { opfsDriver } from './drivers/opfs.js';
export { syncStorageDriver } from './drivers/syncStorage.js';

