# Frostpillar Storage Engine

[English/英語](./README.md) | [Japanese/日本語](./README-JA.md)

[![npm version](https://img.shields.io/npm/v/@frostpillar/frostpillar-storage-engine)](https://www.npmjs.com/package/@frostpillar/frostpillar-storage-engine)
[![Node.js >=24](https://img.shields.io/badge/Node.js-%3E%3D24-green.svg)](https://nodejs.org/)
[![CI](https://github.com/hjmsano/frostpillar-storage-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/hjmsano/frostpillar-storage-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight embedded key-value database for JavaScript. Store and retrieve structured records in Node.js, browsers, or browser extensions — no server required.

Under the hood it is a chunk-based storage engine that packs many small entries into a single backing store with pluggable drivers, capacity control, and auto-commit support. It is part of the Frostpillar ecosystem:

```
frostpillar-db          — Database management and orchestration, also provide native query interface
├── frostpillar-query-interface  — SQL-like / Lucene-like query API
├── frostpillar-storage-engine   — Core storage and chunk handling (this package)
│   └── frostpillar-btree        — B+ tree indexing
frostpillar-http-api    — RESTful API layer
frostpillar-mcp         — MCP interface for AI agent integration
frostpillar-cli         — Command-line interface
```

## Features

- **Multi-runtime** — works in Node.js, browsers, and browser extensions
- **Pluggable drivers** — in-memory, file, localStorage, IndexedDB, OPFS, and browser extension sync storage
- **Capacity control** — strict quota enforcement or automatic turnover eviction
- **Auto-commit** — configurable interval and byte-threshold based background persistence
- **Custom keys** — bring your own key type with normalize/compare/serialize/deserialize
- **Tree-shakable** — ESM with `sideEffects: false`; unused drivers are eliminated by bundlers
- **Zero third-party runtime dependencies** — only Frostpillar family packages

## Quick Example

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({});

await db.put({
  key: 'tenant-001',
  payload: { event: 'login', userId: 'u-001' },
});

const rows = await db.get('tenant-001');
console.log(rows[0].payload.event); // login

await db.close();
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({});

await db.put({
  key: 'user-001',
  payload: { event: 'open' },
});

const rows = await db.get('user-001');
console.log(rows[0].payload.event); // open
```

**Browser (Bundle):**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({});

await db.put({
  key: 'user-001',
  payload: { event: 'open' },
});

const rows = await db.get('user-001');
console.log(rows[0].payload.event); // open
```

> **Note:** The IIFE bundle includes `Datastore`, error classes, and browser storage drivers (`localStorageDriver`, `indexedDBDriver`, `opfsDriver`, `syncStorageDriver`). `fileDriver` is Node.js-only and is not included — import it from the subpath `@frostpillar/frostpillar-storage-engine/drivers/file`.

---

## Table of Contents

- [Getting Started](#getting-started)
- [User Manual](#user-manual)
  - [Core Concepts](#core-concepts)
  - [CRUD Operations](#crud-operations)
  - [Record ID (`_id`)](#record-id-_id)
  - [Storage Drivers](#storage-drivers)
  - [Auto-Commit](#auto-commit)
  - [Capacity Control](#capacity-control)
  - [Custom Key Definition](#custom-key-definition)
  - [Error Handling](#error-handling)
- [API Reference](#api-reference)
- [How to Contribute](#how-to-contribute)
- [License](#license)

---

## Getting Started

### Installation (Node.js / TypeScript)

```bash
pnpm add @frostpillar/frostpillar-storage-engine
```

This package is published to [npm](https://www.npmjs.com/package/@frostpillar/frostpillar-storage-engine).

### Installation (Browser)

Download the minified IIFE bundle from [GitHub Releases](https://github.com/hjmsano/frostpillar-storage-engine/releases) and load it with a `<script>` tag. Replace `<TAG>` with a released tag (e.g. `v0.2.1`).

```html
<script src="https://github.com/hjmsano/frostpillar-storage-engine/releases/download/<TAG>/frostpillar-storage-engine.min.js"></script>
```

`Datastore`, error classes, and browser storage drivers (`localStorageDriver`, `indexedDBDriver`, `opfsDriver`, `syncStorageDriver`) are available on `window.FrostpillarStorageEngine`. No `type="module"` is required.

### Compatibility

| Environment | Requirement                                                       |
| ----------- | ----------------------------------------------------------------- |
| Node.js     | >= 24.0.0 (ESM and CJS)                                           |
| Browser     | ES2020-compatible (Chrome 80+, Firefox 74+, Safari 14+, Edge 80+) |
| TypeScript  | >= 5.0                                                            |

> **Pre-1.0 notice:** This package follows [SemVer](https://semver.org/). While the major version is `0`, minor version bumps may include breaking changes. Pin your dependency version and review changelogs before upgrading.

---

## User Manual

### Core Concepts

**Datastore** is the single entry point. The basic lifecycle is:

1. **Create** — `new Datastore(config)` (in-memory by default, or pass a `driver`)
2. **Write** — `put()` / `putMany()` to insert records
3. **Read** — `get()`, `getFirst()`, `getLast()`, `getAll()`, etc.
4. **Persist** — `commit()` flushes to durable storage (or use `autoCommit`)
5. **Close** — `close()` releases resources and locks

Each record has:

| Field     | Description                                     |
| --------- | ----------------------------------------------- |
| `key`     | User-provided lookup key (string by default)    |
| `payload` | JSON-compatible data object                     |
| `_id`     | Ephemeral system-generated `EntryId`, read-only |

> **Defensive cloning:** Payloads are defensively cloned at insertion time but are **not** frozen. Read APIs return internal references without cloning. Mutating a returned payload will **not** throw, but may corrupt internal state — treat returned payloads as read-only. If you need a mutable copy, clone it yourself (e.g. `structuredClone(record.payload)`).

Records are ordered by `key` ascending (lexicographic by default), then by insertion order ascending for ties.

#### Duplicate Key Policy

By default, duplicate keys are allowed (multiple records can share the same key). Configure the policy at construction:

**Node.js / TypeScript:**

```ts
const db = new Datastore({
  duplicateKeys: 'allow', // default — multiple records per key
  // duplicateKeys: 'replace', // one record per key, last-write-wins
  // duplicateKeys: 'reject',  // one record per key, throws on duplicate
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({
  duplicateKeys: 'allow', // default — multiple records per key
  // duplicateKeys: 'replace', // one record per key, last-write-wins
  // duplicateKeys: 'reject',  // one record per key, throws on duplicate
});
```

**Browser (Bundle):**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({
  duplicateKeys: 'allow', // default — multiple records per key
  // duplicateKeys: 'replace', // one record per key, last-write-wins
  // duplicateKeys: 'reject',  // one record per key, throws on duplicate
});
```

| Policy      | Behavior                              | Use case                  |
| ----------- | ------------------------------------- | ------------------------- |
| `'allow'`   | Multiple records per key              | Logs, events, time-series |
| `'replace'` | Last-write-wins overwrite             | Config, settings, cache   |
| `'reject'`  | Throws `ValidationError` on duplicate | Unique constraints        |

#### Payload Validation

Payloads are validated on every `put()`, `putMany()`, and `updateById()` call. The following limits apply:

| Constraint | Limit |
|------------|-------|
| Total payload bytes | 1,048,576 (1 MB) |
| Max nesting depth | 64 object levels |
| Max total keys | 4,096 |
| Max keys per object | 256 |
| Max key size | 1,024 bytes (UTF-8) |
| Max string value | 65,535 bytes (UTF-8) |

Additional rules:
- Payload must be a plain object (no arrays, functions, or `BigInt` at top level).
- Keys must be non-empty, non-whitespace strings.
- Reserved keys (`__proto__`, `constructor`, `prototype`) are forbidden.
- Circular references are forbidden.
- Violations throw `ValidationError`.

For trusted input where you control the shape, you can skip validation:

```ts
const db = new Datastore({ skipPayloadValidation: true });
```

> **Warning:** Skipping validation disables all payload safety checks. Only use this when you are certain the input is well-formed.

---

### CRUD Operations

#### Write

**`put(record)`** — insert a single record.

```ts
await db.put({ key: 'k1', payload: { name: 'Alice' } });
```

**`putMany(records)`** — insert multiple records (non-atomic, left-to-right).

```ts
await db.putMany([
  { key: 'k1', payload: { name: 'Alice' } },
  { key: 'k2', payload: { name: 'Bob' } },
]);
```

`put()` inserts a record. Duplicate key behavior depends on the `duplicateKeys` policy (default: `'allow'`).

#### Read

**`get(key)`** — all records matching `key`.

```ts
const rows = await db.get('k1');
```

**`getFirst(key)`** — first record matching `key`, or `null`.

```ts
const row = await db.getFirst('k1');
```

**`getLast(key)`** — last record matching `key`, or `null`. When `duplicateKeys` is `'replace'` or `'reject'`, behaves identically to `getFirst()`.

```ts
const row = await db.getLast('k1');
```

**`getById(id)`** — single record by `_id`, or `null`.

```ts
const row = await db.getById(id);
```

**`getAll()`** — all records, ordered by key then insertion order.

```ts
const all = await db.getAll();
```

**`getRange(start, end)`** — records where `start <= key <= end` (inclusive).

```ts
const range = await db.getRange('a', 'f');
```

**`getMany(keys)`** — records for a set of discrete keys.

```ts
const rows = await db.getMany(['k1', 'k3', 'k5']);
```

**`has(key)`** — check if any record exists with the given key.

```ts
const exists = await db.has('k1');
```

All record-returning APIs include the `_id` field in the result.

#### Update

**`updateById(id, patch)`** — shallow-merge `patch` into the existing payload. Returns `true` if found, `false` otherwise. Does not change `key` or `_id`.

```ts
const updated = await db.updateById(id, { name: 'Alice V2' });
```

#### Delete

**`delete(key)`** — remove all records with `key`. Returns the number of records removed.

```ts
const count = await db.delete('k1');
```

**`deleteById(id)`** — remove a single record by `_id`. Returns `true` if found.

```ts
const removed = await db.deleteById(id);
```

**`deleteMany(keys)`** — remove records across multiple keys (non-atomic). Returns total removed.

```ts
const count = await db.deleteMany(['k1', 'k2']);
```

**`clear()`** — remove all records.

```ts
await db.clear();
```

#### Metadata

**`count()`** — total number of records.

```ts
const n = await db.count();
```

**`keys()`** — distinct keys in ascending order (no duplicates, no payload loaded).

```ts
const allKeys = await db.keys();
```

---

### Record ID (`_id`)

`_id` is a system-generated `EntryId` (a branded number) included in every record returned by read APIs. It is ephemeral — re-issued when the datastore is restored from persistent storage.

- You do not get an `_id` back from `put()` — discover it by reading records.
- After restart or `fromJSON()` restoration, previously obtained `_id` values become invalid. Re-query to obtain new ones.
- `EntryId` is re-exported from the package for type annotations:

**Node.js / TypeScript:**

```ts
import type { EntryId } from '@frostpillar/frostpillar-storage-engine';
```

**Browser (ESM / Bundle):**

```js
// EntryId is a plain number at runtime — no import needed.
// Use it directly from record results:
const record = await db.getFirst('k1');
const id = record._id; // EntryId
```

---

### Storage Drivers

#### Driver Comparison

| Driver               | Environment       | Persistence                                    | Typical Use Case                |
| -------------------- | ----------------- | ---------------------------------------------- | ------------------------------- |
| _(none)_             | Node.js / Browser | In-memory only                                 | Caches, tests, ephemeral data   |
| `fileDriver`         | Node.js           | File system                                    | Server-side durable storage     |
| `localStorageDriver` | Browser           | localStorage                                   | Small browser-side persistence  |
| `indexedDBDriver`    | Browser           | IndexedDB                                      | Larger browser-side storage     |
| `opfsDriver`         | Browser           | Origin Private File System                     | High-throughput browser storage |
| `syncStorageDriver`  | Browser Extension | `browser.storage.sync` / `chrome.storage.sync` | Cross-device extension data     |

#### In-Memory (default)

No driver needed. Data lives only in memory.

**Node.js / TypeScript:**

```ts
const db = new Datastore({});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({});
```

**Browser (Bundle):**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({});
```

#### File Driver (Node.js)

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';

const db = new Datastore({
  autoCommit: {
    frequency: '5s',
    maxPendingBytes: 1024 * 1024,
  },
  driver: fileDriver({
    filePath: './data/events.fpdb',
  }),
});

await db.put({
  key: 'tenant-001',
  payload: { event: 'purchase', amount: 1200 },
});

await db.commit();
await db.close();
```

| Option | Type | Description |
|--------|------|-------------|
| `filePath` | `string` | Direct path to the data file (e.g. `'./data/events.fpdb'`) |

Alternatively, use directory-based targeting via the `target` option:

| Option | Type | Description |
|--------|------|-------------|
| `target.kind` | `'directory'` | Use directory-based file resolution |
| `target.directory` | `string` | Directory containing the data file |
| `target.fileName` | `string` | Optional file name (default: auto-generated) |
| `target.filePrefix` | `string` | Optional file name prefix |

**Lock file behavior:**

`fileDriver` uses `${filePath}.lock` to enforce a single writer. If a process exits without calling `close()`, subsequent opens fail with `DatabaseLockedError`.

Recovery steps:

1. Verify no active writer process is using the same datastore file.
2. Remove the stale lock file manually (`<resolved-data-file>.lock`).
3. Reopen the datastore.

> **Note:** `fileDriver` is Node.js-only and is **not** included in the browser IIFE bundle. Import it from the subpath `@frostpillar/frostpillar-storage-engine/drivers/file`.

#### localStorage Driver

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { localStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/localStorage';

const db = new Datastore({
  driver: localStorageDriver({
    databaseKey: 'app-events',
    keyPrefix: 'frostpillar',
    maxChunkChars: 32768,
    maxChunks: 64,
  }),
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { localStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/localStorage';

const db = new Datastore({
  driver: localStorageDriver({
    databaseKey: 'app-events',
    keyPrefix: 'frostpillar',
    maxChunkChars: 32768,
    maxChunks: 64,
  }),
});
```

**Browser (Bundle):**

```js
const { Datastore, localStorageDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  driver: localStorageDriver({
    databaseKey: 'app-events',
    keyPrefix: 'frostpillar',
    maxChunkChars: 32768,
    maxChunks: 64,
  }),
});
```

| Option          | Type     | Description                                            |
| --------------- | -------- | ------------------------------------------------------ |
| `databaseKey`   | `string` | Logical database name within localStorage              |
| `keyPrefix`     | `string` | Prefix for all localStorage keys (namespace isolation) |
| `maxChunkChars` | `number` | Maximum characters per chunk                           |
| `maxChunks`     | `number` | Maximum number of chunks                               |

#### IndexedDB Driver

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { indexedDBDriver } from '@frostpillar/frostpillar-storage-engine/drivers/indexedDB';

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: indexedDBDriver({
    databaseName: 'frostpillar-demo',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { indexedDBDriver } from '@frostpillar/frostpillar-storage-engine/drivers/indexedDB';

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: indexedDBDriver({
    databaseName: 'frostpillar-demo',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

**Browser (Bundle):**

```js
const { Datastore, indexedDBDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: indexedDBDriver({
    databaseName: 'frostpillar-demo',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

| Option            | Type     | Description                           |
| ----------------- | -------- | ------------------------------------- |
| `databaseName`    | `string` | IndexedDB database name               |
| `objectStoreName` | `string` | Object store name within the database |
| `version`         | `number` | Database schema version               |

#### OPFS Driver

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { opfsDriver } from '@frostpillar/frostpillar-storage-engine/drivers/opfs';

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: opfsDriver({
    directoryName: 'frostpillar-opfs',
  }),
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { opfsDriver } from '@frostpillar/frostpillar-storage-engine/drivers/opfs';

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: opfsDriver({
    directoryName: 'frostpillar-opfs',
  }),
});
```

**Browser (Bundle):**

```js
const { Datastore, opfsDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: opfsDriver({
    directoryName: 'frostpillar-opfs',
  }),
});
```

| Option          | Type     | Description         |
| --------------- | -------- | ------------------- |
| `directoryName` | `string` | OPFS directory name |

#### Sync Storage Driver (Browser Extensions)

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { syncStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/syncStorage';

const db = new Datastore({
  capacity: {
    maxSize: 'backendLimit',
    policy: 'strict',
  },
  autoCommit: {
    frequency: '10s',
    maxPendingBytes: 32768,
  },
  driver: syncStorageDriver({
    databaseKey: 'extension-events',
    keyPrefix: 'frostpillar-ext',
    maxChunkChars: 6000,
    maxChunks: 128,
    maxItemBytes: 8192,
    maxTotalBytes: 102400,
    maxItems: 256,
  }),
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { syncStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/syncStorage';

const db = new Datastore({
  capacity: {
    maxSize: 'backendLimit',
    policy: 'strict',
  },
  autoCommit: {
    frequency: '10s',
    maxPendingBytes: 32768,
  },
  driver: syncStorageDriver({
    databaseKey: 'extension-events',
    keyPrefix: 'frostpillar-ext',
    maxChunkChars: 6000,
    maxChunks: 128,
    maxItemBytes: 8192,
    maxTotalBytes: 102400,
    maxItems: 256,
  }),
});
```

**Browser (Bundle):**

```js
const { Datastore, syncStorageDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  capacity: {
    maxSize: 'backendLimit',
    policy: 'strict',
  },
  autoCommit: {
    frequency: '10s',
    maxPendingBytes: 32768,
  },
  driver: syncStorageDriver({
    databaseKey: 'extension-events',
    keyPrefix: 'frostpillar-ext',
    maxChunkChars: 6000,
    maxChunks: 128,
    maxItemBytes: 8192,
    maxTotalBytes: 102400,
    maxItems: 256,
  }),
});
```

| Option          | Type     | Description                                   |
| --------------- | -------- | --------------------------------------------- |
| `databaseKey`   | `string` | Logical database name                         |
| `keyPrefix`     | `string` | Prefix for storage keys (namespace isolation) |
| `maxChunkChars` | `number` | Maximum characters per chunk                  |
| `maxChunks`     | `number` | Maximum number of chunks                      |
| `maxItemBytes`  | `number` | Maximum bytes per storage item                |
| `maxTotalBytes` | `number` | Maximum total bytes across all items          |
| `maxItems`      | `number` | Maximum number of storage items               |

When both APIs are available, the driver prefers the `browser.storage.sync` Promise API and falls back to `chrome.storage.sync` callback API.

---

### Auto-Commit

With durable drivers, you can configure automatic background persistence instead of calling `commit()` manually.

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';

const db = new Datastore({
  autoCommit: {
    frequency: '5s', // commit every 5 seconds
    maxPendingBytes: 1024 * 1024, // or when 1 MB of writes are pending
  },
  driver: fileDriver({ filePath: './data/events.fpdb' }),
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { indexedDBDriver } from '@frostpillar/frostpillar-storage-engine/drivers/indexedDB';

const db = new Datastore({
  autoCommit: {
    frequency: '5s', // commit every 5 seconds
    maxPendingBytes: 1024 * 1024, // or when 1 MB of writes are pending
  },
  driver: indexedDBDriver({
    databaseName: 'my-app',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

**Browser (Bundle):**

```js
const { Datastore, indexedDBDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  autoCommit: {
    frequency: '5s', // commit every 5 seconds
    maxPendingBytes: 1024 * 1024, // or when 1 MB of writes are pending
  },
  driver: indexedDBDriver({
    databaseName: 'my-app',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

| Option            | Type                                                                           | Description                                      |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `frequency`       | `'immediate'` \| `number` \| `'${n}ms'` \| `'${n}s'` \| `'${n}m'` \| `'${n}h'` | How often to auto-commit                         |
| `maxPendingBytes` | `number`                                                                       | Byte threshold that triggers an immediate commit |

`autoCommit` requires a durable `driver`. Configuring `autoCommit` without a `driver` fails with `ConfigurationError`.

You can always call `commit()` manually for an explicit flush, even when `autoCommit` is configured.

#### Monitoring auto-commit errors

Auto-commit failures are delivered asynchronously and do not reject the triggering `put()` call. Use `on('error')` to monitor them:

**Node.js / TypeScript:**

```ts
const unsubscribe = db.on('error', (event) => {
  console.error('autoCommit error:', event.error);
});

// Stop listening:
unsubscribe();

// Or explicitly:
// db.off('error', listener);
```

**Browser (ESM):**

```js
const unsubscribe = db.on('error', (event) => {
  console.error('autoCommit error:', event.error);
});

// Stop listening:
unsubscribe();
```

**Browser (Bundle):**

```js
const unsubscribe = db.on('error', (event) => {
  console.error('autoCommit error:', event.error);
});

// Stop listening:
unsubscribe();
```

---

### Capacity Control

Limit datastore size with the `capacity` config.

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';

const db = new Datastore({
  capacity: {
    maxSize: '10MB',
    policy: 'strict',
  },
  driver: fileDriver({ filePath: './data/events.fpdb' }),
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { localStorageDriver } from '@frostpillar/frostpillar-storage-engine/drivers/localStorage';

const db = new Datastore({
  capacity: {
    maxSize: '10MB',
    policy: 'strict',
  },
  driver: localStorageDriver({
    databaseKey: 'my-app',
  }),
});
```

**Browser (Bundle):**

```js
const { Datastore, localStorageDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  capacity: {
    maxSize: '10MB',
    policy: 'strict',
  },
  driver: localStorageDriver({
    databaseKey: 'my-app',
  }),
});
```

| Option    | Type                                                                                | Description                        |
| --------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `maxSize` | `number` \| `'${n}B'` \| `'${n}KB'` \| `'${n}MB'` \| `'${n}GB'` \| `'backendLimit'` | Maximum datastore size             |
| `policy`  | `'strict'` \| `'turnover'`                                                          | Behavior when capacity is exceeded |

**Policies:**

- **`strict`** (default) — rejects writes that exceed the limit with `QuotaExceededError`.
- **`turnover`** — evicts the oldest records (by insertion order) until the new record fits.

**`backendLimit` sentinel:**

Set `maxSize: 'backendLimit'` to use the driver's own limit (e.g. `maxChunkChars * maxChunks` for `localStorageDriver`, `maxTotalBytes` for `syncStorageDriver`). Requires a durable driver that supports backend-limit resolution.

---

### Custom Key Definition

By default, keys are non-empty strings with lexicographic ordering. You can define a custom key type by providing all four callbacks:

**Node.js / TypeScript:**

```ts
const db = new Datastore({
  key: {
    normalize: (value, fieldName) => {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      throw new TypeError(`${fieldName} must be a safe integer.`);
    },
    compare: (left, right) => left - right,
    serialize: (key) => key.toString(10),
    deserialize: (serialized) => {
      const parsed = Number(serialized);
      if (!Number.isSafeInteger(parsed)) {
        throw new TypeError('serialized key must be a safe integer.');
      }
      return parsed;
    },
  },
});
```

**Browser (ESM):**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({
  key: {
    normalize: (value, fieldName) => {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      throw new TypeError(fieldName + ' must be a safe integer.');
    },
    compare: (left, right) => left - right,
    serialize: (key) => key.toString(10),
    deserialize: (serialized) => {
      const parsed = Number(serialized);
      if (!Number.isSafeInteger(parsed)) {
        throw new TypeError('serialized key must be a safe integer.');
      }
      return parsed;
    },
  },
});
```

**Browser (Bundle):**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({
  key: {
    normalize: (value, fieldName) => {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      throw new TypeError(fieldName + ' must be a safe integer.');
    },
    compare: (left, right) => left - right,
    serialize: (key) => key.toString(10),
    deserialize: (serialized) => {
      const parsed = Number(serialized);
      if (!Number.isSafeInteger(parsed)) {
        throw new TypeError('serialized key must be a safe integer.');
      }
      return parsed;
    },
  },
});
```

| Callback                      | Description                                              |
| ----------------------------- | -------------------------------------------------------- |
| `normalize(value, fieldName)` | Validate and normalize input to your key type            |
| `compare(left, right)`        | Return a finite integer for ordering (`< 0`, `0`, `> 0`) |
| `serialize(key)`              | Convert key to a string for storage                      |
| `deserialize(serialized)`     | Restore key from stored string                           |

All four are required when `config.key` is provided. `compare` must return a finite integer — `NaN`, `Infinity`, or non-integer values fail with `IndexCorruptionError`.

---

### Error Handling

All public errors extend `FrostpillarError` (which extends `Error`).

**Node.js / TypeScript:**

```ts
import {
  Datastore,
  FrostpillarError,
} from '@frostpillar/frostpillar-storage-engine';

try {
  await db.put({ key: 'k1', payload: { event: 'login' } });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  } else {
    throw error;
  }
}
```

**Browser (ESM):**

```js
import {
  Datastore,
  FrostpillarError,
} from '@frostpillar/frostpillar-storage-engine';

try {
  await db.put({ key: 'k1', payload: { event: 'login' } });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  } else {
    throw error;
  }
}
```

**Browser (Bundle):**

```js
const { Datastore, FrostpillarError } = window.FrostpillarStorageEngine;

try {
  await db.put({ key: 'k1', payload: { event: 'login' } });
} catch (error) {
  if (error instanceof FrostpillarError) {
    console.error(error.name, error.message);
  } else {
    throw error;
  }
}
```

#### Error Types

| Error                     | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `FrostpillarError`        | Root class for all Frostpillar errors                                  |
| `ValidationError`         | Invalid input (payload keys, nesting depth, etc.)                      |
| `ConfigurationError`      | Invalid datastore configuration                                        |
| `InvalidQueryRangeError`  | `start > end` in `getRange()`                                          |
| `ClosedDatastoreError`    | Operation on a closed datastore                                        |
| `QuotaExceededError`      | Capacity exceeded under `strict` policy                                |
| `StorageEngineError`      | Storage-layer I/O or internal error                                    |
| `DatabaseLockedError`     | File lock conflict (extends `StorageEngineError`)                      |
| `BinaryFormatError`       | Corrupt binary data (extends `StorageEngineError`)                     |
| `PageCorruptionError`     | Corrupt page/generation data (extends `StorageEngineError`)            |
| `IndexCorruptionError`    | Corrupt index or invalid internal state (extends `StorageEngineError`) |
| `UnsupportedBackendError` | Backend not available in current environment                           |

#### `close()` Error Aggregation

If both a deferred backend initialization failure and a backend close failure occur in the same `close()` call, `close()` throws a native `AggregateError` containing both errors (initialization error first, close error second).

---

## API Reference

### Key-Based Operations

| Method          | Parameters         | Returns                        | Description                |
| --------------- | ------------------ | ------------------------------ | -------------------------- |
| `put(record)`   | `{ key, payload }` | `Promise<void>`                | Insert a record            |
| `get(key)`      | key                | `Promise<KeyedRecord[]>`       | All records for key        |
| `getFirst(key)` | key                | `Promise<KeyedRecord \| null>` | First record for key       |
| `getLast(key)`  | key                | `Promise<KeyedRecord \| null>` | Last record for key        |
| `has(key)`      | key                | `Promise<boolean>`             | Check key existence        |
| `delete(key)`   | key                | `Promise<number>`              | Delete all records for key |

### ID-Based Operations

| Method                  | Parameters               | Returns                        | Description          |
| ----------------------- | ------------------------ | ------------------------------ | -------------------- |
| `getById(id)`           | `EntryId`                | `Promise<KeyedRecord \| null>` | Get by record ID     |
| `updateById(id, patch)` | `EntryId`, payload patch | `Promise<boolean>`             | Shallow-merge update |
| `deleteById(id)`        | `EntryId`                | `Promise<boolean>`             | Delete by record ID  |

### Bulk Operations

| Method                 | Parameters         | Returns                  | Description                 |
| ---------------------- | ------------------ | ------------------------ | --------------------------- |
| `getAll()`             | —                  | `Promise<KeyedRecord[]>` | All records                 |
| `getRange(start, end)` | start key, end key | `Promise<KeyedRecord[]>` | Inclusive range query       |
| `getMany(keys)`        | key array          | `Promise<KeyedRecord[]>` | Records for multiple keys   |
| `putMany(records)`     | record array       | `Promise<void>`          | Insert multiple records     |
| `deleteMany(keys)`     | key array          | `Promise<number>`        | Delete across multiple keys |
| `clear()`              | —                  | `Promise<void>`          | Remove all records          |

### Metadata

| Method    | Returns              | Description               |
| --------- | -------------------- | ------------------------- |
| `count()` | `Promise<number>`    | Total record count        |
| `keys()`  | `Promise<unknown[]>` | Distinct keys (ascending) |

### Lifecycle

| Method                   | Returns                    | Description                                |
| ------------------------ | -------------------------- | ------------------------------------------ |
| `commit()`               | `Promise<void>`            | Flush to durable storage (no-op without a driver) |
| `close()`                | `Promise<void>`            | Release resources and locks                |
| `on('error', listener)`  | `() => void` (unsubscribe) | Monitor async errors                       |
| `off('error', listener)` | `void`                     | Remove error listener                      |

### Exported Types

| Type | Description |
|------|-------------|
| `DatastoreConfig` | Constructor configuration object |
| `DatastoreKeyDefinition` | Custom key normalize/compare/serialize/deserialize callbacks |
| `InputRecord` | Record shape accepted by `put()` and `putMany()` |
| `KeyedRecord` | Record object with `key`, `payload`, and `_id` fields |
| `PersistedRecord` | Internal record format with `payload` and `sizeBytes` |
| `RecordPayload` | Payload value type (nested record of strings, numbers, booleans, nulls, and arrays) |
| `EntryId` | Branded `number` identifying a specific record (ephemeral, re-issued on restore) |
| `DuplicateKeyPolicy` | `'allow' \| 'reject' \| 'replace'` |
| `CapacityConfig` | Capacity control configuration (`maxSize` + `policy`) |
| `CapacityPolicy` | `'strict' \| 'turnover'` |
| `AutoCommitConfig` | Auto-commit configuration (`frequency` + `maxPendingBytes`) |
| `AutoCommitFrequencyInput` | Frequency value (`'immediate'` \| number \| time string) |
| `DatastoreDriver` | Driver interface for pluggable backends |
| `DatastoreDriverController` | Driver controller lifecycle interface |
| `DatastoreDriverInitContext` | Context passed to driver during initialization |
| `DatastoreDriverInitResult` | Result returned from driver initialization |
| `DatastoreDriverSnapshot` | Snapshot payload for persistence |
| `DatastoreErrorEvent` | Error event shape emitted by `on('error')` |
| `DatastoreErrorListener` | Listener callback type for error events |
| `FileBackendConfig` | File driver configuration |
| `FileTargetConfig` | File target (path or directory) union type |
| `FileTargetByPathConfig` | File target with direct `filePath` |
| `FileTargetByDirectoryConfig` | File target with directory-based resolution |
| `IndexedDBConfig` | IndexedDB driver configuration |
| `LocalStorageConfig` | localStorage driver configuration |
| `OpfsConfig` | OPFS driver configuration |
| `SyncStorageConfig` | Sync storage driver configuration |
| `FrostpillarError` | Root error class for all Frostpillar errors |
| `ValidationError` | Invalid input error |
| `ConfigurationError` | Invalid configuration error |
| `QuotaExceededError` | Capacity exceeded error |
| `StorageEngineError` | Storage-layer error |

For full behavioral details, see the [Datastore API spec](docs/specs/01_DatastoreAPI.md) and [Durable Backends spec](docs/specs/02_DurableBackends.md).

---

## How to Contribute

### Requirements

- Node.js `>=24.0.0`
- pnpm `>=10.0.0`

### Development Commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm check`        | Run type checking, lint, tests, and textlint |
| `pnpm test`         | Run tests                                    |
| `pnpm build`        | Build the package                            |
| `pnpm build:bundle` | Build the browser IIFE bundle                |

### Development Workflow

This project follows a strict SDD/TDD workflow:

1. **Spec** — update or create a spec in `docs/specs/` before implementation.
2. **Test** — write tests before code.
3. **Code** — implement minimal logic to pass the tests.
4. **Verify** — run `pnpm check` to ensure everything passes.

### Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Vision and principles](docs/architecture/vision-and-principles.md)
- [Testing strategy](docs/architecture/testing-strategy.md)
- [Specs index](docs/specs/README.md)
- [ADRs](docs/adr)

---

## License

[MIT](LICENSE)
