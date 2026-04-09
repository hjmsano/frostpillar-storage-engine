import type { BTreeJSON, CapacityPolicy } from '../../types.js';

export interface CapacityState {
  maxSizeBytes: number;
  policy: CapacityPolicy;
}

export interface FileAutoCommitState {
  frequency: 'immediate' | 'scheduled';
  intervalMs: number | null;
  maxPendingBytes: number | null;
}

export type IntervalTimerHandle = ReturnType<typeof setInterval>;

export interface FileGenerationSnapshot {
  magic: string;
  version: number;
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface FileSidecarSnapshot {
  magic: string;
  version: number;
  activeDataFile: string;
  commitId: number;
}

export interface FileBackendState {
  dataFilePath: string;
  directoryPath: string;
  baseFileName: string;
  sidecarPath: string;
  lockPath: string;
  activeDataFile: string;
  commitId: number;
  lockAcquired: boolean;
}

export interface DurableBackendController {
  handleRecordAppended(encodedBytes: number): Promise<void>;
  handleCleared(): Promise<void>;
  commitNow(): Promise<void>;
  close(): Promise<void>;
}

export interface LocalStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalStorageBackendState {
  adapter: LocalStorageAdapter;
  keyPrefix: string;
  databaseKey: string;
  maxChunkChars: number;
  maxChunks: number;
  activeGeneration: number;
  commitId: number;
  activeChunkCount: number;
}

export interface LocalStorageManifest {
  magic: string;
  version: number;
  activeGeneration: number;
  commitId: number;
  chunkCount: number;
}

// ---------------------------------------------------------------------------
// Browser sync storage adapter types (browser.storage.sync / chrome.storage.sync)
// ---------------------------------------------------------------------------

export interface SyncStorageAdapter {
  getItems(keys: string[]): Promise<Record<string, unknown>>;
  setItems(items: Record<string, unknown>): Promise<void>;
  removeItems(keys: string[]): Promise<void>;
}

export interface BrowserSyncStorageAreaPromiseAdapter {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface ChromeRuntimeLastError {
  message?: string;
}

export interface ChromeRuntimeAdapter {
  lastError?: ChromeRuntimeLastError;
}

export interface ChromeSyncStorageAreaCallbackAdapter {
  get(
    keys: string | string[] | null,
    callback: (items: Record<string, unknown>) => void,
  ): void;
  set(items: Record<string, unknown>, callback: () => void): void;
  remove(keys: string | string[], callback: () => void): void;
}

export interface SyncStorageBackendState {
  adapter: SyncStorageAdapter;
  keyPrefix: string;
  databaseKey: string;
  maxChunkChars: number;
  maxChunks: number;
  maxItemBytes: number;
  maxTotalBytes: number;
  maxItems: number;
  activeGeneration: number;
  commitId: number;
  activeChunkCount: number;
}

export interface SyncStorageManifest {
  magic: string;
  version: number;
  activeGeneration: number;
  commitId: number;
  chunkCount: number;
}

// ---------------------------------------------------------------------------
// IndexedDB adapter types (injectable for testing via globalThis.indexedDB)
// ---------------------------------------------------------------------------

export interface IDBRequestHandle<T> {
  result: T;
  onsuccess: ((event: { target: IDBRequestHandle<T> }) => void) | null;
  onerror: ((event: { target: IDBRequestHandle<T> }) => void) | null;
}

export interface IDBTreeRecord {
  magic: string;
  version: number;
  commitId: number;
  treeJSON: BTreeJSON<unknown, unknown>;
}

export interface IDBObjectStoreHandle {
  get(key: string): IDBRequestHandle<IDBTreeRecord | undefined>;
  put(value: IDBTreeRecord, key?: string): IDBRequestHandle<string>;
  clear(): IDBRequestHandle<undefined>;
}

export interface IDBTransactionHandle {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  objectStore(name: string): IDBObjectStoreHandle;
}

export interface IDBDatabaseHandle {
  close(): void;
  createObjectStore(
    name: string,
    options?: { keyPath?: string },
  ): IDBObjectStoreHandle;
  objectStoreNames: { contains(name: string): boolean };
  transaction(storeNames: string[], mode: string): IDBTransactionHandle;
}

export interface IDBOpenRequestHandle {
  result: IDBDatabaseHandle | null;
  error: Error | null;
  onsuccess: ((event: { target: IDBOpenRequestHandle }) => void) | null;
  onerror: ((event: { target: IDBOpenRequestHandle }) => void) | null;
  onupgradeneeded:
    | ((event: {
        target: IDBOpenRequestHandle;
        oldVersion: number;
        newVersion: number;
      }) => void)
    | null;
}

export interface IDBFactoryAdapter {
  open(name: string, version?: number): IDBOpenRequestHandle;
}

// ---------------------------------------------------------------------------
// OPFS adapter types (injectable for testing via globalThis.navigator.storage)
// ---------------------------------------------------------------------------

export interface OpfsFileWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface OpfsFileHandle {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(opts?: {
    keepExistingData?: boolean;
  }): Promise<OpfsFileWritable>;
}

export interface OpfsDirectoryHandle {
  getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<OpfsDirectoryHandle>;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
}

export interface OpfsStorageRoot {
  getDirectory(): Promise<OpfsDirectoryHandle>;
}

export interface OpfsManifest {
  magic: string;
  version: number;
  activeData: 'a' | 'b';
  commitId: number;
}
