import type { BTreeJSON, EntryId } from '@frostpillar/frostpillar-btree';
export type { BTreeJSON, EntryId };
export type ByteSizeInput =
  | number
  | `${number}B`
  | `${number}KB`
  | `${number}MB`
  | `${number}GB`
  | 'backendLimit';
export type AutoCommitFrequencyInput =
  | 'immediate'
  | number
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}h`;

export type SupportedValue = string | number | boolean | null;
export type SupportedNestedValue =
  | SupportedValue
  | { [key in string]: SupportedNestedValue };
export type RecordPayload = { [key in string]: SupportedNestedValue };

export interface DatastoreKeyDefinition<TKey = unknown, TInput = TKey> {
  normalize: (value: TInput, fieldName: string) => TKey;
  compare: (left: TKey, right: TKey) => number;
  serialize: (key: TKey) => string;
  deserialize: (serialized: string) => TKey;
}

export interface KeyedRecord<TKey = unknown> {
  readonly _id: EntryId;
  readonly key: TKey;
  readonly payload: RecordPayload;
}

export interface PersistedRecord {
  payload: RecordPayload;
  sizeBytes: number;
}

export interface InputRecord<TKeyInput = unknown> {
  key: TKeyInput;
  payload: RecordPayload;
}

export interface KeyRangeQuery<TKeyInput = unknown> {
  start: TKeyInput;
  end: TKeyInput;
}

export type CapacityPolicy = 'strict' | 'turnover';

export type DuplicateKeyPolicy = 'allow' | 'replace' | 'reject';

export interface CapacityConfig {
  maxSize: ByteSizeInput;
  policy?: CapacityPolicy;
}

export interface AutoCommitConfig {
  frequency?: AutoCommitFrequencyInput;
  maxPendingBytes?: number;
}

export interface PayloadLimitsConfig {
  maxDepth?: number;
  maxKeyBytes?: number;
  maxStringBytes?: number;
  maxKeysPerObject?: number;
  maxTotalKeys?: number;
  maxTotalBytes?: number;
}

export interface IndexConfig {
  autoScale?: boolean;
  maxLeafEntries?: number;
  maxBranchChildren?: number;
}

export interface DatastoreCommonConfig {
  key?: DatastoreKeyDefinition<unknown, unknown>;
  capacity?: CapacityConfig;
  autoCommit?: AutoCommitConfig;
  duplicateKeys?: DuplicateKeyPolicy;
  index?: IndexConfig;
  skipPayloadValidation?: boolean;
  payloadLimits?: PayloadLimitsConfig;
}

export interface FileTargetByPathConfig {
  kind: 'path';
  filePath: string;
  directory?: never;
  fileName?: never;
  filePrefix?: never;
}

export interface FileTargetByDirectoryConfig {
  kind: 'directory';
  directory: string;
  fileName?: string;
  filePrefix?: string;
  filePath?: never;
}

export type FileTargetConfig =
  | FileTargetByPathConfig
  | FileTargetByDirectoryConfig;

export interface FileBackendConfig {
  target?: FileTargetConfig;
  filePath?: string;
}

export interface OpfsConfig {
  directoryName?: string;
}

export interface IndexedDBConfig {
  databaseName?: string;
  objectStoreName?: string;
  version?: number;
}

export interface LocalStorageConfig {
  keyPrefix?: string;
  databaseKey?: string;
  maxChunkChars?: number;
  maxChunks?: number;
}

export interface SyncStorageConfig {
  keyPrefix?: string;
  databaseKey?: string;
  maxChunkChars?: number;
  maxChunks?: number;
  maxItemBytes?: number;
  maxTotalBytes?: number;
  maxItems?: number;
}

export interface DatastoreDriverSnapshot {
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface DatastoreDriverController {
  handleRecordAppended(encodedBytes: number): Promise<void>;
  handleCleared(): Promise<void>;
  commitNow(): Promise<void>;
  close(): Promise<void>;
}

export interface DatastoreDriverInitResult {
  controller: DatastoreDriverController;
  initialTreeJSON: BTreeJSON<unknown, unknown> | null;
  initialCurrentSizeBytes: number;
}

export interface DatastoreDriverInitContext {
  getSnapshot: () => DatastoreDriverSnapshot;
  autoCommit?: AutoCommitConfig;
  onAutoCommitError: (error: unknown) => void;
}

export interface DatastoreDriver {
  init(
    context: DatastoreDriverInitContext,
  ): DatastoreDriverInitResult | Promise<DatastoreDriverInitResult>;
  resolveBackendLimitBytes?: () => number;
}

export interface DatastoreConfig extends DatastoreCommonConfig {
  driver?: DatastoreDriver;
}

export interface DatastoreErrorEvent {
  source: 'autoCommit';
  error: Error;
  occurredAt: number;
}

export type DatastoreErrorListener = (
  event: DatastoreErrorEvent,
) => void | Promise<void>;
