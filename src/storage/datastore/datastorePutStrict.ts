import { DuplicateKeyError, QuotaExceededError } from '../../errors/index.js';
import type { InputRecord, PersistedRecord } from '../../types.js';
import type { DuplicateKeyPolicy } from '../btree/recordKeyIndexBTree.js';
import { clampComparatorResult } from '../btree/recordKeyIndexBTree.js';
import type { PutContext } from './datastorePut.js';
import { readRawInsertKey } from './datastoreKeyDefinition.js';
import { validateAndEstimateSize } from './mutationById.js';

interface StrictBatchEntry {
  normalizedKey: unknown;
  persistedRecord: PersistedRecord;
  encodedBytes: number;
  replacedBytes: number;
}

interface TaggedRecord {
  idx: number;
  normalizedKey: unknown;
  record: InputRecord<unknown>;
}

const resolveReplacedBytes = (
  ctx: PutContext,
  duplicateKeyPolicy: DuplicateKeyPolicy,
  isIntraBatchDuplicate: boolean,
  normalizedKey: unknown,
  prepared: StrictBatchEntry[],
  totalBatchDelta: number,
): { replacedBytes: number; totalBatchDelta: number } => {
  if (duplicateKeyPolicy === 'replace' && isIntraBatchDuplicate) {
    const prev = prepared[prepared.length - 1];
    const adjusted = totalBatchDelta - (prev.encodedBytes - prev.replacedBytes);
    prepared.pop();
    return { replacedBytes: prev.replacedBytes, totalBatchDelta: adjusted };
  }
  if (duplicateKeyPolicy === 'replace') {
    const existing = ctx.keyIndex.findFirst(normalizedKey);
    return {
      replacedBytes: existing !== null ? existing.value.sizeBytes : 0,
      totalBatchDelta,
    };
  }
  return { replacedBytes: 0, totalBatchDelta };
};

const validateAndPrepareEntry = (
  ctx: PutContext,
  tagged: TaggedRecord[],
  i: number,
  compare: (left: unknown, right: unknown) => number,
  maxSizeBytes: number,
): { entry: StrictBatchEntry; isIntraBatchDuplicate: boolean } => {
  const { normalizedKey, record } = tagged[i];
  const isIntraBatchDuplicate =
    i > 0 &&
    clampComparatorResult(
      compare(tagged[i - 1].normalizedKey, normalizedKey),
    ) === 0;

  if (ctx.duplicateKeyPolicy === 'reject') {
    if (
      isIntraBatchDuplicate ||
      ctx.keyIndex.findFirst(normalizedKey) !== null
    ) {
      throw new DuplicateKeyError(
        'Duplicate key rejected: a record with this key already exists.',
      );
    }
  }

  const result = validateAndEstimateSize(
    record.payload,
    normalizedKey,
    ctx.skipPayloadValidation,
    ctx.payloadLimits,
  );
  if (result.sizeBytes > maxSizeBytes) {
    throw new QuotaExceededError(
      'Record exceeds configured capacity.maxSize boundary.',
    );
  }

  return {
    entry: {
      normalizedKey,
      persistedRecord: { payload: result.payload, sizeBytes: result.sizeBytes },
      encodedBytes: result.sizeBytes,
      replacedBytes: 0,
    },
    isIntraBatchDuplicate,
  };
};

const buildStrictBatchEntries = (
  ctx: PutContext,
  tagged: TaggedRecord[],
  compare: (left: unknown, right: unknown) => number,
  maxSizeBytes: number,
): { prepared: StrictBatchEntry[]; totalBatchDelta: number } => {
  const prepared: StrictBatchEntry[] = [];
  let totalBatchDelta = 0;

  for (let i = 0; i < tagged.length; i += 1) {
    const { entry, isIntraBatchDuplicate } = validateAndPrepareEntry(
      ctx,
      tagged,
      i,
      compare,
      maxSizeBytes,
    );

    const resolved = resolveReplacedBytes(
      ctx,
      ctx.duplicateKeyPolicy,
      isIntraBatchDuplicate,
      entry.normalizedKey,
      prepared,
      totalBatchDelta,
    );
    totalBatchDelta = resolved.totalBatchDelta;
    entry.replacedBytes = resolved.replacedBytes;
    totalBatchDelta += entry.encodedBytes - resolved.replacedBytes;
    prepared.push(entry);
  }

  return { prepared, totalBatchDelta };
};

const applyStrictBatchInserts = (
  ctx: PutContext,
  prepared: StrictBatchEntry[],
): { effectiveTotalDelta: number; totalEncodedBytes: number } => {
  let effectiveTotalDelta = 0;
  let totalEncodedBytes = 0;
  for (const {
    normalizedKey,
    persistedRecord,
    encodedBytes,
    replacedBytes,
  } of prepared) {
    const actualReplaced =
      replacedBytes > 0 && ctx.keyIndex.findFirst(normalizedKey) === null
        ? 0
        : replacedBytes;
    effectiveTotalDelta += encodedBytes - actualReplaced;
    totalEncodedBytes += encodedBytes;
    ctx.keyIndex.put(normalizedKey, persistedRecord);
  }
  return { effectiveTotalDelta, totalEncodedBytes };
};

export const executePutManyStrict = async (
  ctx: PutContext,
  records: InputRecord<unknown>[],
): Promise<number> => {
  const capacityState = ctx.capacityState!;
  const compare = (left: unknown, right: unknown): number =>
    ctx.keyDefinition.normalize === undefined
      ? 0
      : clampComparatorResult(
          (
            ctx.keyDefinition as unknown as {
              compare: (a: unknown, b: unknown) => number;
            }
          ).compare(left, right),
        );

  const tagged: TaggedRecord[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const { rawKey, keyFieldName } = readRawInsertKey(
      records[i] as unknown as Record<string, unknown>,
    );
    tagged.push({
      idx: i,
      normalizedKey: ctx.keyDefinition.normalize(rawKey, keyFieldName),
      record: records[i],
    });
  }

  tagged.sort((a, b) => {
    const cmp = compare(a.normalizedKey, b.normalizedKey);
    return cmp !== 0 ? cmp : a.idx - b.idx;
  });

  const { prepared, totalBatchDelta } = buildStrictBatchEntries(
    ctx,
    tagged,
    compare,
    capacityState.maxSizeBytes,
  );

  if (ctx.currentSizeBytes + totalBatchDelta > capacityState.maxSizeBytes) {
    throw new QuotaExceededError(
      'Insert exceeds configured capacity.maxSize under strict policy.',
    );
  }

  const { effectiveTotalDelta, totalEncodedBytes } = applyStrictBatchInserts(
    ctx,
    prepared,
  );

  const newSize = Math.max(0, ctx.currentSizeBytes + effectiveTotalDelta);
  await ctx.backendController?.handleRecordAppended(totalEncodedBytes);
  return newSize;
};
