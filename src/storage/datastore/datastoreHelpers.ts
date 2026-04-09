import { ValidationError } from '../../errors/index.js';
import type {
  DatastoreKeyDefinition,
  InputRecord,
  KeyedRecord,
  PersistedRecord,
} from '../../types.js';
import { validateAndNormalizePayload } from '../../validation/payload.js';
import { estimateRecordSizeBytes } from '../backend/encoding.js';
import type { RecordKeyIndexBTree } from '../btree/recordKeyIndexBTree.js';
import { clampComparatorResult } from '../btree/recordKeyIndexBTree.js';
import { toPublicRecord } from '../record/ordering.js';
import type { PutContext } from './datastorePut.js';
import { readRawInsertKey } from './datastoreKeyDefinition.js';

export const putManyInMemory = (
  records: InputRecord<unknown>[],
  ctx: PutContext,
): void => {
  for (const record of records) {
    const { rawKey, keyFieldName } = readRawInsertKey(
      record as unknown as Record<string, unknown>,
    );
    const nk = ctx.keyDefinition.normalize(rawKey, keyFieldName);
    if (
      ctx.duplicateKeyPolicy === 'reject' &&
      ctx.keyIndex.findFirst(nk) !== null
    ) {
      throw new ValidationError(
        'Duplicate key rejected: a record with this key already exists.',
      );
    }
    const normalizedPayload = ctx.skipPayloadValidation
      ? record.payload
      : validateAndNormalizePayload(record.payload, ctx.payloadLimits).payload;
    ctx.keyIndex.put(nk, { payload: normalizedPayload, sizeBytes: 0 });
  }
};

export const getManyRecords = (
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>,
  keyDef: DatastoreKeyDefinition<unknown, unknown>,
  keys: unknown[],
): KeyedRecord<unknown>[] => {
  const normalizedKeys: unknown[] = [];
  for (const key of keys) {
    normalizedKeys.push(keyDef.normalize(key, 'key'));
  }
  normalizedKeys.sort((a, b) => clampComparatorResult(keyDef.compare(a, b)));
  const results: KeyedRecord<unknown>[] = [];
  let lastKey: unknown = undefined;
  for (let i = 0; i < normalizedKeys.length; i += 1) {
    if (
      i > 0 &&
      clampComparatorResult(keyDef.compare(normalizedKeys[i], lastKey)) === 0
    ) {
      continue;
    }
    lastKey = normalizedKeys[i];
    for (const e of keyIndex.rangeQuery(normalizedKeys[i], normalizedKeys[i])) {
      results.push(toPublicRecord(e.entryId, e.key, e.value));
    }
  }
  return results;
};

export const getDistinctKeys = (
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>,
  keyDef: DatastoreKeyDefinition<unknown, unknown>,
): unknown[] => {
  const distinctKeys: unknown[] = [];
  let lastKey: unknown = undefined;
  let isFirst = true;
  for (const key of keyIndex.keys()) {
    if (isFirst || clampComparatorResult(keyDef.compare(key, lastKey)) !== 0) {
      distinctKeys.push(key);
      lastKey = key;
      isFirst = false;
    }
  }
  return distinctKeys;
};

export const backfillMissingSizeBytes = (
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>,
): void => {
  for (const entry of keyIndex.entries()) {
    if (typeof entry.value.sizeBytes !== 'number') {
      const patched: PersistedRecord = {
        payload: entry.value.payload,
        sizeBytes: estimateRecordSizeBytes(entry.key, entry.value.payload),
      };
      keyIndex.updateById(entry.entryId, patched);
    }
  }
};
