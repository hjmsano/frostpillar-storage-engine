import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { hrtime } from 'node:process';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const INPUT_SIZES = [1024, 4096, 16384, 65536];
const WARMUP_ROUNDS = 1;
const MEASURE_ROUNDS = 4;
const RANGE_WINDOW_SIZE = 64;

let sideEffectSink = 0;

/** @type {any} */
let DatastoreClass = null;

/** @type {any} */
let InMemoryBTreeClass = null;

const nowNs = () => hrtime.bigint();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const padKey = (index) => `key-${String(index).padStart(7, '0')}`;

const generatePayload = (index) => ({
  name: `record-${index}`,
  value: index,
  tag: index % 2 === 0 ? 'even' : 'odd',
  description: `This is record number ${index} with some padding data to simulate realistic payload sizes`,
});

const lcg = (seed) => (1664525 * seed + 1013904223) >>> 0;

const createShuffledIndices = (size, initialSeed) => {
  const values = Array.from({ length: size }, (_, i) => i);
  let seed = initialSeed >>> 0;
  for (let i = values.length - 1; i > 0; i -= 1) {
    seed = lcg(seed);
    const j = seed % (i + 1);
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const createDatastore = (configOverrides) => {
  return new DatastoreClass(configOverrides ?? {});
};

const populateDatastore = async (size, configOverrides) => {
  const ds = createDatastore(configOverrides);
  for (let i = 0; i < size; i += 1) {
    await ds.put({ key: padKey(i), payload: generatePayload(i) });
  }
  return ds;
};

// ---------------------------------------------------------------------------
// Benchmark primitives (warmup + multi-round median)
// ---------------------------------------------------------------------------

const benchAsync = async (setup, body) => {
  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    const ctx = await setup();
    await body(ctx);
    if (ctx.ds) await ctx.ds.close();
  }

  const elapsedByRound = [];
  for (let round = 0; round < MEASURE_ROUNDS; round += 1) {
    const ctx = await setup();
    const start = nowNs();
    const opCount = await body(ctx);
    const end = nowNs();
    elapsedByRound.push(Number(end - start));
    if (ctx.ds) await ctx.ds.close();
  }

  return median(elapsedByRound);
};

// ---------------------------------------------------------------------------
// Individual benchmarks
// ---------------------------------------------------------------------------

const benchPut = async (size, configOverrides) => {
  const elapsedNs = await benchAsync(
    async () => ({ ds: createDatastore(configOverrides) }),
    async (ctx) => {
      for (let i = 0; i < size; i += 1) {
        await ctx.ds.put({ key: padKey(i), payload: generatePayload(i) });
      }
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchPutMany = async (size, configOverrides) => {
  const records = Array.from({ length: size }, (_, i) => ({
    key: padKey(i),
    payload: generatePayload(i),
  }));
  const elapsedNs = await benchAsync(
    async () => ({ ds: createDatastore(configOverrides) }),
    async (ctx) => {
      await ctx.ds.putMany(records);
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchGet = async (size, configOverrides) => {
  const queryOrder = createShuffledIndices(size, 0x3c82a1 + size);
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      let checksum = 0;
      for (const idx of queryOrder) {
        const results = await ctx.ds.get(padKey(idx));
        checksum ^= results.length;
      }
      sideEffectSink ^= checksum;
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchGetFirst = async (size, configOverrides) => {
  const queryOrder = createShuffledIndices(size, 0x4a51d2 + size);
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      let checksum = 0;
      for (const idx of queryOrder) {
        const record = await ctx.ds.getFirst(padKey(idx));
        if (record !== null) checksum ^= 1;
      }
      sideEffectSink ^= checksum;
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchHas = async (size, configOverrides) => {
  const queryOrder = createShuffledIndices(size, 0x2b79c1 + size);
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      let checksum = 0;
      for (const idx of queryOrder) {
        const exists = await ctx.ds.has(padKey(idx));
        if (exists) checksum ^= 1;
      }
      sideEffectSink ^= checksum;
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchGetAll = async (size, configOverrides) => {
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      const all = await ctx.ds.getAll();
      sideEffectSink ^= all.length;
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchGetRange = async (size, configOverrides) => {
  const maxStart = size - RANGE_WINDOW_SIZE;
  const windowStarts = createShuffledIndices(
    maxStart > 0 ? maxStart : 1,
    0x7cc251 + size,
  );
  const queries = Math.min(
    windowStarts.length,
    Math.max(100, Math.floor(size / 2)),
  );
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      let checksum = 0;
      for (let i = 0; i < queries; i += 1) {
        const startIdx = windowStarts[i % windowStarts.length];
        const endIdx = startIdx + RANGE_WINDOW_SIZE - 1;
        const results = await ctx.ds.getRange(padKey(startIdx), padKey(endIdx));
        checksum ^= results.length;
      }
      sideEffectSink ^= checksum;
    },
  );
  return { elapsedNs, operationCount: queries };
};

const benchGetMany = async (size, configOverrides) => {
  const batchSize = Math.min(50, size);
  const batches = Math.max(10, Math.floor(size / batchSize));
  const allIndices = createShuffledIndices(size, 0x5da312 + size);
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      let checksum = 0;
      for (let b = 0; b < batches; b += 1) {
        const keys = [];
        for (let j = 0; j < batchSize; j += 1) {
          keys.push(
            padKey(allIndices[(b * batchSize + j) % allIndices.length]),
          );
        }
        const results = await ctx.ds.getMany(keys);
        checksum ^= results.length;
      }
      sideEffectSink ^= checksum;
    },
  );
  return { elapsedNs, operationCount: batches };
};

const benchUpdateById = async (size, configOverrides) => {
  const updateCount = Math.min(size, 1000);
  const elapsedNs = await benchAsync(
    async () => {
      const ds = await populateDatastore(size, configOverrides);
      const all = await ds.getAll();
      const targets = all.slice(0, updateCount);
      return { ds, targets };
    },
    async (ctx) => {
      for (const record of ctx.targets) {
        await ctx.ds.updateById(record._id, {
          value: record.payload.value + 1000,
        });
      }
    },
  );
  return { elapsedNs, operationCount: updateCount };
};

const benchDeleteByKey = async (size, configOverrides) => {
  const deleteOrder = createShuffledIndices(size, 0x81a5c3 + size);
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      for (const idx of deleteOrder) {
        await ctx.ds.delete(padKey(idx));
      }
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchDeleteById = async (size, configOverrides) => {
  const elapsedNs = await benchAsync(
    async () => {
      const ds = await populateDatastore(size, configOverrides);
      const all = await ds.getAll();
      return { ds, ids: all.map((r) => r._id) };
    },
    async (ctx) => {
      for (const id of ctx.ids) {
        await ctx.ds.deleteById(id);
      }
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchReplaceById = async (size, configOverrides) => {
  const replaceCount = Math.min(size, 1000);
  const elapsedNs = await benchAsync(
    async () => {
      const ds = await populateDatastore(size, configOverrides);
      const all = await ds.getAll();
      const targets = all.slice(0, replaceCount);
      return { ds, targets };
    },
    async (ctx) => {
      for (const record of ctx.targets) {
        await ctx.ds.replaceById(record._id, {
          name: `replaced-${record.payload.value}`,
          score: record.payload.value * 10,
        });
      }
    },
  );
  return { elapsedNs, operationCount: replaceCount };
};

const benchDeleteMany = async (size, configOverrides) => {
  const keys = Array.from({ length: size }, (_, i) => padKey(i));
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      await ctx.ds.deleteMany(keys);
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchDeleteByIds = async (size, configOverrides) => {
  const elapsedNs = await benchAsync(
    async () => {
      const ds = await populateDatastore(size, configOverrides);
      const all = await ds.getAll();
      return { ds, ids: all.map((r) => r._id) };
    },
    async (ctx) => {
      await ctx.ds.deleteByIds(ctx.ids);
    },
  );
  return { elapsedNs, operationCount: size };
};

// ---------------------------------------------------------------------------
// Raw BTree baselines (no Datastore overhead)
// ---------------------------------------------------------------------------

const benchRawBTreePut = async (size) => {
  const elapsedNs = await benchAsync(
    async () => {
      const tree = new InMemoryBTreeClass({
        compareKeys: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      });
      return { ds: null, tree };
    },
    async (ctx) => {
      for (let i = 0; i < size; i += 1) {
        ctx.tree.put(padKey(i), { payload: generatePayload(i) });
      }
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchRawBTreePutMany = async (size) => {
  const entries = Array.from({ length: size }, (_, i) => ({
    key: padKey(i),
    value: { payload: generatePayload(i) },
  }));
  const elapsedNs = await benchAsync(
    async () => {
      const tree = new InMemoryBTreeClass({
        compareKeys: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      });
      return { ds: null, tree };
    },
    async (ctx) => {
      ctx.tree.putMany(entries);
    },
  );
  return { elapsedNs, operationCount: size };
};

const benchClear = async (size, configOverrides) => {
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      await ctx.ds.clear();
    },
  );
  return { elapsedNs, operationCount: 1 };
};

const benchCount = async (size, configOverrides) => {
  const iterations = Math.max(1000, size);
  const elapsedNs = await benchAsync(
    async () => ({ ds: await populateDatastore(size, configOverrides) }),
    async (ctx) => {
      let checksum = 0;
      for (let i = 0; i < iterations; i += 1) {
        checksum ^= await ctx.ds.count();
      }
      sideEffectSink ^= checksum;
    },
  );
  return { elapsedNs, operationCount: iterations };
};

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const formatNumber = (value, fractionDigits) => value.toFixed(fractionDigits);

const CONSTANT_TIME_OPS = new Set(['getAll', 'clear', 'count']);

const OP_CATEGORIES = {
  write: { label: 'Write', ops: ['put', 'putMany'] },
  read: {
    label: 'Read',
    ops: ['get', 'getFirst', 'has', 'getAll', 'getRange', 'getMany'],
  },
  update: { label: 'Update', ops: ['updateById', 'replaceById'] },
  delete: {
    label: 'Delete',
    ops: ['delete', 'deleteById', 'deleteMany', 'deleteByIds'],
  },
  meta: { label: 'Metadata', ops: ['count', 'clear'] },
};

const printLine = (char, width) => console.log(char.repeat(width));

const TABLE_WIDTH = 78;

const printTableHeader = (columns, widths) => {
  const header = columns.map((col, i) => col.padEnd(widths[i])).join('  ');
  console.log(header);
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
};

const printTableRow = (cells, widths, alignRight = []) => {
  const formatted = cells.map((cell, i) =>
    alignRight.includes(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]),
  );
  console.log(formatted.join('  '));
};

const DEFAULT_COLS = [
  'Operation',
  'N',
  'Median (ms)',
  'ns/op',
  'Normalized',
  'Ratio',
];
const DEFAULT_WIDTHS = [14, 7, 12, 12, 16, 7];
const DEFAULT_ALIGN_RIGHT = [1, 2, 3, 4, 5];

const VARIANT_COLS = [
  'Config',
  'Operation',
  'N',
  'Median (ms)',
  'ns/op',
  'Normalized',
  'Ratio',
];
const VARIANT_WIDTHS = [13, 14, 7, 12, 12, 16, 7];
const VARIANT_ALIGN_RIGHT = [2, 3, 4, 5, 6];

const formatNsPerOp = (nsPerOp, isConstant) =>
  isConstant
    ? `${formatNumber(nsPerOp, 2)}ns`
    : `${formatNumber(nsPerOp, 2)}ns/lg`;

const computeBaselines = (rows) => {
  const baselines = new Map();
  for (const row of rows) {
    if (!baselines.has(row.operation)) {
      const nsPerOp = row.elapsedNs / row.operationCount;
      const isConstant = CONSTANT_TIME_OPS.has(row.operation);
      baselines.set(
        row.operation,
        isConstant ? nsPerOp : nsPerOp / Math.log2(row.size),
      );
    }
  }
  return baselines;
};

const printGroupedRows = (rows, baselines) => {
  const printed = new Set();
  for (const category of Object.values(OP_CATEGORIES)) {
    const categoryRows = rows.filter((r) => category.ops.includes(r.operation));
    if (categoryRows.length === 0) continue;

    for (const row of categoryRows) {
      const nsPerOp = row.elapsedNs / row.operationCount;
      const isConstant = CONSTANT_TIME_OPS.has(row.operation);
      const normalized = isConstant ? nsPerOp : nsPerOp / Math.log2(row.size);
      const baseline = baselines.get(row.operation);
      const ratio = baseline === undefined ? 1 : normalized / baseline;

      printTableRow(
        [
          row.operation,
          String(row.size),
          formatNumber(row.elapsedNs / 1e6, 3),
          formatNumber(nsPerOp, 2),
          formatNsPerOp(normalized, isConstant),
          formatNumber(ratio, 2),
        ],
        DEFAULT_WIDTHS,
        DEFAULT_ALIGN_RIGHT,
      );
      printed.add(row);
    }
  }

  // Print any uncategorized rows at the end
  for (const row of rows) {
    if (printed.has(row)) continue;
    const nsPerOp = row.elapsedNs / row.operationCount;
    const isConstant = CONSTANT_TIME_OPS.has(row.operation);
    const normalized = isConstant ? nsPerOp : nsPerOp / Math.log2(row.size);
    const baseline = baselines.get(row.operation);
    const ratio = baseline === undefined ? 1 : normalized / baseline;

    printTableRow(
      [
        row.operation,
        String(row.size),
        formatNumber(row.elapsedNs / 1e6, 3),
        formatNumber(nsPerOp, 2),
        formatNsPerOp(normalized, isConstant),
        formatNumber(ratio, 2),
      ],
      DEFAULT_WIDTHS,
      DEFAULT_ALIGN_RIGHT,
    );
  }
};

// ---------------------------------------------------------------------------
// Dist freshness check
// ---------------------------------------------------------------------------

const collectSourceFiles = async (dirPath) => {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
};

const assertDistFresh = async () => {
  const distPath = path.resolve(process.cwd(), 'dist', 'index.js');
  const srcPath = path.resolve(process.cwd(), 'src');

  let distStats;
  try {
    await access(distPath);
    distStats = await stat(distPath);
  } catch {
    throw new Error(
      'dist/index.js not found. Run `pnpm build` before `pnpm bench`.',
    );
  }

  const sourceFiles = await collectSourceFiles(srcPath);
  let latestMtimeMs = 0;
  for (const f of sourceFiles) {
    const s = await stat(f);
    if (s.mtimeMs > latestMtimeMs) latestMtimeMs = s.mtimeMs;
  }

  if (latestMtimeMs > distStats.mtimeMs) {
    throw new Error(
      'src/ is newer than dist/. Run `pnpm build` before `pnpm bench`.',
    );
  }
};

// ---------------------------------------------------------------------------
// Benchmark suites
// ---------------------------------------------------------------------------

const runDefaultBenchmarks = async () => {
  const rows = [];

  for (const size of INPUT_SIZES) {
    const ops = [
      { name: 'put', fn: benchPut },
      { name: 'putMany', fn: benchPutMany },
      { name: 'get', fn: benchGet },
      { name: 'getFirst', fn: benchGetFirst },
      { name: 'has', fn: benchHas },
      { name: 'getAll', fn: benchGetAll },
      { name: 'getRange', fn: benchGetRange },
      { name: 'getMany', fn: benchGetMany },
      { name: 'count', fn: benchCount },
      { name: 'updateById', fn: benchUpdateById },
      { name: 'replaceById', fn: benchReplaceById },
      { name: 'delete', fn: benchDeleteByKey },
      { name: 'deleteById', fn: benchDeleteById },
      { name: 'deleteMany', fn: benchDeleteMany },
      { name: 'deleteByIds', fn: benchDeleteByIds },
      { name: 'clear', fn: benchClear },
    ];

    for (const op of ops) {
      const result = await op.fn(size);
      rows.push({
        operation: op.name,
        size,
        elapsedNs: result.elapsedNs,
        operationCount: result.operationCount,
      });
    }
  }

  return rows;
};

const VARIANT_OPS = [
  'put',
  'putMany',
  'get',
  'updateById',
  'replaceById',
  'delete',
  'deleteByIds',
];

const runVariantBenchmarks = async () => {
  const configs = [
    { label: 'dup-replace', overrides: { duplicateKeys: 'replace' } },
    { label: 'dup-reject', overrides: { duplicateKeys: 'reject' } },
    {
      label: 'cap-strict',
      overrides: { capacity: { maxSize: '100MB', policy: 'strict' } },
    },
    {
      label: 'cap-turnover',
      overrides: { capacity: { maxSize: '100MB', policy: 'turnover' } },
    },
  ];

  const benchFns = {
    put: benchPut,
    putMany: benchPutMany,
    get: benchGet,
    updateById: benchUpdateById,
    replaceById: benchReplaceById,
    delete: benchDeleteByKey,
    deleteByIds: benchDeleteByIds,
  };

  const rows = [];
  for (const { label, overrides } of configs) {
    for (const size of INPUT_SIZES) {
      for (const opName of VARIANT_OPS) {
        const result = await benchFns[opName](size, overrides);
        rows.push({
          config: label,
          operation: opName,
          size,
          elapsedNs: result.elapsedNs,
          operationCount: result.operationCount,
        });
      }
    }
  }

  return rows;
};

// ---------------------------------------------------------------------------
// Concurrent workload benchmark
// ---------------------------------------------------------------------------

const benchConcurrentReadWrite = async (size) => {
  const ds = await populateDatastore(size);
  const queryOrder = createShuffledIndices(size, 0x9e12c4 + size);
  const writeCount = Math.floor(size / 4);
  const readCount = size;

  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    const reads = (async () => {
      let checksum = 0;
      for (let i = 0; i < readCount; i += 1) {
        const r = await ds.get(padKey(queryOrder[i % queryOrder.length]));
        checksum ^= r.length;
      }
      sideEffectSink ^= checksum;
    })();
    const writes = (async () => {
      for (let i = 0; i < writeCount; i += 1) {
        await ds.put({
          key: padKey(size + i),
          payload: generatePayload(size + i),
        });
      }
    })();
    await Promise.all([reads, writes]);
    for (let i = 0; i < writeCount; i += 1) {
      await ds.delete(padKey(size + i));
    }
  }

  const elapsedByRound = [];
  for (let round = 0; round < MEASURE_ROUNDS; round += 1) {
    const start = nowNs();
    const reads = (async () => {
      let checksum = 0;
      for (let i = 0; i < readCount; i += 1) {
        const r = await ds.get(padKey(queryOrder[i % queryOrder.length]));
        checksum ^= r.length;
      }
      sideEffectSink ^= checksum;
    })();
    const writes = (async () => {
      for (let i = 0; i < writeCount; i += 1) {
        await ds.put({
          key: padKey(size + i),
          payload: generatePayload(size + i),
        });
      }
    })();
    await Promise.all([reads, writes]);
    const end = nowNs();
    elapsedByRound.push(Number(end - start));

    for (let i = 0; i < writeCount; i += 1) {
      await ds.delete(padKey(size + i));
    }
  }

  await ds.close();
  const totalOps = readCount + writeCount;
  return { elapsedNs: median(elapsedByRound), operationCount: totalOps };
};

// ---------------------------------------------------------------------------
// P5 Optimization Impact — raw BTree vs Datastore, no-capacity vs capacity
// ---------------------------------------------------------------------------

const P5_SIZES = [4096, 16384, 65536];
const P5_WIDTHS = [14, 10, 8, 12, 12, 14];

const runP5Benchmarks = async () => {
  const rows = [];

  for (const size of P5_SIZES) {
    // Raw BTree baselines
    const rawPut = await benchRawBTreePut(size);
    rows.push({ layer: 'BTree', operation: 'put', size, ...rawPut });

    const rawPutMany = await benchRawBTreePutMany(size);
    rows.push({ layer: 'BTree', operation: 'putMany', size, ...rawPutMany });

    // Datastore: no capacity (P5-A fast path)
    const dsPut = await benchPut(size);
    rows.push({ layer: 'DS', operation: 'put', size, ...dsPut });

    const dsPutMany = await benchPutMany(size);
    rows.push({ layer: 'DS', operation: 'putMany', size, ...dsPutMany });

    // Datastore: skipPayloadValidation (P6 trusted input)
    const skipOverrides = { skipPayloadValidation: true };
    const dsSkipPut = await benchPut(size, skipOverrides);
    rows.push({ layer: 'DS+skip', operation: 'put', size, ...dsSkipPut });

    const dsSkipPutMany = await benchPutMany(size, skipOverrides);
    rows.push({
      layer: 'DS+skip',
      operation: 'putMany',
      size,
      ...dsSkipPutMany,
    });

    // Datastore: strict capacity (P5-B batch path)
    const capOverrides = { capacity: { maxSize: '100MB', policy: 'strict' } };
    const dsPutCap = await benchPut(size, capOverrides);
    rows.push({ layer: 'DS+cap', operation: 'put', size, ...dsPutCap });

    const dsPutManyCap = await benchPutMany(size, capOverrides);
    rows.push({ layer: 'DS+cap', operation: 'putMany', size, ...dsPutManyCap });
  }

  return rows;
};

const P5_COLS = ['Layer', 'Operation', 'N', 'Median (ms)', 'ns/op', 'vs BTree'];
const P5_COL_WIDTHS = [10, 10, 7, 12, 12, 9];
const P5_ALIGN_RIGHT = [2, 3, 4, 5];

const printP5Section = (rows) => {
  printTableHeader(P5_COLS, P5_COL_WIDTHS);

  // Build baselines from BTree rows for each (operation, size) pair
  const btreeBaseline = new Map();
  for (const row of rows) {
    if (row.layer === 'BTree') {
      btreeBaseline.set(
        `${row.operation}:${row.size}`,
        row.elapsedNs / row.operationCount,
      );
    }
  }

  for (const row of rows) {
    const nsPerOp = row.elapsedNs / row.operationCount;
    const baseKey = `${row.operation}:${row.size}`;
    const base = btreeBaseline.get(baseKey);
    const ratio =
      base !== undefined ? `${formatNumber(nsPerOp / base, 2)}x` : '1.00x';

    printTableRow(
      [
        row.layer,
        row.operation,
        String(row.size),
        formatNumber(row.elapsedNs / 1e6, 3),
        formatNumber(nsPerOp, 2),
        ratio,
      ],
      P5_COL_WIDTHS,
      P5_ALIGN_RIGHT,
    );
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const run = async () => {
  await assertDistFresh();
  const mod = await import('../dist/index.js');
  DatastoreClass = mod.Datastore;
  const btreeMod = await import('@frostpillar/frostpillar-btree');
  InMemoryBTreeClass = btreeMod.InMemoryBTree;

  printLine('=', TABLE_WIDTH);
  console.log('  Frostpillar Storage Engine \u2014 Benchmark Suite');
  printLine('=', TABLE_WIDTH);
  console.log();
  console.log(`  Runtime:     Node.js ${process.version}`);
  console.log(`  Date:        ${new Date().toISOString()}`);
  console.log(`  Warmup:      ${WARMUP_ROUNDS} round(s)`);
  console.log(`  Measure:     ${MEASURE_ROUNDS} rounds (median)`);
  console.log(`  Input sizes: ${INPUT_SIZES.join(', ')}`);
  console.log();

  // --- Section 1: P5 Optimization Impact ---
  printLine('-', TABLE_WIDTH);
  console.log('  1. Write-Path Overhead: Raw BTree vs Datastore Layers');
  printLine('-', TABLE_WIDTH);
  console.log();
  const p5Rows = await runP5Benchmarks();
  printP5Section(p5Rows);

  // --- Section 2: Default benchmarks ---
  console.log();
  printLine('-', TABLE_WIDTH);
  console.log('  2. Core Operations (default config)');
  printLine('-', TABLE_WIDTH);
  console.log();
  const defaultRows = await runDefaultBenchmarks();
  const defaultBaselines = computeBaselines(defaultRows);
  printTableHeader(DEFAULT_COLS, DEFAULT_WIDTHS);
  printGroupedRows(defaultRows, defaultBaselines);

  // --- Section 3: Config variants ---
  console.log();
  printLine('-', TABLE_WIDTH);
  console.log('  3. Config Variants (duplicate key policies, capacity modes)');
  printLine('-', TABLE_WIDTH);
  console.log();
  const variantRows = await runVariantBenchmarks();
  const variantBaselines = new Map();
  for (const row of variantRows) {
    const key = `${row.config}:${row.operation}`;
    if (!variantBaselines.has(key)) {
      const nsPerOp = row.elapsedNs / row.operationCount;
      variantBaselines.set(key, nsPerOp / Math.log2(row.size));
    }
  }
  printTableHeader(VARIANT_COLS, VARIANT_WIDTHS);
  for (const row of variantRows) {
    const key = `${row.config}:${row.operation}`;
    const nsPerOp = row.elapsedNs / row.operationCount;
    const normalized = nsPerOp / Math.log2(row.size);
    const baseline = variantBaselines.get(key);
    const ratio = baseline === undefined ? 1 : normalized / baseline;

    printTableRow(
      [
        row.config,
        row.operation,
        String(row.size),
        formatNumber(row.elapsedNs / 1e6, 3),
        formatNumber(nsPerOp, 2),
        `${formatNumber(normalized, 2)}ns/lg`,
        formatNumber(ratio, 2),
      ],
      VARIANT_WIDTHS,
      VARIANT_ALIGN_RIGHT,
    );
  }

  // --- Section 4: Concurrent read/write ---
  console.log();
  printLine('-', TABLE_WIDTH);
  console.log('  4. Concurrent Read + Write Workload');
  printLine('-', TABLE_WIDTH);
  console.log();
  const concurrentSize = INPUT_SIZES[INPUT_SIZES.length > 1 ? 1 : 0];
  const concResult = await benchConcurrentReadWrite(concurrentSize);
  const concNsPerOp = concResult.elapsedNs / concResult.operationCount;
  console.log(`  N:         ${concurrentSize}`);
  console.log(`  Total ops: ${concResult.operationCount}`);
  console.log(`  Median:    ${formatNumber(concResult.elapsedNs / 1e6, 3)} ms`);
  console.log(`  ns/op:     ${formatNumber(concNsPerOp, 2)}`);

  if (sideEffectSink === Number.MIN_SAFE_INTEGER) {
    console.error('unreachable branch for side-effect sink');
  }

  console.log();
  printLine('=', TABLE_WIDTH);
  console.log('  Benchmark complete.');
  printLine('=', TABLE_WIDTH);
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
