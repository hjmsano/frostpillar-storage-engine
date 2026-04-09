import type {
  EntryId,
  KeyedRecord,
  PersistedRecord,
  RecordPayload,
} from '../../types.js';
import type { ResolvedPayloadLimits } from '../../validation/payload.js';
import type {
  CapacityState,
  DurableBackendController,
} from '../backend/types.js';
import type { RecordKeyIndexBTree } from '../btree/recordKeyIndexBTree.js';
import {
  deleteRecordById,
  deleteRecordByIds,
  getPublicRecordById,
  replaceRecordById,
  updateRecordById,
} from './mutationById.js';

export interface IdOpsContext {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  capacityState: CapacityState | null;
  currentSizeBytes: number;
  skipPayloadValidation: boolean;
  payloadLimits: ResolvedPayloadLimits;
  backendController: DurableBackendController | null;
}

export const executeGetById = (
  ctx: IdOpsContext,
  id: EntryId,
): KeyedRecord<unknown> | null => {
  return getPublicRecordById(ctx.keyIndex, id);
};

export const executeUpdateById = async (
  ctx: IdOpsContext,
  id: EntryId,
  patch: Partial<KeyedRecord<unknown>['payload']>,
): Promise<{ updated: boolean; currentSizeBytes: number }> => {
  const result = updateRecordById({
    keyIndex: ctx.keyIndex,
    id,
    patch,
    capacityState: ctx.capacityState,
    currentSizeBytes: ctx.currentSizeBytes,
    skipPayloadValidation: ctx.skipPayloadValidation,
    payloadLimits: ctx.payloadLimits,
  });
  if (!result.updated)
    return { updated: false, currentSizeBytes: ctx.currentSizeBytes };
  await ctx.backendController?.handleRecordAppended(
    result.durabilitySignalBytes,
  );
  return { updated: true, currentSizeBytes: result.currentSizeBytes };
};

export const executeReplaceById = async (
  ctx: IdOpsContext,
  id: EntryId,
  payload: RecordPayload,
): Promise<{ replaced: boolean; currentSizeBytes: number }> => {
  const result = replaceRecordById({
    keyIndex: ctx.keyIndex,
    id,
    payload,
    capacityState: ctx.capacityState,
    currentSizeBytes: ctx.currentSizeBytes,
    skipPayloadValidation: ctx.skipPayloadValidation,
    payloadLimits: ctx.payloadLimits,
  });
  if (!result.replaced)
    return { replaced: false, currentSizeBytes: ctx.currentSizeBytes };
  await ctx.backendController?.handleRecordAppended(
    result.durabilitySignalBytes,
  );
  return { replaced: true, currentSizeBytes: result.currentSizeBytes };
};

export const executeDeleteById = async (
  ctx: IdOpsContext,
  id: EntryId,
): Promise<{ deleted: boolean; currentSizeBytes: number }> => {
  const result = deleteRecordById({
    keyIndex: ctx.keyIndex,
    id,
    currentSizeBytes: ctx.currentSizeBytes,
  });
  if (!result.deleted)
    return { deleted: false, currentSizeBytes: ctx.currentSizeBytes };
  await ctx.backendController?.handleRecordAppended(
    result.durabilitySignalBytes,
  );
  return { deleted: true, currentSizeBytes: result.currentSizeBytes };
};

export const executeDeleteByIds = async (
  ctx: IdOpsContext,
  ids: EntryId[],
): Promise<{ deletedCount: number; currentSizeBytes: number }> => {
  if (ids.length === 0)
    return { deletedCount: 0, currentSizeBytes: ctx.currentSizeBytes };
  const result = deleteRecordByIds({
    keyIndex: ctx.keyIndex,
    ids,
    currentSizeBytes: ctx.currentSizeBytes,
  });
  if (result.deletedCount === 0) {
    return { deletedCount: 0, currentSizeBytes: ctx.currentSizeBytes };
  }
  await ctx.backendController?.handleRecordAppended(
    result.durabilitySignalBytes,
  );
  return {
    deletedCount: result.deletedCount,
    currentSizeBytes: result.currentSizeBytes,
  };
};
