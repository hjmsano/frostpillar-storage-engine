import { PageCorruptionError, StorageEngineError } from '../../../errors/index.js';
import type { BTreeJSON } from '../../../types.js';
import { parseNonNegativeSafeInteger } from '../../../validation/metadata.js';
import type {
  IDBDatabaseHandle,
  IDBFactoryAdapter,
  IDBObjectStoreHandle,
  IDBOpenRequestHandle,
  IDBRequestHandle,
  IDBTransactionHandle,
  IDBTreeRecord,
} from '../../backend/types.js';
import { computeUtf8ByteLength } from '../../backend/encoding.js';

const IDB_MAGIC = 'FPIDB_META';
const IDB_VERSION_VALUE = 2;
const IDB_META_STORE = '_meta';
const IDB_META_KEY = 'config';

export interface LoadedIndexedDBSnapshot {
  treeJSON: BTreeJSON<unknown, unknown> | null;
  currentSizeBytes: number;
  commitId: number;
}

// ---------------------------------------------------------------------------
// Global detection
// ---------------------------------------------------------------------------

export const detectGlobalIndexedDB = (): IDBFactoryAdapter | null => {
  try {
    const g = globalThis as { indexedDB?: IDBFactoryAdapter | null };
    const idb = g.indexedDB;
    if (idb === null || idb === undefined) {
      return null;
    }
    return idb;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Promise wrappers for IDB event-based API
// ---------------------------------------------------------------------------

const idbRequest = <T>(req: IDBRequestHandle<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = (event): void => {
      resolve(event.target.result);
    };
    req.onerror = (event): void => {
      reject(
        new StorageEngineError(
          `IndexedDB request failed: ${String((event.target as { error?: { message?: string } }).error?.message ?? 'unknown')}`,
        ),
      );
    };
  });

const idbTransaction = (tx: IDBTransactionHandle): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = (): void => { resolve(); };
    tx.onerror = (): void => {
      reject(new StorageEngineError('IndexedDB transaction failed.'));
    };
  });

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export const openIndexedDB = (
  factory: IDBFactoryAdapter,
  databaseName: string,
  objectStoreName: string,
  version: number,
): Promise<IDBDatabaseHandle> =>
  new Promise<IDBDatabaseHandle>((resolve, reject) => {
    const request: IDBOpenRequestHandle = factory.open(databaseName, version);

    request.onupgradeneeded = (event): void => {
      const db = event.target.result;
      if (db === null) {
        return;
      }
      if (!db.objectStoreNames.contains(objectStoreName)) {
        db.createObjectStore(objectStoreName);
      }
      if (!db.objectStoreNames.contains(IDB_META_STORE)) {
        db.createObjectStore(IDB_META_STORE);
      }
    };

    request.onsuccess = (event): void => {
      const db = event.target.result;
      if (db === null) {
        reject(new StorageEngineError('IndexedDB open returned null database.'));
        return;
      }
      resolve(db);
    };

    request.onerror = (event): void => {
      reject(
        new StorageEngineError(
          `IndexedDB open failed: ${String((event.target as { error?: { message?: string } }).error?.message ?? 'unknown')}`,
        ),
      );
    };
  });

// ---------------------------------------------------------------------------
// Load snapshot
// ---------------------------------------------------------------------------

export const loadIndexedDBSnapshot = async (
  db: IDBDatabaseHandle,
  _objectStoreName: string,
): Promise<LoadedIndexedDBSnapshot> => {
  const tx: IDBTransactionHandle = db.transaction(
    [IDB_META_STORE],
    'readonly',
  );

  const txDone = idbTransaction(tx);
  const metaStore: IDBObjectStoreHandle = tx.objectStore(IDB_META_STORE);
  const metaRaw = await idbRequest(metaStore.get(IDB_META_KEY));
  await txDone;

  if (metaRaw === null || metaRaw === undefined) {
    return { treeJSON: null, currentSizeBytes: 0, commitId: 0 };
  }

  const meta = metaRaw;
  if (meta.magic !== IDB_MAGIC || meta.version !== IDB_VERSION_VALUE) {
    throw new StorageEngineError('IndexedDB metadata magic/version mismatch.');
  }

  const commitId = parseNonNegativeSafeInteger(
    meta.commitId,
    'meta.commitId',
    'IndexedDB',
  );

  const treeJSON = meta.treeJSON;
  if (typeof treeJSON !== 'object' || treeJSON === null || Array.isArray(treeJSON)) {
    throw new PageCorruptionError('treeJSON must be a non-null plain object.');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(treeJSON);
  } catch (err) {
    throw new PageCorruptionError(
      'Failed to serialize BTree snapshot for size estimation.',
      { cause: err },
    );
  }
  const currentSizeBytes = computeUtf8ByteLength(serialized);

  return { treeJSON, currentSizeBytes, commitId };
};

// ---------------------------------------------------------------------------
// Commit snapshot
// ---------------------------------------------------------------------------

export const commitIndexedDBSnapshot = async (
  db: IDBDatabaseHandle,
  _objectStoreName: string,
  treeJSON: BTreeJSON<unknown, unknown>,
  commitId: number,
): Promise<void> => {
  const tx: IDBTransactionHandle = db.transaction(
    [IDB_META_STORE],
    'readwrite',
  );
  const txDone = idbTransaction(tx);

  const metaStore: IDBObjectStoreHandle = tx.objectStore(IDB_META_STORE);

  const meta: IDBTreeRecord = {
    magic: IDB_MAGIC,
    version: IDB_VERSION_VALUE,
    commitId,
    treeJSON,
  };
  metaStore.put(meta, IDB_META_KEY);

  await txDone;
};
