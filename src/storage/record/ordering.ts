import type { KeyedRecord, PersistedRecord } from '../../types.js';
import type { EntryId } from '../btree/recordKeyIndexBTree.js';

export const toPublicRecord = (
  entryId: EntryId,
  key: unknown,
  record: PersistedRecord,
): KeyedRecord<unknown> => {
  return {
    _id: entryId,
    key,
    payload: record.payload,
  };
};
