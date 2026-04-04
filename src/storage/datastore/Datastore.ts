/* eslint-disable max-lines */
import {
  ConfigurationError,
  IndexCorruptionError,
  InvalidQueryRangeError,
  QuotaExceededError,
  ValidationError,
  toErrorInstance,
} from '../../errors/index.js';
import { toPublicRecord } from '../record/ordering.js';
import type {
  DatastoreConfig,
  DatastoreDriverInitResult,
  DatastoreErrorListener,
  DatastoreKeyDefinition,
  EntryId,
  InputRecord,
  KeyedRecord,
  PersistedRecord,
  RecordPayload,
} from '../../types.js';
import { emitAutoCommitErrorToListeners } from '../backend/autoCommit.js';
import { AsyncMutex } from '../backend/asyncMutex.js';
import { validateAndNormalizePayload } from '../../validation/payload.js';
import { enforceCapacityPolicy } from '../backend/capacity.js';
import { resolveCapacityState } from '../backend/capacityResolver.js';
import { estimateKeySizeBytes, estimateRecordSizeBytes } from '../backend/encoding.js';
import { parseDuplicateKeyConfig } from '../config/config.shared.js';
import { DatastoreLifecycle } from './datastoreLifecycle.js';
import {
  deleteRecordById,
  getPublicRecordById,
  updateRecordById,
} from './mutationById.js';
import { closeDatastore } from './datastoreClose.js';
import type { CapacityState, DurableBackendController } from '../backend/types.js';
import {
  RecordKeyIndexBTree,
  clampComparatorResult,
  normalizeComparatorResult,
} from '../btree/recordKeyIndexBTree.js';
import type { BTreeJSON, DuplicateKeyPolicy } from '../btree/recordKeyIndexBTree.js';
import {
  readRawInsertKey,
  resolveKeyDefinition,
} from './datastoreKeyDefinition.js';

export class Datastore {
  private readonly errorListeners: Set<DatastoreErrorListener>;
  private keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  private readonly keyDefinition: DatastoreKeyDefinition<unknown, unknown>;
  private readonly duplicateKeyPolicy: DuplicateKeyPolicy;
  private readonly capacityState: CapacityState | null;
  private readonly skipPayloadValidation: boolean;
  private readonly lifecycle: DatastoreLifecycle;
  private readonly writeMutex: AsyncMutex;
  private currentSizeBytes: number;
  private backendController: DurableBackendController | null;
  private pendingInit: Promise<void> | null;
  private pendingInitError: Error | null;

  constructor(config: DatastoreConfig) {
    this.errorListeners = new Set<DatastoreErrorListener>();
    this.keyDefinition = resolveKeyDefinition(config);
    const duplicateKeys = parseDuplicateKeyConfig(config.duplicateKeys);
    this.duplicateKeyPolicy = duplicateKeys;
    this.keyIndex = new RecordKeyIndexBTree<unknown, PersistedRecord>({
      compareKeys: (left: unknown, right: unknown): number => this.keyDefinition.compare(left, right),
      duplicateKeys,
    });
    this.capacityState = resolveCapacityState(config);
    this.skipPayloadValidation = config.skipPayloadValidation === true;
    this.lifecycle = new DatastoreLifecycle();
    this.writeMutex = new AsyncMutex();
    this.currentSizeBytes = 0;
    this.backendController = null;
    this.pendingInit = null;
    this.pendingInitError = null;

    if (config.driver === undefined) {
      if (config.autoCommit !== undefined) {
        throw new ConfigurationError(
          'autoCommit requires a durable driver.',
        );
      }
      return;
    }

    const backendInit = config.driver.init({
      getSnapshot: () => ({
        treeJSON: this.keyIndex.toJSON(),
      }),
      autoCommit: config.autoCommit,
      onAutoCommitError: (error: unknown): void => {
        emitAutoCommitErrorToListeners(this.errorListeners, error);
      },
    });
    if (!isPromiseLike(backendInit)) {
      this.applyBackendInitResult(backendInit);
      return;
    }

    this.pendingInit = Promise.resolve(backendInit)
      .then((result): void => { this.applyBackendInitResult(result); })
      .catch((error: unknown): void => {
        this.pendingInitError = toErrorInstance(error, 'Datastore backend initialization failed with a non-Error value.');
      })
      .finally((): void => {
        this.pendingInit = null;  // clear atomically after init settles (single-flight)
      });
  }

  public put(record: InputRecord<unknown>): Promise<void> {
    return this.runWithOpenExclusive((): Promise<void> => this.putSingle(record));
  }

  public get(key: unknown): Promise<KeyedRecord<unknown>[]> {
    return this.runWithOpen((): KeyedRecord<unknown>[] => {
      const normalizedKey = this.keyDefinition.normalize(key, 'key');
      return this.keyIndex.rangeQuery(normalizedKey, normalizedKey).map((e) => toPublicRecord(e.entryId, e.key, e.value));
    });
  }

  public getFirst(key: unknown): Promise<KeyedRecord<unknown> | null> {
    return this.runWithOpen((): KeyedRecord<unknown> | null => {
      const normalizedKey = this.keyDefinition.normalize(key, 'key');
      const entry = this.keyIndex.findFirst(normalizedKey);
      if (entry === null) {
        return null;
      }
      return toPublicRecord(entry.entryId, entry.key, entry.value);
    });
  }

  public getLast(key: unknown): Promise<KeyedRecord<unknown> | null> {
    return this.runWithOpen((): KeyedRecord<unknown> | null => {
      const normalizedKey = this.keyDefinition.normalize(key, 'key');
      const entry = this.keyIndex.findLast(normalizedKey);
      if (entry === null) {
        return null;
      }
      return toPublicRecord(entry.entryId, entry.key, entry.value);
    });
  }

  public delete(key: unknown): Promise<number> {
    return this.runWithOpenExclusive((): Promise<number> => this.deleteSingle(key));
  }

  public has(key: unknown): Promise<boolean> {
    return this.runWithOpen((): boolean => {
      const normalizedKey = this.keyDefinition.normalize(key, 'key');
      return this.keyIndex.hasKey(normalizedKey);
    });
  }

  public getAll(): Promise<KeyedRecord<unknown>[]> {
    return this.runWithOpen((): KeyedRecord<unknown>[] => {
      return this.keyIndex.snapshot().map((e) => toPublicRecord(e.entryId, e.key, e.value));
    });
  }

  public getRange(start: unknown, end: unknown): Promise<KeyedRecord<unknown>[]> {
    return this.runWithOpen((): KeyedRecord<unknown>[] => {
      const normalizedStart = this.keyDefinition.normalize(start, 'start');
      const normalizedEnd = this.keyDefinition.normalize(end, 'end');
      if (normalizeComparatorResult(this.keyDefinition.compare(normalizedStart, normalizedEnd)) > 0) {
        throw new InvalidQueryRangeError('start must be <= end.');
      }
      return this.keyIndex.rangeQuery(normalizedStart, normalizedEnd).map((e) => toPublicRecord(e.entryId, e.key, e.value));
    });
  }

  public getMany(keys: unknown[]): Promise<KeyedRecord<unknown>[]> {
    return this.runWithOpen((): KeyedRecord<unknown>[] => {
      const normalizedKeys: unknown[] = [];
      for (const key of keys) {
        normalizedKeys.push(this.keyDefinition.normalize(key, 'key'));
      }
      normalizedKeys.sort((left, right) =>
        clampComparatorResult(this.keyDefinition.compare(left, right)),
      );
      const results: KeyedRecord<unknown>[] = [];
      let lastKey: unknown = undefined;
      for (let i = 0; i < normalizedKeys.length; i += 1) {
        if (i > 0 && clampComparatorResult(this.keyDefinition.compare(normalizedKeys[i], lastKey)) === 0) {
          continue;
        }
        lastKey = normalizedKeys[i];
        const entries = this.keyIndex.rangeQuery(normalizedKeys[i], normalizedKeys[i]);
        for (const entry of entries) {
          results.push(toPublicRecord(entry.entryId, entry.key, entry.value));
        }
      }
      return results;
    });
  }

  public putMany(records: InputRecord<unknown>[]): Promise<void> {
    return this.runWithOpenExclusive(async (): Promise<void> => {
      // P12: Pure in-memory sync loop — no capacity, no backend, no microtask overhead
      if (this.capacityState === null && this.backendController === null) {
        for (const record of records) {
          const { rawKey, keyFieldName } = readRawInsertKey(record as unknown as Record<string, unknown>);
          const normalizedKey = this.keyDefinition.normalize(rawKey, keyFieldName);
          if (this.duplicateKeyPolicy === 'reject' && this.keyIndex.findFirst(normalizedKey) !== null) {
            throw new ValidationError('Duplicate key rejected: a record with this key already exists.');
          }
          const normalizedPayload = this.skipPayloadValidation
            ? record.payload
            : validateAndNormalizePayload(record.payload).payload;
          this.keyIndex.put(normalizedKey, { payload: normalizedPayload, sizeBytes: 0 });
        }
        return;
      }

      // No capacity but has backend: need async for handleRecordAppended
      if (this.capacityState === null) {
        for (const record of records) {
          await this.putSingle(record);
        }
        return;
      }

      // Turnover policy: per-record path (eviction is order-dependent)
      if (this.capacityState.policy === 'turnover') {
        for (const record of records) {
          await this.putSingle(record);
        }
        return;
      }

      // Strict policy: atomic batch — prepare phase first, then insert
      await this.putManyStrict(records);
    });
  }

  public deleteMany(keys: unknown[]): Promise<number> {
    return this.runWithOpenExclusive(async (): Promise<number> => {
      // P12: Pure in-memory sync loop — no backend, no microtask overhead
      if (this.backendController === null) {
        let totalRemoved = 0;
        for (const key of keys) {
          const normalizedKey = this.keyDefinition.normalize(key, 'key');
          const entries = this.keyIndex.rangeQuery(normalizedKey, normalizedKey);
          if (entries.length === 0) {
            continue;
          }
          let freedBytes = 0;
          for (const entry of entries) {
            freedBytes += entry.value.sizeBytes;
          }
          totalRemoved += this.keyIndex.deleteRange(normalizedKey, normalizedKey);
          // Underflow is not possible here: freedBytes is the sum of sizeBytes values
          // that were accumulated into currentSizeBytes on insertion. Math.max is
          // purely defensive against any future estimation inconsistency.
          this.currentSizeBytes = Math.max(0, this.currentSizeBytes - freedBytes);
        }
        return totalRemoved;
      }
      let totalRemoved = 0;
      for (const key of keys) {
        totalRemoved += await this.deleteSingle(key);
      }
      return totalRemoved;
    });
  }

  public clear(): Promise<void> {
    return this.runWithOpenExclusive(async (): Promise<void> => {
      this.keyIndex.clear();
      this.currentSizeBytes = 0;
      await this.backendController?.handleCleared();
    });
  }

  public count(): Promise<number> {
    return this.runWithOpen((): number => {
      return this.keyIndex.size();
    });
  }

  public keys(): Promise<unknown[]> {
    return this.runWithOpen((): unknown[] => {
      const distinctKeys: unknown[] = [];
      let lastKey: unknown = undefined;
      let isFirst = true;
      for (const key of this.keyIndex.keys()) {
        if (isFirst || clampComparatorResult(this.keyDefinition.compare(key, lastKey)) !== 0) {
          distinctKeys.push(key);
          lastKey = key;
          isFirst = false;
        }
      }
      return distinctKeys;
    });
  }

  public getById(id: EntryId): Promise<KeyedRecord<unknown> | null> {
    return this.runWithOpen((): KeyedRecord<unknown> | null => {
      return getPublicRecordById(this.keyIndex, id);
    });
  }

  public updateById(
    id: EntryId,
    patch: Partial<KeyedRecord<unknown>['payload']>,
  ): Promise<boolean> {
    return this.runWithOpenExclusive(async (): Promise<boolean> => {
      const result = updateRecordById({
        keyIndex: this.keyIndex,
        id,
        patch,
        capacityState: this.capacityState,
        currentSizeBytes: this.currentSizeBytes,
        skipPayloadValidation: this.skipPayloadValidation,
      });
      if (!result.updated) {
        return false;
      }

      this.currentSizeBytes = result.currentSizeBytes;
      await this.backendController?.handleRecordAppended(
        result.durabilitySignalBytes,
      );
      return true;
    });
  }

  public deleteById(id: EntryId): Promise<boolean> {
    return this.runWithOpenExclusive(async (): Promise<boolean> => {
      const result = deleteRecordById({
        keyIndex: this.keyIndex,
        id,
        currentSizeBytes: this.currentSizeBytes,
      });
      if (!result.deleted) {
        return false;
      }

      this.currentSizeBytes = result.currentSizeBytes;
      await this.backendController?.handleRecordAppended(
        result.durabilitySignalBytes,
      );
      return true;
    });
  }

  public commit(): Promise<void> {
    return this.runWithOpenExclusive(async (): Promise<void> => {
      await this.backendController?.commitNow();
    });
  }

  public on(event: 'error', listener: DatastoreErrorListener): () => void;
  public on(event: string, listener: DatastoreErrorListener): () => void {
    if (event !== 'error') {
      throw new ValidationError('Only "error" event is supported.');
    }
    this.errorListeners.add(listener);
    return (): void => { this.off(event, listener); };
  }

  public off(event: 'error', listener: DatastoreErrorListener): void;
  public off(event: string, listener: DatastoreErrorListener): void {
    if (event !== 'error') {
      throw new ValidationError('Only "error" event is supported.');
    }
    this.errorListeners.delete(listener);
  }

  public async close(): Promise<void> {
    await closeDatastore({
      lifecycle: this.lifecycle,
      getPendingInit: () => this.pendingInit,
      getPendingInitError: () => this.pendingInitError,
      setPendingInitError: (pendingInitError) => {
        this.pendingInitError = pendingInitError;
      },
      getBackendController: () => this.backendController,
      setBackendController: (backendController) => {
        this.backendController = backendController;
      },
      clearInMemoryState: () => {
        this.keyIndex.clear();
        this.errorListeners.clear();
      },
    });
  }

  private resolvePayload(record: InputRecord<unknown>, normalizedKey: unknown): { payload: RecordPayload; encodedBytes: number } {
    if (this.skipPayloadValidation) {
      const payload = record.payload;
      return { payload, encodedBytes: estimateRecordSizeBytes(normalizedKey, payload) };
    }
    const validationResult = validateAndNormalizePayload(record.payload);
    const keyBytes = estimateKeySizeBytes(normalizedKey);
    return { payload: validationResult.payload, encodedBytes: validationResult.sizeBytes + keyBytes };
  }

  private async putSingle(record: InputRecord<unknown>): Promise<void> {
    const { rawKey, keyFieldName } = readRawInsertKey(record as unknown as Record<string, unknown>);
    const normalizedKey = this.keyDefinition.normalize(rawKey, keyFieldName);

    // Fast-reject before expensive validation/serialization
    if (this.duplicateKeyPolicy === 'reject' && this.keyIndex.findFirst(normalizedKey) !== null) {
      throw new ValidationError(
        'Duplicate key rejected: a record with this key already exists.',
      );
    }

    // P5-A: Capacity-Bypass Fast Path — no capacity, no size tracking needed
    if (this.capacityState === null && this.backendController === null) {
      const normalizedPayload = this.skipPayloadValidation
        ? record.payload
        : validateAndNormalizePayload(record.payload).payload;
      this.keyIndex.put(normalizedKey, { payload: normalizedPayload, sizeBytes: 0 });
      return;
    }

    // Size computation needed (capacity or durable backend)
    const { payload: normalizedPayload, encodedBytes } = this.resolvePayload(record, normalizedKey);

    if (this.capacityState === null) {
      // Durable but no capacity: bytes for backend signal only
      this.keyIndex.put(normalizedKey, { payload: normalizedPayload, sizeBytes: encodedBytes });
      await this.backendController!.handleRecordAppended(encodedBytes);
      return;
    }

    // Full enforcement path (capacity configured)
    const persistedRecord: PersistedRecord = { payload: normalizedPayload, sizeBytes: encodedBytes };

    if (encodedBytes > this.capacityState.maxSizeBytes) {
      throw new QuotaExceededError('Record exceeds configured capacity.maxSize boundary.');
    }

    // For replace policy: remove the existing record before capacity enforcement
    // so that the turnover eviction loop cannot evict the replacement target,
    // which would cause the capacity delta to be miscalculated.
    if (this.duplicateKeyPolicy === 'replace') {
      const existing = this.keyIndex.findFirst(normalizedKey);
      if (existing !== null) {
        // Underflow is not possible here: existing.value.sizeBytes was added to
        // currentSizeBytes on insert and has not been modified since. Math.max is
        // purely defensive against any future estimation inconsistency.
        this.currentSizeBytes = Math.max(0, this.currentSizeBytes - existing.value.sizeBytes);
        this.keyIndex.removeById(existing.entryId);
      }
    }

    this.currentSizeBytes = enforceCapacityPolicy(
      this.capacityState,
      this.currentSizeBytes,
      encodedBytes,
      (): number => this.keyIndex.size(),
      (): number => {
        const evicted = this.keyIndex.popFirst();
        if (evicted === null) {
          throw new IndexCorruptionError('Record buffer reported empty state during turnover eviction.');
        }
        return evicted.value.sizeBytes;
      },
    );

    this.keyIndex.put(normalizedKey, persistedRecord);
    // encodedBytes is always >= 0, so this addition cannot produce a negative result.
    // Math.max is omitted here intentionally: the guard would be misleading, implying
    // a negative sum is possible when it is not.
    this.currentSizeBytes = this.currentSizeBytes + encodedBytes;
    await this.backendController?.handleRecordAppended(encodedBytes);
  }

  private async putManyStrict(records: InputRecord<unknown>[]): Promise<void> {
    const capacityState = this.capacityState!;
    const compare = this.keyDefinition.compare;

    // Phase 1: Normalize all records and tag with original index — O(M)
    const tagged: { idx: number; normalizedKey: unknown; record: InputRecord<unknown> }[] = [];
    for (let i = 0; i < records.length; i += 1) {
      const { rawKey, keyFieldName } = readRawInsertKey(records[i] as unknown as Record<string, unknown>);
      tagged.push({ idx: i, normalizedKey: this.keyDefinition.normalize(rawKey, keyFieldName), record: records[i] });
    }

    // Phase 2: Sort by (key, originalIndex) — O(M log M)
    tagged.sort((a, b) => {
      const cmp = clampComparatorResult(compare(a.normalizedKey, b.normalizedKey));
      return cmp !== 0 ? cmp : a.idx - b.idx;
    });

    // Phase 3: Detect duplicates and build the deduplicated insertion list — O(M)
    const { prepared, totalBatchDelta } = this.buildStrictBatchEntries(tagged, compare, capacityState.maxSizeBytes);

    // Phase 4: Budget check — all-or-nothing
    if (this.currentSizeBytes + totalBatchDelta > capacityState.maxSizeBytes) {
      throw new QuotaExceededError('Insert exceeds configured capacity.maxSize under strict policy.');
    }

    // Phase 5: Insert — safe to mutate
    let effectiveTotalDelta = 0;
    let totalEncodedBytes = 0;
    for (const { normalizedKey, persistedRecord, encodedBytes, replacedBytes } of prepared) {
      const actualReplaced = replacedBytes > 0 && this.keyIndex.findFirst(normalizedKey) === null ? 0 : replacedBytes;
      effectiveTotalDelta += encodedBytes - actualReplaced;
      totalEncodedBytes += encodedBytes;
      this.keyIndex.put(normalizedKey, persistedRecord);
    }

    // effectiveTotalDelta may be negative (net shrink from replacements), but
    // cannot bring currentSizeBytes below 0 because actualReplaced is bounded
    // by the bytes already present in currentSizeBytes. Math.max is purely
    // defensive against any future estimation inconsistency.
    this.currentSizeBytes = Math.max(0, this.currentSizeBytes + effectiveTotalDelta);
    await this.backendController?.handleRecordAppended(totalEncodedBytes);
  }

  private buildStrictBatchEntries(
    tagged: { idx: number; normalizedKey: unknown; record: InputRecord<unknown> }[],
    compare: (left: unknown, right: unknown) => number,
    maxSizeBytes: number,
  ): { prepared: StrictBatchEntry[]; totalBatchDelta: number } {
    const prepared: StrictBatchEntry[] = [];
    let totalBatchDelta = 0;

    for (let i = 0; i < tagged.length; i += 1) {
      const { normalizedKey, record } = tagged[i];
      const isIntraBatchDuplicate =
        i > 0 && clampComparatorResult(compare(tagged[i - 1].normalizedKey, normalizedKey)) === 0;

      if (this.duplicateKeyPolicy === 'reject') {
        if (isIntraBatchDuplicate || this.keyIndex.findFirst(normalizedKey) !== null) {
          throw new ValidationError('Duplicate key rejected: a record with this key already exists.');
        }
      }

      const { payload: normalizedPayload, encodedBytes } = this.resolvePayload(record, normalizedKey);

      if (encodedBytes > maxSizeBytes) {
        throw new QuotaExceededError('Record exceeds configured capacity.maxSize boundary.');
      }

      let replacedBytes = 0;
      if (this.duplicateKeyPolicy === 'replace' && isIntraBatchDuplicate) {
        const prev = prepared[prepared.length - 1];
        totalBatchDelta -= prev.encodedBytes - prev.replacedBytes;
        replacedBytes = prev.replacedBytes;
        prepared.pop();
      } else if (this.duplicateKeyPolicy === 'replace') {
        const existing = this.keyIndex.findFirst(normalizedKey);
        replacedBytes = existing !== null ? existing.value.sizeBytes : 0;
      }

      const persistedRecord: PersistedRecord = { payload: normalizedPayload, sizeBytes: encodedBytes };
      totalBatchDelta += encodedBytes - replacedBytes;
      prepared.push({ normalizedKey, persistedRecord, encodedBytes, replacedBytes });
    }

    return { prepared, totalBatchDelta };
  }

  private async deleteSingle(key: unknown): Promise<number> {
    const normalizedKey = this.keyDefinition.normalize(key, 'key');
    const entries = this.keyIndex.rangeQuery(normalizedKey, normalizedKey);
    if (entries.length === 0) {
      return 0;
    }

    let freedBytes = 0;
    for (const entry of entries) {
      freedBytes += entry.value.sizeBytes;
    }

    const removedCount = this.keyIndex.deleteRange(normalizedKey, normalizedKey);

    // Underflow is not possible here: freedBytes is the sum of sizeBytes values
    // that were accumulated into currentSizeBytes on insertion. Math.max is
    // purely defensive against any future estimation inconsistency.
    this.currentSizeBytes = Math.max(0, this.currentSizeBytes - freedBytes);
    await this.backendController?.handleRecordAppended(freedBytes);
    return removedCount;
  }

  // P7: Synchronous fast-path — avoids async/Promise overhead for read operations
  // when no pending init exists.
  private runWithOpen<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.pendingInit !== null) {
      return this.pendingInit.then((): T | Promise<T> => {
        if (this.pendingInitError !== null) {
          throw this.pendingInitError;
        }
        return this.executeWithLifecycle(operation);
      });
    }
    if (this.pendingInitError !== null) {
      return Promise.reject(this.pendingInitError);
    }
    try {
      return Promise.resolve(this.executeWithLifecycle(operation));
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private executeWithLifecycle<T>(operation: () => T | Promise<T>): T | Promise<T> {
    this.lifecycle.beginOperation();
    try {
      const result = operation();
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(
          (value: T): T => { this.lifecycle.endOperation(); return value; },
          (error: unknown): never => { this.lifecycle.endOperation(); throw error; },
        );
      }
      this.lifecycle.endOperation();
      return result;
    } catch (error: unknown) {
      this.lifecycle.endOperation();
      throw error;
    }
  }

  private async runWithOpenExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const release = await this.writeMutex.acquire();
    try {
      return await this.runWithOpen(operation);
    } finally {
      release();
    }
  }

  private applyBackendInitResult(result: DatastoreDriverInitResult): void {
    if (result.initialTreeJSON !== null) {
      this.keyIndex = RecordKeyIndexBTree.fromJSON<unknown, PersistedRecord>(
        result.initialTreeJSON as BTreeJSON<unknown, PersistedRecord>,
        {
          compareKeys: (left: unknown, right: unknown): number => {
            return this.keyDefinition.compare(left, right);
          },
          duplicateKeys: this.duplicateKeyPolicy,
        },
      );
      this.backfillMissingSizeBytes();
    }
    this.currentSizeBytes = result.initialCurrentSizeBytes;
    this.backendController = result.controller;
  }

  private backfillMissingSizeBytes(): void {
    for (const entry of this.keyIndex.snapshot()) {
      if (typeof entry.value.sizeBytes !== 'number') {
        const patched: PersistedRecord = {
          payload: entry.value.payload,
          sizeBytes: estimateRecordSizeBytes(entry.key, entry.value.payload),
        };
        this.keyIndex.updateById(entry.entryId, patched);
      }
    }
  }
}

interface StrictBatchEntry {
  normalizedKey: unknown;
  persistedRecord: PersistedRecord;
  encodedBytes: number;
  replacedBytes: number;
}

const isPromiseLike = <T>(
  value: PromiseLike<T> | T,
): value is PromiseLike<T> => {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  ) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === 'function';
};
