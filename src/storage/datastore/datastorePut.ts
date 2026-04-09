import {
  DuplicateKeyError,
  IndexCorruptionError,
  QuotaExceededError,
} from '../../errors/index.js';
import type {
  InputRecord,
  PersistedRecord,
  RecordPayload,
} from '../../types.js';
import {
  validateAndNormalizePayload,
  type ResolvedPayloadLimits,
} from '../../validation/payload.js';
import { enforceCapacityPolicy } from '../backend/capacity.js';
import type {
  CapacityState,
  DurableBackendController,
} from '../backend/types.js';
import type {
  RecordKeyIndexBTree,
  DuplicateKeyPolicy,
} from '../btree/recordKeyIndexBTree.js';
import { readRawInsertKey } from './datastoreKeyDefinition.js';
import { validateAndEstimateSize } from './mutationById.js';

export interface PutContext {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  keyDefinition: { normalize: (v: unknown, f: string) => unknown };
  duplicateKeyPolicy: DuplicateKeyPolicy;
  capacityState: CapacityState | null;
  skipPayloadValidation: boolean;
  payloadLimits: ResolvedPayloadLimits;
  backendController: DurableBackendController | null;
  currentSizeBytes: number;
}

const resolvePayload = (
  record: InputRecord<unknown>,
  normalizedKey: unknown,
  skipPayloadValidation: boolean,
  payloadLimits: ResolvedPayloadLimits,
): { payload: RecordPayload; encodedBytes: number } => {
  const result = validateAndEstimateSize(
    record.payload,
    normalizedKey,
    skipPayloadValidation,
    payloadLimits,
  );
  return { payload: result.payload, encodedBytes: result.sizeBytes };
};

const putCapacityBypass = (
  ctx: PutContext,
  record: InputRecord<unknown>,
  normalizedKey: unknown,
): void => {
  const normalizedPayload = ctx.skipPayloadValidation
    ? record.payload
    : validateAndNormalizePayload(record.payload, ctx.payloadLimits).payload;
  ctx.keyIndex.put(normalizedKey, { payload: normalizedPayload, sizeBytes: 0 });
};

const putWithCapacity = (
  ctx: PutContext,
  capacityState: CapacityState,
  normalizedKey: unknown,
  normalizedPayload: RecordPayload,
  encodedBytes: number,
): number => {
  if (encodedBytes > capacityState.maxSizeBytes) {
    throw new QuotaExceededError(
      'Record exceeds configured capacity.maxSize boundary.',
    );
  }

  let currentSizeBytes = ctx.currentSizeBytes;

  if (ctx.duplicateKeyPolicy === 'replace') {
    const existing = ctx.keyIndex.findFirst(normalizedKey);
    if (existing !== null) {
      currentSizeBytes = Math.max(
        0,
        currentSizeBytes - existing.value.sizeBytes,
      );
      ctx.keyIndex.removeById(existing.entryId);
    }
  }

  currentSizeBytes = enforceCapacityPolicy(
    capacityState,
    currentSizeBytes,
    encodedBytes,
    (): number => ctx.keyIndex.size(),
    (): number => {
      const evicted = ctx.keyIndex.popFirst();
      if (evicted === null) {
        throw new IndexCorruptionError(
          'Record buffer reported empty state during turnover eviction.',
        );
      }
      return evicted.value.sizeBytes;
    },
  );

  ctx.keyIndex.put(normalizedKey, {
    payload: normalizedPayload,
    sizeBytes: encodedBytes,
  });
  return currentSizeBytes + encodedBytes;
};

export const executePutSingle = async (
  ctx: PutContext,
  record: InputRecord<unknown>,
): Promise<number> => {
  const { rawKey, keyFieldName } = readRawInsertKey(
    record as unknown as Record<string, unknown>,
  );
  const normalizedKey = ctx.keyDefinition.normalize(rawKey, keyFieldName);

  if (
    ctx.duplicateKeyPolicy === 'reject' &&
    ctx.keyIndex.findFirst(normalizedKey) !== null
  ) {
    throw new DuplicateKeyError(
      'Duplicate key rejected: a record with this key already exists.',
    );
  }

  if (ctx.capacityState === null && ctx.backendController === null) {
    putCapacityBypass(ctx, record, normalizedKey);
    return ctx.currentSizeBytes;
  }

  const { payload: normalizedPayload, encodedBytes } = resolvePayload(
    record,
    normalizedKey,
    ctx.skipPayloadValidation,
    ctx.payloadLimits,
  );

  if (ctx.capacityState === null) {
    ctx.keyIndex.put(normalizedKey, {
      payload: normalizedPayload,
      sizeBytes: encodedBytes,
    });
    await ctx.backendController!.handleRecordAppended(encodedBytes);
    return ctx.currentSizeBytes;
  }

  const newSize = putWithCapacity(
    ctx,
    ctx.capacityState,
    normalizedKey,
    normalizedPayload,
    encodedBytes,
  );
  await ctx.backendController?.handleRecordAppended(encodedBytes);
  return newSize;
};
