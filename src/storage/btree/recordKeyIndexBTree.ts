import {
  type BTreeEntry,
  type BTreeJSON,
  type DuplicateKeyPolicy,
  type EntryId,
  type InMemoryBTreeConfig,
  InMemoryBTree,
} from '@frostpillar/frostpillar-btree';
import { IndexCorruptionError } from '../../errors/index.js';

export type { BTreeEntry, BTreeJSON, DuplicateKeyPolicy, EntryId };

export interface RecordKeyIndexBTreeStats {
  height: number;
  leafCount: number;
  branchCount: number;
  entryCount: number;
}

export interface RecordKeyIndexBTreeConfig<TKey> {
  compareKeys: (left: TKey, right: TKey) => number;
  duplicateKeys?: DuplicateKeyPolicy;
  autoScale?: boolean;
  maxLeafEntries?: number;
  maxBranchChildren?: number;
}

export const normalizeComparatorResult = (compared: number): number => {
  if (!Number.isFinite(compared) || !Number.isInteger(compared)) {
    throw new IndexCorruptionError(
      'key comparator must return a finite integer result.',
    );
  }
  if (compared === 0) {
    return 0;
  }
  return compared < 0 ? -1 : 1;
};

// Lightweight clamper for hot-path comparator wrapping — no validation overhead.
export const clampComparatorResult = (compared: number): number => {
  if (compared === 0) return 0;
  return compared < 0 ? -1 : 1;
};

const buildWrappedComparator = <TKey>(
  compareKeys: (left: TKey, right: TKey) => number,
): ((left: TKey, right: TKey) => number) => {
  return (left: TKey, right: TKey): number => {
    const result = compareKeys(left, right);
    // NaN check: x !== x is true only for NaN. Prevents silent BTree corruption.
    if (result !== result) {
      throw new IndexCorruptionError('key comparator must not return NaN.');
    }
    return clampComparatorResult(result);
  };
};

export class RecordKeyIndexBTree<TKey = unknown, TValue = unknown> {
  private readonly tree: InMemoryBTree<TKey, TValue>;

  constructor(config: RecordKeyIndexBTreeConfig<TKey>) {
    const wrappedComparator = buildWrappedComparator(config.compareKeys);
    const treeConfig: InMemoryBTreeConfig<TKey> = {
      compareKeys: wrappedComparator,
      duplicateKeys: config.duplicateKeys ?? 'allow',
      enableEntryIdLookup: true,
      autoScale: config.autoScale ?? true,
      maxLeafEntries: config.maxLeafEntries,
      maxBranchChildren: config.maxBranchChildren,
    };
    this.tree = new InMemoryBTree<TKey, TValue>(treeConfig);
  }

  public put(key: TKey, value: TValue): EntryId {
    return this.tree.put(key, value);
  }

  public putMany(entries: readonly { key: TKey; value: TValue }[]): EntryId[] {
    return this.tree.putMany(entries);
  }

  public peekById(entryId: EntryId): BTreeEntry<TKey, TValue> | null {
    return this.tree.peekById(entryId);
  }

  public updateById(entryId: EntryId, value: TValue): BTreeEntry<TKey, TValue> | null {
    return this.tree.updateById(entryId, value);
  }

  public removeById(entryId: EntryId): BTreeEntry<TKey, TValue> | null {
    return this.tree.removeById(entryId);
  }

  public rangeQuery(start: TKey, end: TKey): BTreeEntry<TKey, TValue>[] {
    return this.tree.range(start, end);
  }

  public deleteRange(start: TKey, end: TKey): number {
    return this.tree.deleteRange(start, end, {
      lowerBound: 'inclusive',
      upperBound: 'inclusive',
    });
  }

  public snapshot(): BTreeEntry<TKey, TValue>[] {
    return this.tree.snapshot();
  }

  public peekLast(): BTreeEntry<TKey, TValue> | null {
    return this.tree.peekLast();
  }

  public popFirst(): BTreeEntry<TKey, TValue> | null {
    return this.tree.popFirst();
  }

  public size(): number {
    return this.tree.size();
  }

  public findFirst(key: TKey): BTreeEntry<TKey, TValue> | null {
    return this.tree.findFirst(key);
  }

  public findLast(key: TKey): BTreeEntry<TKey, TValue> | null {
    return this.tree.findLast(key);
  }

  public hasKey(key: TKey): boolean {
    return this.tree.hasKey(key);
  }

  public keys(): IterableIterator<TKey> {
    return this.tree.keys();
  }

  public toJSON(): BTreeJSON<TKey, TValue> {
    return this.tree.toJSON();
  }

  public static fromJSON<TKey, TValue>(
    json: BTreeJSON<TKey, TValue>,
    config: RecordKeyIndexBTreeConfig<TKey>,
  ): RecordKeyIndexBTree<TKey, TValue> {
    const wrappedComparator = buildWrappedComparator(config.compareKeys);
    const adapter = Object.create(RecordKeyIndexBTree.prototype) as RecordKeyIndexBTree<TKey, TValue>;
    const resolvedPolicy = config.duplicateKeys ?? 'allow';
    const resolvedAutoScale = config.autoScale ?? true;
    const configPatch: BTreeJSON<TKey, TValue>['config'] = { ...json.config, duplicateKeys: resolvedPolicy, autoScale: resolvedAutoScale };
    if (!resolvedAutoScale) {
      if (config.maxLeafEntries !== undefined) configPatch.maxLeafEntries = config.maxLeafEntries;
      if (config.maxBranchChildren !== undefined) configPatch.maxBranchChildren = config.maxBranchChildren;
    }
    const patchedJSON: BTreeJSON<TKey, TValue> = { ...json, config: configPatch };
    (adapter as unknown as { tree: InMemoryBTree<TKey, TValue> }).tree =
      InMemoryBTree.fromJSON<TKey, TValue>(patchedJSON, wrappedComparator);
    return adapter;
  }

  public clear(): void {
    this.tree.clear();
  }
}
