import {
  IndexCorruptionError,
  QuotaExceededError,
} from '../../errors/index.js';
import { toPublicRecord } from '../record/ordering.js';
import type {
  KeyedRecord,
  PersistedRecord,
  RecordPayload,
} from '../../types.js';
import { validateAndNormalizePayload, type ResolvedPayloadLimits } from '../../validation/payload.js';
import { estimateKeySizeBytes, estimateRecordSizeBytes } from '../backend/encoding.js';
import type { CapacityState } from '../backend/types.js';
import type { EntryId, RecordKeyIndexBTree } from '../btree/recordKeyIndexBTree.js';

export const getPublicRecordById = (
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>,
  entryId: EntryId,
): KeyedRecord<unknown> | null => {
  const entry = keyIndex.peekById(entryId);
  if (entry === null) {
    return null;
  }
  return toPublicRecord(entryId, entry.key, entry.value);
};

export interface UpdateByIdOptions {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  id: EntryId;
  patch: Partial<KeyedRecord<unknown>['payload']>;
  capacityState: CapacityState | null;
  currentSizeBytes: number;
  skipPayloadValidation: boolean;
  payloadLimits: ResolvedPayloadLimits;
}

export interface UpdateByIdResult {
  updated: boolean;
  currentSizeBytes: number;
  durabilitySignalBytes: number;
}

interface MergedPayloadResult {
  payload: RecordPayload;
  sizeBytes: number;
}

const buildMergedPayload = (
  targetRecord: PersistedRecord,
  patch: Partial<KeyedRecord<unknown>['payload']>,
  entryKey: unknown,
  skipValidation: boolean,
  payloadLimits: ResolvedPayloadLimits,
): MergedPayloadResult => {
  const merged = { ...targetRecord.payload, ...patch } as RecordPayload;
  if (skipValidation) {
    return {
      payload: merged,
      sizeBytes: estimateRecordSizeBytes(entryKey, merged),
    };
  }
  const validationResult = validateAndNormalizePayload(merged, payloadLimits);
  const keyBytes = estimateKeySizeBytes(entryKey);
  return {
    payload: validationResult.payload,
    sizeBytes: validationResult.sizeBytes + keyBytes,
  };
};

export const updateRecordById = (
  options: UpdateByIdOptions,
): UpdateByIdResult => {
  const entry = options.keyIndex.peekById(options.id);
  if (entry === null) {
    return { updated: false, currentSizeBytes: options.currentSizeBytes, durabilitySignalBytes: 0 };
  }

  const targetRecord = entry.value;
  const oldSize = targetRecord.sizeBytes;
  const mergedResult = buildMergedPayload(targetRecord, options.patch, entry.key, options.skipPayloadValidation, options.payloadLimits);
  const mergedPayload = mergedResult.payload;
  const newSize = mergedResult.sizeBytes;
  const encodedDelta = newSize - oldSize;

  if (
    options.capacityState !== null &&
    encodedDelta > 0 &&
    options.currentSizeBytes + encodedDelta > options.capacityState.maxSizeBytes
  ) {
    throw new QuotaExceededError('updateById exceeds configured capacity.maxSize boundary.');
  }

  const updatedRecord: PersistedRecord = {
    payload: mergedPayload,
    sizeBytes: newSize,
  };

  if (options.keyIndex.updateById(options.id, updatedRecord) === null) {
    throw new IndexCorruptionError('Record index state is inconsistent during updateById.');
  }

  // Underflow is not possible: encodedDelta = newSize - oldSize, and oldSize was
  // accumulated into currentSizeBytes on insertion. Math.max is purely defensive
  // against any future estimation inconsistency.
  return {
    updated: true,
    currentSizeBytes: Math.max(0, options.currentSizeBytes + encodedDelta),
    durabilitySignalBytes: Math.abs(encodedDelta),
  };
};

export interface ReplaceByIdOptions {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  id: EntryId;
  payload: RecordPayload;
  capacityState: CapacityState | null;
  currentSizeBytes: number;
  skipPayloadValidation: boolean;
  payloadLimits: ResolvedPayloadLimits;
}

export interface ReplaceByIdResult {
  replaced: boolean;
  currentSizeBytes: number;
  durabilitySignalBytes: number;
}

const buildReplacementPayload = (
  newPayload: RecordPayload,
  entryKey: unknown,
  skipValidation: boolean,
  payloadLimits: ResolvedPayloadLimits,
): MergedPayloadResult => {
  if (skipValidation) {
    return {
      payload: newPayload,
      sizeBytes: estimateRecordSizeBytes(entryKey, newPayload),
    };
  }
  const validationResult = validateAndNormalizePayload(newPayload, payloadLimits);
  const keyBytes = estimateKeySizeBytes(entryKey);
  return {
    payload: validationResult.payload,
    sizeBytes: validationResult.sizeBytes + keyBytes,
  };
};

export const replaceRecordById = (
  options: ReplaceByIdOptions,
): ReplaceByIdResult => {
  const entry = options.keyIndex.peekById(options.id);
  if (entry === null) {
    return { replaced: false, currentSizeBytes: options.currentSizeBytes, durabilitySignalBytes: 0 };
  }

  const oldSize = entry.value.sizeBytes;
  const replacementResult = buildReplacementPayload(options.payload, entry.key, options.skipPayloadValidation, options.payloadLimits);
  const newSize = replacementResult.sizeBytes;
  const encodedDelta = newSize - oldSize;

  if (
    options.capacityState !== null &&
    encodedDelta > 0 &&
    options.currentSizeBytes + encodedDelta > options.capacityState.maxSizeBytes
  ) {
    throw new QuotaExceededError('replaceById exceeds configured capacity.maxSize boundary.');
  }

  const replacedRecord: PersistedRecord = {
    payload: replacementResult.payload,
    sizeBytes: newSize,
  };

  if (options.keyIndex.updateById(options.id, replacedRecord) === null) {
    throw new IndexCorruptionError('Record index state is inconsistent during replaceById.');
  }

  // Underflow is not possible: encodedDelta = newSize - oldSize, and oldSize was
  // accumulated into currentSizeBytes on insertion. Math.max is purely defensive
  // against any future estimation inconsistency.
  return {
    replaced: true,
    currentSizeBytes: Math.max(0, options.currentSizeBytes + encodedDelta),
    durabilitySignalBytes: Math.abs(encodedDelta),
  };
};

export interface DeleteByIdOptions {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  id: EntryId;
  currentSizeBytes: number;
}

export interface DeleteByIdResult {
  deleted: boolean;
  currentSizeBytes: number;
  durabilitySignalBytes: number;
}

export const deleteRecordById = (
  options: DeleteByIdOptions,
): DeleteByIdResult => {
  const removedFromIndex = options.keyIndex.removeById(options.id);
  if (removedFromIndex === null) {
    return {
      deleted: false,
      currentSizeBytes: options.currentSizeBytes,
      durabilitySignalBytes: 0,
    };
  }

  const freedBytes = removedFromIndex.value.sizeBytes;

  // Underflow is not possible: freedBytes was accumulated into currentSizeBytes
  // on insertion and has not been modified since. Math.max is purely defensive
  // against any future estimation inconsistency.
  return {
    deleted: true,
    currentSizeBytes: Math.max(
      0,
      options.currentSizeBytes - freedBytes,
    ),
    durabilitySignalBytes: freedBytes,
  };
};

export interface DeleteByIdsOptions {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  ids: EntryId[];
  currentSizeBytes: number;
}

export interface DeleteByIdsResult {
  deletedCount: number;
  currentSizeBytes: number;
  durabilitySignalBytes: number;
}

export const deleteRecordByIds = (
  options: DeleteByIdsOptions,
): DeleteByIdsResult => {
  let deletedCount = 0;
  let totalFreedBytes = 0;
  let currentSizeBytes = options.currentSizeBytes;

  for (const id of options.ids) {
    const removedFromIndex = options.keyIndex.removeById(id);
    if (removedFromIndex === null) {
      continue;
    }
    const freedBytes = removedFromIndex.value.sizeBytes;
    totalFreedBytes += freedBytes;
    // Underflow is not possible: freedBytes was accumulated into currentSizeBytes
    // on insertion and has not been modified since. Math.max is purely defensive
    // against any future estimation inconsistency.
    currentSizeBytes = Math.max(0, currentSizeBytes - freedBytes);
    deletedCount += 1;
  }

  return {
    deletedCount,
    currentSizeBytes,
    durabilitySignalBytes: totalFreedBytes,
  };
};
