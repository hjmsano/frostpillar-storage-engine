import type { PersistedRecord } from '../../types.js';
import type { DurableBackendController } from '../backend/types.js';
import type { RecordKeyIndexBTree } from '../btree/recordKeyIndexBTree.js';

export interface DeleteContext {
  keyIndex: RecordKeyIndexBTree<unknown, PersistedRecord>;
  keyDefinition: { normalize: (v: unknown, f: string) => unknown };
  backendController: DurableBackendController | null;
  currentSizeBytes: number;
}

export const deleteManyInMemory = (
  ctx: DeleteContext,
  keys: unknown[],
): { totalRemoved: number; currentSizeBytes: number } => {
  let totalRemoved = 0;
  let currentSizeBytes = ctx.currentSizeBytes;
  for (const key of keys) {
    const nk = ctx.keyDefinition.normalize(key, 'key');
    let freed = 0;
    ctx.keyIndex.forEachRange(nk, nk, (e) => {
      freed += e.value.sizeBytes;
    });
    const removed = ctx.keyIndex.deleteRange(nk, nk);
    if (removed === 0) continue;
    totalRemoved += removed;
    currentSizeBytes = Math.max(0, currentSizeBytes - freed);
  }
  return { totalRemoved, currentSizeBytes };
};

export const deleteSingle = async (
  ctx: DeleteContext,
  key: unknown,
): Promise<{ removedCount: number; currentSizeBytes: number }> => {
  const nk = ctx.keyDefinition.normalize(key, 'key');
  let freed = 0;
  ctx.keyIndex.forEachRange(nk, nk, (e) => {
    freed += e.value.sizeBytes;
  });
  const removedCount = ctx.keyIndex.deleteRange(nk, nk);
  if (removedCount === 0) {
    return { removedCount: 0, currentSizeBytes: ctx.currentSizeBytes };
  }
  const currentSizeBytes = Math.max(0, ctx.currentSizeBytes - freed);
  await ctx.backendController?.handleRecordAppended(freed);
  return { removedCount, currentSizeBytes };
};
