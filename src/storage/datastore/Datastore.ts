import { InvalidQueryRangeError } from '../../errors/index.js';
import { toPublicRecord } from '../record/ordering.js';
import type {
  DatastoreConfig,
  DatastoreErrorListener,
  EntryId,
  InputRecord,
  KeyedRecord,
  PersistedRecord,
  RecordPayload,
  DatastoreKeyDefinition,
} from '../../types.js';
import { AsyncMutex } from '../backend/asyncMutex.js';
import { resolveCapacityState } from '../backend/capacityResolver.js';
import {
  parseIndexConfig,
  parseDuplicateKeyConfig,
  parsePayloadLimitsConfig,
} from '../config/config.shared.js';
import { DatastoreLifecycle } from './datastoreLifecycle.js';
import {
  closeDatastore,
  buildCloseOptions,
  type DatastoreCloseableState,
} from './datastoreClose.js';
import type { DurableBackendController } from '../backend/types.js';
import {
  RecordKeyIndexBTree,
  normalizeComparatorResult,
  type DuplicateKeyPolicy,
} from '../btree/recordKeyIndexBTree.js';
import { resolveKeyDefinition } from './datastoreKeyDefinition.js';
import { executePutSingle, type PutContext } from './datastorePut.js';
import { executePutManyStrict } from './datastorePutStrict.js';
import { runWithOpen, runWithOpenExclusive } from './datastoreRuntime.js';
import {
  putManyInMemory,
  getManyRecords,
  getDistinctKeys,
} from './datastoreHelpers.js';
import {
  executeGetById,
  executeUpdateById,
  executeReplaceById,
  executeDeleteById,
  executeDeleteByIds,
} from './datastoreIdOps.js';
import { initBackend, type BackendInitState } from './datastoreInit.js';
import {
  deleteSingle as execDeleteSingle,
  deleteManyInMemory as execDeleteManyInMemory,
} from './datastoreDelete.js';
import { addErrorListener, removeErrorListener } from './datastoreEvents.js';

export class Datastore {
  private readonly errorListeners: Set<DatastoreErrorListener>;
  private keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  private readonly keyDefinition: DatastoreKeyDefinition<unknown, unknown>;
  private readonly duplicateKeyPolicy: DuplicateKeyPolicy;
  private readonly indexConfig: ReturnType<typeof parseIndexConfig>;
  private readonly capacityState: PutContext['capacityState'];
  private readonly skipPayloadValidation: boolean;
  private readonly payloadLimits: PutContext['payloadLimits'];
  private readonly lifecycle: DatastoreLifecycle;
  private readonly writeMutex: AsyncMutex;
  private currentSizeBytes: number;
  private backendController: DurableBackendController | null;
  /** @internal */ pendingInit: Promise<void> | null;
  /** @internal */ pendingInitError: Error | null;

  constructor(config: DatastoreConfig) {
    this.errorListeners = new Set<DatastoreErrorListener>();
    this.keyDefinition = resolveKeyDefinition(config);
    const dk = parseDuplicateKeyConfig(config.duplicateKeys);
    this.duplicateKeyPolicy = dk;
    this.indexConfig = parseIndexConfig(config.index);
    this.keyIndex = new RecordKeyIndexBTree<unknown, PersistedRecord>({
      compareKeys: (a: unknown, b: unknown): number =>
        this.keyDefinition.compare(a, b),
      duplicateKeys: dk,
      ...this.indexConfig,
    });
    this.capacityState = resolveCapacityState(config);
    this.skipPayloadValidation = config.skipPayloadValidation === true;
    this.payloadLimits = parsePayloadLimitsConfig(config.payloadLimits);
    this.lifecycle = new DatastoreLifecycle();
    this.writeMutex = new AsyncMutex();
    this.currentSizeBytes = 0;
    this.backendController = null;
    this.pendingInit = null;
    this.pendingInitError = null;
    initBackend(this as unknown as BackendInitState, config);
  }

  private ctx(): PutContext {
    return {
      keyIndex: this.keyIndex,
      keyDefinition: this.keyDefinition,
      duplicateKeyPolicy: this.duplicateKeyPolicy,
      capacityState: this.capacityState,
      skipPayloadValidation: this.skipPayloadValidation,
      payloadLimits: this.payloadLimits,
      backendController: this.backendController,
      currentSizeBytes: this.currentSizeBytes,
    };
  }

  private rOpen<T>(op: () => Promise<T> | T): Promise<T> {
    return runWithOpen(this.lifecycle, this, op);
  }

  private rExcl<T>(op: () => Promise<T> | T): Promise<T> {
    return runWithOpenExclusive(this.lifecycle, this.writeMutex, this, op);
  }

  public put(record: InputRecord<unknown>): Promise<void> {
    return this.rExcl(async () => {
      this.currentSizeBytes = await executePutSingle(this.ctx(), record);
    });
  }

  public get(key: unknown): Promise<KeyedRecord<unknown>[]> {
    return this.rOpen(() => {
      const nk = this.keyDefinition.normalize(key, 'key');
      return this.keyIndex
        .rangeQuery(nk, nk)
        .map((e) => toPublicRecord(e.entryId, e.key, e.value));
    });
  }

  public getFirst(key: unknown): Promise<KeyedRecord<unknown> | null> {
    return this.rOpen(() => {
      const e = this.keyIndex.findFirst(
        this.keyDefinition.normalize(key, 'key'),
      );
      return e === null ? null : toPublicRecord(e.entryId, e.key, e.value);
    });
  }

  public getLast(key: unknown): Promise<KeyedRecord<unknown> | null> {
    return this.rOpen(() => {
      const e = this.keyIndex.findLast(
        this.keyDefinition.normalize(key, 'key'),
      );
      return e === null ? null : toPublicRecord(e.entryId, e.key, e.value);
    });
  }

  public delete(key: unknown): Promise<number> {
    return this.rExcl(async () => {
      const r = await execDeleteSingle(this.ctx(), key);
      this.currentSizeBytes = r.currentSizeBytes;
      return r.removedCount;
    });
  }

  public has(key: unknown): Promise<boolean> {
    return this.rOpen(() =>
      this.keyIndex.hasKey(this.keyDefinition.normalize(key, 'key')),
    );
  }

  public getAll(): Promise<KeyedRecord<unknown>[]> {
    return this.rOpen(() =>
      this.keyIndex
        .snapshot()
        .map((e) => toPublicRecord(e.entryId, e.key, e.value)),
    );
  }

  public getRange(
    start: unknown,
    end: unknown,
  ): Promise<KeyedRecord<unknown>[]> {
    return this.rOpen(() => {
      const [ns, ne] = this.normalizeRange(start, end);
      return this.keyIndex
        .rangeQuery(ns, ne)
        .map((e) => toPublicRecord(e.entryId, e.key, e.value));
    });
  }

  public countRange(start: unknown, end: unknown): Promise<number> {
    return this.rOpen(() => {
      const [ns, ne] = this.normalizeRange(start, end);
      return this.keyIndex.count(ns, ne);
    });
  }

  public getMany(keys: unknown[]): Promise<KeyedRecord<unknown>[]> {
    return this.rOpen(() =>
      getManyRecords(this.keyIndex, this.keyDefinition, keys),
    );
  }

  public putMany(records: InputRecord<unknown>[]): Promise<void> {
    return this.rExcl(async () => {
      const c = this.ctx();
      if (c.capacityState === null && c.backendController === null) {
        putManyInMemory(records, c);
        return;
      }
      if (c.capacityState === null || c.capacityState.policy === 'turnover') {
        for (const r of records) {
          this.currentSizeBytes = await executePutSingle(c, r);
          c.currentSizeBytes = this.currentSizeBytes;
        }
        return;
      }
      this.currentSizeBytes = await executePutManyStrict(c, records);
    });
  }

  public deleteMany(keys: unknown[]): Promise<number> {
    return this.rExcl(async () => {
      if (this.backendController === null) {
        const r = execDeleteManyInMemory(this.ctx(), keys);
        this.currentSizeBytes = r.currentSizeBytes;
        return r.totalRemoved;
      }
      let t = 0;
      for (const k of keys) {
        const r = await execDeleteSingle(this.ctx(), k);
        this.currentSizeBytes = r.currentSizeBytes;
        t += r.removedCount;
      }
      return t;
    });
  }

  public clear(): Promise<void> {
    return this.rExcl(async () => {
      this.keyIndex.clear();
      this.currentSizeBytes = 0;
      await this.backendController?.handleCleared();
    });
  }

  public count(): Promise<number> {
    return this.rOpen(() => this.keyIndex.size());
  }
  public keys(): Promise<unknown[]> {
    return this.rOpen(() => getDistinctKeys(this.keyIndex, this.keyDefinition));
  }
  public getById(id: EntryId): Promise<KeyedRecord<unknown> | null> {
    return this.rOpen(() => executeGetById(this.ctx(), id));
  }

  public updateById(
    id: EntryId,
    patch: Partial<KeyedRecord<unknown>['payload']>,
  ): Promise<boolean> {
    return this.rExcl(async () => {
      const r = await executeUpdateById(this.ctx(), id, patch);
      this.currentSizeBytes = r.currentSizeBytes;
      return r.updated;
    });
  }

  public replaceById(id: EntryId, payload: RecordPayload): Promise<boolean> {
    return this.rExcl(async () => {
      const r = await executeReplaceById(this.ctx(), id, payload);
      this.currentSizeBytes = r.currentSizeBytes;
      return r.replaced;
    });
  }

  public deleteById(id: EntryId): Promise<boolean> {
    return this.rExcl(async () => {
      const r = await executeDeleteById(this.ctx(), id);
      this.currentSizeBytes = r.currentSizeBytes;
      return r.deleted;
    });
  }

  public deleteByIds(ids: EntryId[]): Promise<number> {
    return this.rExcl(async () => {
      const r = await executeDeleteByIds(this.ctx(), ids);
      this.currentSizeBytes = r.currentSizeBytes;
      return r.deletedCount;
    });
  }

  public commit(): Promise<void> {
    return this.rExcl(async () => {
      await this.backendController?.commitNow();
    });
  }

  public on(event: 'error', listener: DatastoreErrorListener): () => void;
  public on(event: string, listener: DatastoreErrorListener): () => void {
    return addErrorListener(this.errorListeners, event, listener, (ev, l) =>
      this.off(ev as 'error', l),
    );
  }

  public off(event: 'error', listener: DatastoreErrorListener): void;
  public off(event: string, listener: DatastoreErrorListener): void {
    removeErrorListener(this.errorListeners, event, listener);
  }

  private normalizeRange(start: unknown, end: unknown): [unknown, unknown] {
    const ns = this.keyDefinition.normalize(start, 'start');
    const ne = this.keyDefinition.normalize(end, 'end');
    if (normalizeComparatorResult(this.keyDefinition.compare(ns, ne)) > 0)
      throw new InvalidQueryRangeError('start must be <= end.');
    return [ns, ne];
  }

  public async close(): Promise<void> {
    await closeDatastore(
      buildCloseOptions(this as unknown as DatastoreCloseableState),
    );
  }
}
