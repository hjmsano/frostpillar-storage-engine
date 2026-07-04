# Frostpillar Storage Engine

[English/英語](./README.md) | [Japanese/日本語](./README-JA.md)

[![npm version](https://img.shields.io/npm/v/@frostpillar/frostpillar-storage-engine)](https://www.npmjs.com/package/@frostpillar/frostpillar-storage-engine)
[![Node.js >=24](https://img.shields.io/badge/Node.js-%3E%3D24-green.svg)](https://nodejs.org/)
[![CI](https://github.com/hjmsano/frostpillar-storage-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/hjmsano/frostpillar-storage-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

JavaScript 向けの軽量な組み込み Key-Value データベースです。Node.js、ブラウザ、ブラウザ拡張で構造化レコードを保存・取得できます。サーバー不要で動作します。

内部的には、多数の小さなエントリを単一のバッキングストアにパッキングするチャンクベースのストレージエンジンであり、プラガブルなドライバ、容量制御、自動コミットをサポートします。Frostpillar エコシステムの一部です：

```
frostpillar-db          — データベース管理とオーケストレーション、ネイティブクエリーを提供
├── frostpillar-query-interface  — SQL-like / Lucene-like クエリ API
├── frostpillar-storage-engine   — コアストレージとチャンクハンドリング（本パッケージ）
│   └── frostpillar-btree        — B+ tree インデキシング
frostpillar-http-api    — RESTful API レイヤー
frostpillar-mcp         — AI エージェント連携用 MCP インターフェース
frostpillar-cli         — コマンドラインインターフェース
```

## 特徴

- **マルチランタイム** — Node.js、ブラウザ、ブラウザ拡張で動作
- **プラガブルドライバ** — in-memory、file、localStorage、IndexedDB、OPFS、ブラウザ拡張 sync storage
- **容量制御** — 厳格なクォータ強制または自動ターンオーバー方式での古いレコードの退避
- **自動コミット** — 時間間隔およびバイト閾値ベースのバックグラウンド永続化
- **カスタムキー** — normalize/compare/serialize/deserialize を提供して独自のキー型を定義可能
- **Tree-shakable** — `sideEffects: false` の ESM 配布。未使用ドライバはバンドラが除去
- **サードパーティランタイム依存なし** — Frostpillar ファミリパッケージのみ

## クイック例

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

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

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

> **注意:** IIFE バンドルには `Datastore`、エラークラス、およびブラウザ用ストレージドライバ（`localStorageDriver`、`indexedDBDriver`、`opfsDriver`、`syncStorageDriver`）が含まれます。`fileDriver` は Node.js 専用であり、バンドルには含まれません — サブパス `@frostpillar/frostpillar-storage-engine/drivers/file` からインポートしてください。

---

## 目次

- [はじめに](#はじめに)
- [ユーザーマニュアル](#ユーザーマニュアル)
  - [基本コンセプト](#基本コンセプト)
  - [CRUD 操作](#crud-操作)
  - [レコード ID (`_id`)](#レコード-id-_id)
  - [ストレージドライバ](#ストレージドライバ)
  - [自動コミット](#自動コミット)
  - [容量制御](#容量制御)
  - [カスタムキー定義](#カスタムキー定義)
  - [エラーハンドリング](#エラーハンドリング)
- [API リファレンス](#api-リファレンス)
- [コントリビュートガイド](#コントリビュートガイド)
- [ライセンス](#ライセンス)

---

## はじめに

### インストール（Node.js / TypeScript）

```bash
pnpm add @frostpillar/frostpillar-storage-engine
```

本パッケージは [npm](https://www.npmjs.com/package/@frostpillar/frostpillar-storage-engine) で公開されています。

### インストール（ブラウザ）

[GitHub Releases](https://github.com/hjmsano/frostpillar-storage-engine/releases) から minify 済み IIFE バンドルをダウンロードし、`<script>` タグで読み込みます。`<TAG>` はリリース済みタグ（例: `v0.1.8`）に置き換えてください。

```html
<script src="https://github.com/hjmsano/frostpillar-storage-engine/releases/download/<TAG>/frostpillar-storage-engine.min.js"></script>
```

`Datastore`、エラークラス、およびブラウザ用ストレージドライバ（`localStorageDriver`、`indexedDBDriver`、`opfsDriver`、`syncStorageDriver`）は `window.FrostpillarStorageEngine` で利用できます。`type="module"` は不要です。

### 互換性

| 環境       | 要件                                                         |
| ---------- | ------------------------------------------------------------ |
| Node.js    | >= 24.0.0（ESM および CJS）                                  |
| ブラウザ   | ES2020 互換（Chrome 80+、Firefox 74+、Safari 14+、Edge 80+） |
| TypeScript | >= 5.0                                                       |

> **ドライバ別互換性：** 上記の表はコアエンジンおよびインメモリモードのベースラインです。各ドライバはさらに以下のブラウザサポートを必要とします：
>
> - `opfsDriver` は `FileSystemFileHandle.createWritable()` を必要とします（Chrome 86+、Edge 86+、Firefox 111+、Safari 26.0+。参照：[caniuse.com](https://caniuse.com/mdn-api_filesystemwritablefilestream)）。
> - `syncStorageDriver` はブラウザ拡張コンテキスト（`storage` 権限を持つ `browser.storage.sync` / `chrome.storage.sync`）を必要とし、通常のウェブページでは使用できません。

> **プレリリースについて:** 本パッケージは [SemVer](https://semver.org/) に従います。メジャーバージョンが `0` の間は、マイナーバージョンの更新に破壊的変更が含まれる場合があります。依存バージョンを固定し、アップグレード前にチェンジログを確認してください。

---

## ユーザーマニュアル

### 基本コンセプト

**Datastore** が唯一のエントリポイントです。基本的なライフサイクルは次のとおりです：

1. **作成** — `new Datastore(config)`（デフォルトは in-memory、`driver` を渡すと永続化）
2. **書き込み** — `put()` / `putMany()` でレコードを挿入
3. **読み取り** — `get()`、`getFirst()`、`getLast()`、`getAll()` など
4. **永続化** — `commit()` で永続ストレージにフラッシュ（または `autoCommit` を使用）
5. **クローズ** — `close()` でリソースとロックを解放

各レコードのフィールド：

| フィールド | 説明                                                     |
| ---------- | -------------------------------------------------------- |
| `key`      | ユーザーが指定するルックアップキー（デフォルトは文字列） |
| `payload`  | JSON 互換のデータオブジェクト                            |
| `_id`      | エフェメラルなシステム生成 `EntryId`、読み取り専用       |

> **防御的クローン:** ペイロードは挿入時に防御的にクローンされますが、**凍結はされません**。`skipPayloadValidation` が `true` の場合、クローンもスキップされペイロードは参照のまま格納されます — 挿入後にオブジェクトを変更してはいけません。読み取り API はクローンせずに内部参照を返します。返されたペイロードを変更してもエラーはスローされませんが、内部状態が破損する可能性があります — 返されたペイロードは読み取り専用として扱ってください。変更可能なコピーが必要な場合は自分でクローンしてください（例: `structuredClone(record.payload)`）。

レコードは `key` 昇順（デフォルトは辞書順）、同一キー内では挿入順で並びます。

#### 重複キーポリシー

デフォルトでは重複キーが許可されており、複数のレコードが同じキーを持てます。構築時にポリシーを設定できます：

**Node.js / TypeScript:**

```ts
const db = new Datastore({
  duplicateKeys: 'allow', // デフォルト — キーごとに複数レコード可
  // duplicateKeys: 'replace', // キーごとに1レコード、最後の書き込みが勝つ
  // duplicateKeys: 'reject',  // キーごとに1レコード、重複時にスロー
});
```

**ブラウザ（ESM）:**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({
  duplicateKeys: 'allow', // デフォルト — キーごとに複数レコード可
  // duplicateKeys: 'replace', // キーごとに1レコード、最後の書き込みが勝つ
  // duplicateKeys: 'reject',  // キーごとに1レコード、重複時にスロー
});
```

**ブラウザ（バンドル）:**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({
  duplicateKeys: 'allow', // デフォルト — キーごとに複数レコード可
  // duplicateKeys: 'replace', // キーごとに1レコード、最後の書き込みが勝つ
  // duplicateKeys: 'reject',  // キーごとに1レコード、重複時にスロー
});
```

| ポリシー    | 動作                                                             | ユースケース                 |
| ----------- | ---------------------------------------------------------------- | ---------------------------- |
| `'allow'`   | キーごとに複数レコード                                           | ログ、イベント、時系列データ |
| `'replace'` | 最後の書き込みで上書き                                           | 設定、キャッシュ             |
| `'reject'`  | 重複時に `DuplicateKeyError`（`ValidationError` を継承）をスロー | ユニーク制約                 |

#### ペイロードバリデーション

ペイロードは `put()`、`putMany()`、`updateById()`、`replaceById()` の呼び出しごとにバリデーションされます。以下のデフォルト制限が適用されます：

| 制約                           | デフォルト             | 設定キー           |
| ------------------------------ | ---------------------- | ------------------ |
| ペイロード合計バイト数         | 1,048,576（1 MB）      | `maxTotalBytes`    |
| 最大ネスト深度                 | 64 オブジェクトレベル  | `maxDepth`         |
| キー合計数                     | 4,096                  | `maxTotalKeys`     |
| オブジェクトあたりの最大キー数 | 256                    | `maxKeysPerObject` |
| キーの最大サイズ               | 1,024 バイト（UTF-8）  | `maxKeyBytes`      |
| 文字列値の最大サイズ           | 65,535 バイト（UTF-8） | `maxStringBytes`   |

これらの制限は `payloadLimits` でデータストアごとにカスタマイズできます：

```ts
const db = new Datastore({
  payloadLimits: {
    maxDepth: 8,
    maxTotalBytes: 4096,
  },
});
```

各フィールドは独立してオプションです。省略されたフィールドはデフォルト値を使用します。各値は正の安全な整数である必要があり、そうでない場合は `ConfigurationError` で構築が失敗します。

追加ルール：

- ペイロードはプレーンオブジェクトである必要があります（トップレベルで配列、関数、`BigInt` は不可）。
- キーは空でなく、空白のみの文字列は不可。
- 予約キー（`__proto__`、`constructor`、`prototype`）は禁止。
- 循環参照は禁止。
- 違反時は `ValidationError` がスローされます。

信頼できる入力に対してはバリデーションをスキップできます：

```ts
const db = new Datastore({ skipPayloadValidation: true });
```

> **警告:** バリデーションのスキップは、すべてのランタイムペイロード安全チェックを無効化し、防御的クローンもスキップされます（ペイロードは参照のまま格納されます）。`payloadLimits` は構築時に検証されます（無効な値は `ConfigurationError` をスロー）が、ランタイムでは適用されません。入力が正しい形式であり、挿入後にペイロードオブジェクトを変更しないことが確実な場合のみ使用してください。

#### インデックス設定

B+Tree インデックスはデータ量に応じてノード容量を自動スケーリングします（デフォルト動作）。この動作をカスタマイズできます：

```ts
// 自動スケーリング（デフォルト）— エントリ数に応じてノード容量が増加
const db = new Datastore({});

// 固定容量でカスタムノードサイズを指定
const db2 = new Datastore({
  index: {
    autoScale: false,
    maxLeafEntries: 128,
    maxBranchChildren: 64,
  },
});
```

| フィールド                    | 型                       | デフォルト            | 説明                                                                            |
| ----------------------------- | ------------------------ | --------------------- | ------------------------------------------------------------------------------- |
| `index.autoScale`             | `boolean`                | `true`                | データ増加に応じてノード容量を自動スケーリング                                  |
| `index.maxLeafEntries`        | `number`                 | btree デフォルト (64) | リーフノードの最大エントリ数（3〜16384、`autoScale: false` 時のみ）             |
| `index.maxBranchChildren`     | `number`                 | btree デフォルト (64) | ブランチノードの最大子ノード数（3〜16384、`autoScale: false` 時のみ）           |
| `index.deleteRebalancePolicy` | `'standard'` \| `'lazy'` | `'standard'`          | 削除時のリバランス戦略。`'lazy'` はバルク削除のパフォーマンス向上のためスキップ |

`autoScale` が `true` の状態で `maxLeafEntries` や `maxBranchChildren` を設定すると `ConfigurationError` がスローされます。

---

### CRUD 操作

#### 書き込み

**`put(record)`** — 1 件のレコードを挿入します。

```ts
await db.put({ key: 'k1', payload: { name: 'Alice' } });
```

**`putMany(records)`** — 複数レコードを挿入します。アトミック性は容量ポリシーに依存します：`strict` はアトミックバッチ（全件成功または全件失敗）、`turnover` または容量未設定は非アトミック（左から右へ順次実行）。

```ts
await db.putMany([
  { key: 'k1', payload: { name: 'Alice' } },
  { key: 'k2', payload: { name: 'Bob' } },
]);
```

`put()` はレコードを挿入します。重複キーの動作は `duplicateKeys` ポリシーに依存します（デフォルト: `'allow'`）。

#### 読み取り

**`get(key)`** — 指定キーのすべてのレコードを返します。

```ts
const rows = await db.get('k1');
```

**`getFirst(key)`** — 指定キーの最初のレコード、または `null` を返します。

```ts
const row = await db.getFirst('k1');
```

**`getLast(key)`** — 指定キーの最後（最新挿入）のレコード、または `null` を返します。`duplicateKeys` が `'replace'` または `'reject'` の場合、`getFirst()` と同じ動作になります。

```ts
const row = await db.getLast('k1');
```

**`getById(id)`** — `_id` で 1 件のレコードを取得、または `null` を返します。

```ts
const row = await db.getById(id);
```

**`getAll()`** — 全レコードをキー順・挿入順で返します。

```ts
const all = await db.getAll();
```

**`getRange(start, end)`** — `start <= key <= end`（両端含む）のレコードを返します。

```ts
const range = await db.getRange('a', 'f');
```

**`countRange(start, end)`** — キー範囲内のレコード数をレコードを実体化せずにカウントします。

```ts
const n = await db.countRange('a', 'f');
```

**`getMany(keys)`** — 複数キーのレコードをまとめて取得します。

```ts
const rows = await db.getMany(['k1', 'k3', 'k5']);
```

**`has(key)`** — 指定キーのレコードが存在するか確認します。

```ts
const exists = await db.has('k1');
```

すべてのレコード返却 API は結果に `_id` フィールドを含みます。

#### 更新

**`updateById(id, patch)`** — 既存の payload に `patch` を shallow merge します。見つかった場合は `true`、見つからなかった場合は `false` を返します。`key` や `_id` は変更されません。プロパティの値に `undefined` を含むパッチは `ValidationError` で拒否されます。既存フィールドを削除するには、完全な新しいペイロードを指定して `replaceById` を使用してください。

```ts
const updated = await db.updateById(id, { name: 'Alice V2' });
```

**`replaceById(id, payload)`** — `_id` で指定したレコードの payload を完全に置換します。`updateById` とは異なり、新しい payload に存在しない既存フィールドは削除されます。見つかった場合は `true`、見つからなかった場合は `false` を返します。`key` や `_id` は変更されません。

```ts
const replaced = await db.replaceById(id, { name: 'Alice V3', score: 100 });
```

#### 削除

**`delete(key)`** — 指定キーのすべてのレコードを削除します。削除件数を返します。

```ts
const count = await db.delete('k1');
```

**`deleteById(id)`** — `_id` で 1 件のレコードを削除します。見つかった場合は `true` を返します。

```ts
const removed = await db.deleteById(id);
```

**`deleteMany(keys)`** — 複数キーのレコードを削除します（非アトミック）。合計削除件数を返します。

```ts
const count = await db.deleteMany(['k1', 'k2']);
```

**`deleteByIds(ids)`** — `_id` の配列でレコードを削除します。実際に削除された件数を返します（存在しない id はスキップされます）。

```ts
const count = await db.deleteByIds([id1, id2, id3]);
```

**`clear()`** — 全レコードを削除します。

```ts
await db.clear();
```

#### メタデータ

**`count()`** — レコードの総数を返します。

```ts
const n = await db.count();
```

**`keys()`** — 重複なしのキーを昇順で返します（payload は読み込みません）。

```ts
const allKeys = await db.keys();
```

---

### レコード ID (`_id`)

`_id` は読み取り API が返すすべてのレコードに含まれるシステム生成の `EntryId`（ブランド付き数値）です。エフェメラルであり、永続ストレージからの復元時に再発行されます。

- `put()` からは `_id` は返されません。レコードを読み取ることで `_id` を取得します。
- 再起動または `fromJSON()` による復元後、以前に取得した `_id` は無効になります。新しい値を得るには再クエリしてください。
- `EntryId` は型アノテーション用にパッケージから再エクスポートされています：

**Node.js / TypeScript:**

```ts
import type { EntryId } from '@frostpillar/frostpillar-storage-engine';
```

**ブラウザ（ESM / バンドル）:**

```js
// EntryId はランタイムではプレーンな number です。import は不要です。
// レコード結果から直接使用してください：
const record = await db.getFirst('k1');
const id = record._id; // EntryId
```

---

### ストレージドライバ

#### ドライバ比較表

| ドライバ             | 環境               | 永続性                                         | 想定ユースケース                   |
| -------------------- | ------------------ | ---------------------------------------------- | ---------------------------------- |
| _(なし)_             | Node.js / ブラウザ | in-memory のみ                                 | キャッシュ、テスト、一時データ     |
| `fileDriver`         | Node.js            | ファイルシステム                               | サーバーサイドの永続ストレージ     |
| `localStorageDriver` | ブラウザ           | localStorage                                   | ブラウザ側の小規模永続化           |
| `indexedDBDriver`    | ブラウザ           | IndexedDB                                      | ブラウザ側のより大きなストレージ   |
| `opfsDriver`         | ブラウザ           | Origin Private File System                     | 高スループットのブラウザストレージ |
| `syncStorageDriver`  | ブラウザ拡張       | `browser.storage.sync` / `chrome.storage.sync` | デバイス間の拡張データ同期         |

#### In-Memory（デフォルト）

ドライバ不要。データはメモリ上にのみ存在します。

**Node.js / TypeScript:**

```ts
const db = new Datastore({});
```

**ブラウザ（ESM）:**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({});
```

**ブラウザ（バンドル）:**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({});
```

#### File ドライバ（Node.js）

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

| オプション | 型       | 説明                                                     |
| ---------- | -------- | -------------------------------------------------------- |
| `filePath` | `string` | データファイルへの直接パス（例: `'./data/events.fpdb'`） |

ディレクトリベースのターゲティングも `target` オプションで利用できます：

| オプション          | 型            | 説明                                           |
| ------------------- | ------------- | ---------------------------------------------- |
| `target.kind`       | `'directory'` | ディレクトリベースのファイル解決を使用         |
| `target.directory`  | `string`      | データファイルを含むディレクトリ               |
| `target.fileName`   | `string`      | オプションのファイル名（デフォルト: 自動生成） |
| `target.filePrefix` | `string`      | オプションのファイル名プレフィックス           |

> **パス制約:** すべての解決済みファイルパス（`filePath`、`target.directory`）は `process.cwd()` 内に収まる必要があります。`../` トラバーサルや外部を指す絶対パスなど、作業ディレクトリの外に解決されるパスは `ConfigurationError` で拒否されます。

> **Windows に関する注意:** Windows にはディレクトリ同期 API がないため、コミットプロトコルの親ディレクトリ fsync ステップは Windows ではスキップされます。ファイル内容の fsync はすべてのコミットで引き続き実行され、リネームメタデータの永続化は NTFS のジャーナリングに委ねられます。

**ロックファイルの動作：**

`fileDriver` は単一 writer を保証するために `${filePath}.lock` を使用します。

プロセスが `close()` を呼ばずに終了した場合、ロックファイルは stale（無効）になります。次回のオープン時に、`fileDriver` は記録された PID が生存しているかを確認し、所有プロセスが終了していれば stale ロックを自動的に除去して新しいロックを取得します — 手動操作は不要です。

所有プロセスがまだ生存している場合（またはロックファイルが不正な形式の場合）、オープンは `DatabaseLockedError` で失敗します。その場合：

1. 同じデータストアファイルを使用している writer プロセスが存在しないことを確認する。
2. ロックファイル（`<resolved-data-file>.lock`）を手動で削除する。
3. データストアを再オープンする。

> **注意:** `fileDriver` は Node.js 専用であり、ブラウザ IIFE バンドルには**含まれません**。サブパス `@frostpillar/frostpillar-storage-engine/drivers/file` からインポートしてください。

#### localStorage ドライバ

> **ブラウザ / 拡張機能環境専用。** このドライバは Node.js では利用できません。
> Node.js でインプロセスに保持する場合はデフォルトのインメモリモード（`driver` を省略）、永続化には `fileDriver` を使用してください。

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

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

| オプション      | 型       | 説明                                                |
| --------------- | -------- | --------------------------------------------------- |
| `databaseKey`   | `string` | localStorage 内の論理データベース名                 |
| `keyPrefix`     | `string` | localStorage キーのプレフィックス（名前空間の分離） |
| `maxChunkChars` | `number` | チャンクあたりの最大文字数                          |
| `maxChunks`     | `number` | チャンクの最大数                                    |

#### IndexedDB ドライバ

> **ブラウザ / 拡張機能環境専用。** このドライバは Node.js では利用できません。
> Node.js でインプロセスに保持する場合はデフォルトのインメモリモード（`driver` を省略）、永続化には `fileDriver` を使用してください。

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

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

| オプション        | 型       | 説明                                 |
| ----------------- | -------- | ------------------------------------ |
| `databaseName`    | `string` | IndexedDB のデータベース名           |
| `objectStoreName` | `string` | データベース内のオブジェクトストア名 |
| `version`         | `number` | データベーススキーマバージョン       |

#### OPFS ドライバ

> **ブラウザ / 拡張機能環境専用。** このドライバは Node.js では利用できません。
> Node.js でインプロセスに保持する場合はデフォルトのインメモリモード（`driver` を省略）、永続化には `fileDriver` を使用してください。

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

```js
const { Datastore, opfsDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  autoCommit: { frequency: 'immediate' },
  driver: opfsDriver({
    directoryName: 'frostpillar-opfs',
  }),
});
```

| オプション      | 型       | 説明                  |
| --------------- | -------- | --------------------- |
| `directoryName` | `string` | OPFS のディレクトリ名 |

#### Sync Storage ドライバ（ブラウザ拡張）

> **ブラウザ / 拡張機能環境専用。** このドライバは Node.js では利用できません。
> Node.js でインプロセスに保持する場合はデフォルトのインメモリモード（`driver` を省略）、永続化には `fileDriver` を使用してください。

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

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

| オプション      | 型       | 説明                                             |
| --------------- | -------- | ------------------------------------------------ |
| `databaseKey`   | `string` | 論理データベース名                               |
| `keyPrefix`     | `string` | ストレージキーのプレフィックス（名前空間の分離） |
| `maxChunkChars` | `number` | チャンクあたりの最大文字数                       |
| `maxChunks`     | `number` | チャンクの最大数                                 |
| `maxItemBytes`  | `number` | ストレージアイテムあたりの最大バイト数           |
| `maxTotalBytes` | `number` | 全アイテム合計の最大バイト数                     |
| `maxItems`      | `number` | ストレージアイテムの最大数                       |

両方の API が利用可能な場合、ドライバは `browser.storage.sync` の Promise API を優先し、`chrome.storage.sync` のコールバック API をフォールバックとして使用します。

---

### 自動コミット

永続ドライバ使用時、`commit()` を手動で呼ぶ代わりにバックグラウンドで自動永続化を設定できます。

**Node.js / TypeScript:**

```ts
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { fileDriver } from '@frostpillar/frostpillar-storage-engine/drivers/file';

const db = new Datastore({
  autoCommit: {
    frequency: '5s', // 5 秒ごとにコミット
    maxPendingBytes: 1024 * 1024, // または 1 MB の書き込みが溜まったとき
  },
  driver: fileDriver({ filePath: './data/events.fpdb' }),
});
```

**ブラウザ（ESM）:**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';
import { indexedDBDriver } from '@frostpillar/frostpillar-storage-engine/drivers/indexedDB';

const db = new Datastore({
  autoCommit: {
    frequency: '5s', // 5 秒ごとにコミット
    maxPendingBytes: 1024 * 1024, // または 1 MB の書き込みが溜まったとき
  },
  driver: indexedDBDriver({
    databaseName: 'my-app',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

**ブラウザ（バンドル）:**

```js
const { Datastore, indexedDBDriver } = window.FrostpillarStorageEngine;

const db = new Datastore({
  autoCommit: {
    frequency: '5s', // 5 秒ごとにコミット
    maxPendingBytes: 1024 * 1024, // または 1 MB の書き込みが溜まったとき
  },
  driver: indexedDBDriver({
    databaseName: 'my-app',
    objectStoreName: 'records',
    version: 1,
  }),
});
```

| オプション        | 型                                                                             | 説明                                   |
| ----------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `frequency`       | `'immediate'` \| `number` \| `'${n}ms'` \| `'${n}s'` \| `'${n}m'` \| `'${n}h'` | 自動コミットの頻度                     |
| `maxPendingBytes` | `number`                                                                       | 即座にコミットをトリガーするバイト閾値 |

`autoCommit` は永続 `driver` が必要です。`driver` なしで `autoCommit` を設定すると `ConfigurationError` で失敗します。

`autoCommit` が設定されていても、`commit()` を手動で呼んで明示的にフラッシュできます。

#### 自動コミットエラーの監視

自動コミットの失敗は非同期で通知され、トリガーとなった `put()` 呼び出しは reject されません。`on('error')` で監視できます：

**Node.js / TypeScript:**

```ts
const unsubscribe = db.on('error', (event) => {
  console.error('autoCommit error:', event.error);
});

// 監視を停止する場合:
unsubscribe();

// または明示的に:
// db.off('error', listener);
```

**ブラウザ（ESM）:**

```js
const unsubscribe = db.on('error', (event) => {
  console.error('autoCommit error:', event.error);
});

// 監視を停止する場合:
unsubscribe();
```

**ブラウザ（バンドル）:**

```js
const unsubscribe = db.on('error', (event) => {
  console.error('autoCommit error:', event.error);
});

// 監視を停止する場合:
unsubscribe();
```

---

### 容量制御

`capacity` 設定でデータストアのサイズを制限できます。

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

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

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

| オプション | 型                                                                                  | 説明                     |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------ |
| `maxSize`  | `number` \| `'${n}B'` \| `'${n}KB'` \| `'${n}MB'` \| `'${n}GB'` \| `'backendLimit'` | データストアの最大サイズ |
| `policy`   | `'strict'` \| `'turnover'`                                                          | 容量超過時の動作         |

**ポリシー：**

- **`strict`**（デフォルト）— 制限を超える書き込みを `QuotaExceededError` で拒否します。
- **`turnover`** — 新しいレコードが収まるまで、B+Tree のキー昇順で最小キーを持つレコードから順に退避します。

> **注意：** `updateById` / `replaceById` はレコードを退避しません。更新後のペイロードが `maxSize` に収まらない場合、`'turnover'` ポリシーでも `QuotaExceededError` がスローされます。

**`backendLimit` センチネル：**

`maxSize: 'backendLimit'` を設定すると、ドライバ固有の制限値を使用します（例: `localStorageDriver` では `maxChunkChars * maxChunks`、`syncStorageDriver` では `maxTotalBytes`）。バックエンド制限解決をサポートする永続ドライバが必要です。

---

### カスタムキー定義

デフォルトでは、キーは空でない文字列で辞書順に並べられます。4 つのコールバックをすべて提供することでカスタムキー型を定義できます：

**Node.js / TypeScript:**

```ts
const db = new Datastore({
  key: {
    normalize: (value, fieldName) => {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      throw new TypeError(`${fieldName} は安全整数である必要があります。`);
    },
    compare: (left, right) => left - right,
    serialize: (key) => key.toString(10),
    deserialize: (serialized) => {
      const parsed = Number(serialized);
      if (!Number.isSafeInteger(parsed)) {
        throw new TypeError('serialized key は安全整数である必要があります。');
      }
      return parsed;
    },
  },
});
```

**ブラウザ（ESM）:**

```js
import { Datastore } from '@frostpillar/frostpillar-storage-engine';

const db = new Datastore({
  key: {
    normalize: (value, fieldName) => {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      throw new TypeError(fieldName + ' は安全整数である必要があります。');
    },
    compare: (left, right) => left - right,
    serialize: (key) => key.toString(10),
    deserialize: (serialized) => {
      const parsed = Number(serialized);
      if (!Number.isSafeInteger(parsed)) {
        throw new TypeError('serialized key は安全整数である必要があります。');
      }
      return parsed;
    },
  },
});
```

**ブラウザ（バンドル）:**

```js
const { Datastore } = window.FrostpillarStorageEngine;

const db = new Datastore({
  key: {
    normalize: (value, fieldName) => {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      throw new TypeError(fieldName + ' は安全整数である必要があります。');
    },
    compare: (left, right) => left - right,
    serialize: (key) => key.toString(10),
    deserialize: (serialized) => {
      const parsed = Number(serialized);
      if (!Number.isSafeInteger(parsed)) {
        throw new TypeError('serialized key は安全整数である必要があります。');
      }
      return parsed;
    },
  },
});
```

| コールバック                  | 説明                                            |
| ----------------------------- | ----------------------------------------------- |
| `normalize(value, fieldName)` | 入力をキー型にバリデーション・正規化            |
| `compare(left, right)`        | 順序付けのための数値を返す（`< 0`、`0`、`> 0`） |
| `serialize(key)`              | キーをストレージ用の文字列に変換                |
| `deserialize(serialized)`     | 格納された文字列からキーを復元                  |

`config.key` を指定する場合、4 つすべてが必須です。`compare` は負の整数・ゼロ・正の整数を返すことが推奨されます。ホットパスでは、NaN 以外の値（`0.5` などの小数や `Infinity`）は自動的に `-1`・`0`・`+1` にクランプされます。これはパフォーマンスのための設計です。`NaN` のみが未定義動作を引き起こし、`IndexCorruptionError` をスローします。

---

### エラーハンドリング

すべての公開エラーは `FrostpillarError`（`Error` を継承）を継承しています。

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

**ブラウザ（ESM）:**

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

**ブラウザ（バンドル）:**

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

#### エラー型一覧

| エラー                    | 説明                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `FrostpillarError`        | すべての Frostpillar エラーのルートクラス                                                                                         |
| `ValidationError`         | 不正な入力（payload キー、ネスト深度など）                                                                                        |
| `DuplicateKeyError`       | `duplicateKeys: 'reject'` 下での重複キー（`ValidationError` を継承）                                                              |
| `ConfigurationError`      | 不正なデータストア設定                                                                                                            |
| `InvalidQueryRangeError`  | `getRange()` で `start > end`                                                                                                     |
| `ClosedDatastoreError`    | クローズ済みデータストアへの操作                                                                                                  |
| `QuotaExceededError`      | 容量超過（`strict` ポリシーでの書き込み、または任意の容量ポリシーで更新後サイズが `maxSize` を超える `updateById`/`replaceById`） |
| `StorageEngineError`      | ストレージ層の I/O または内部エラー                                                                                               |
| `DatabaseLockedError`     | ファイルロック競合（`StorageEngineError` を継承）                                                                                 |
| `BinaryFormatError`       | バイナリデータの破損（`StorageEngineError` を継承）                                                                               |
| `PageCorruptionError`     | ページ/世代データの破損（`StorageEngineError` を継承）                                                                            |
| `IndexCorruptionError`    | インデックスの破損または不正な内部状態（`StorageEngineError` を継承）                                                             |
| `UnsupportedBackendError` | 現在の環境でバックエンドが利用不可                                                                                                |

#### `close()` のエラー集約

遅延バックエンド初期化の失敗とバックエンドクローズの失敗が同じ `close()` 呼び出しで発生した場合、`close()` はネイティブの `AggregateError` をスローします。初期化エラーが最初、クローズエラーが 2 番目に含まれます。

---

## API リファレンス

### キーベース操作

| メソッド        | パラメータ         | 戻り値                         | 説明                   |
| --------------- | ------------------ | ------------------------------ | ---------------------- |
| `put(record)`   | `{ key, payload }` | `Promise<void>`                | レコードを挿入         |
| `get(key)`      | key                | `Promise<KeyedRecord[]>`       | キーの全レコード       |
| `getFirst(key)` | key                | `Promise<KeyedRecord \| null>` | キーの最初のレコード   |
| `getLast(key)`  | key                | `Promise<KeyedRecord \| null>` | キーの最後のレコード   |
| `has(key)`      | key                | `Promise<boolean>`             | キーの存在確認         |
| `delete(key)`   | key                | `Promise<number>`              | キーの全レコードを削除 |

### ID ベース操作

| メソッド                   | パラメータ                | 戻り値                         | 説明                 |
| -------------------------- | ------------------------- | ------------------------------ | -------------------- |
| `getById(id)`              | `EntryId`                 | `Promise<KeyedRecord \| null>` | レコード ID で取得   |
| `updateById(id, patch)`    | `EntryId`、payload パッチ | `Promise<boolean>`             | shallow merge で更新 |
| `replaceById(id, payload)` | `EntryId`、完全な payload | `Promise<boolean>`             | payload を完全置換   |
| `deleteById(id)`           | `EntryId`                 | `Promise<boolean>`             | レコード ID で削除   |

### バルク操作

| メソッド                 | パラメータ         | 戻り値                   | 説明                     |
| ------------------------ | ------------------ | ------------------------ | ------------------------ |
| `getAll()`               | —                  | `Promise<KeyedRecord[]>` | 全レコード               |
| `getRange(start, end)`   | 開始キー、終了キー | `Promise<KeyedRecord[]>` | 両端含む範囲クエリ       |
| `countRange(start, end)` | 開始キー、終了キー | `Promise<number>`        | 範囲内のレコード数       |
| `getMany(keys)`          | キー配列           | `Promise<KeyedRecord[]>` | 複数キーのレコード       |
| `putMany(records)`       | レコード配列       | `Promise<void>`          | 複数レコードを挿入       |
| `deleteMany(keys)`       | キー配列           | `Promise<number>`        | 複数キーのレコードを削除 |
| `deleteByIds(ids)`       | `EntryId` 配列     | `Promise<number>`        | レコード ID 群で削除     |
| `clear()`                | —                  | `Promise<void>`          | 全レコードを削除         |

### メタデータ

| メソッド  | 戻り値               | 説明                   |
| --------- | -------------------- | ---------------------- |
| `count()` | `Promise<number>`    | レコード総数           |
| `keys()`  | `Promise<unknown[]>` | 重複なしのキー（昇順） |

### ライフサイクル

| メソッド                 | 戻り値                   | 説明                                                         |
| ------------------------ | ------------------------ | ------------------------------------------------------------ |
| `commit()`               | `Promise<void>`          | 永続ストレージにフラッシュ（ドライバなしの場合は何もしない） |
| `close()`                | `Promise<void>`          | リソースとロックを解放                                       |
| `on('error', listener)`  | `() => void`（購読解除） | 非同期エラーを監視                                           |
| `off('error', listener)` | `void`                   | エラーリスナーを削除                                         |

### エクスポートされた型

| 型                            | 説明                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DatastoreConfig`             | コンストラクタ設定オブジェクト                                                                                      |
| `DatastoreKeyDefinition`      | カスタムキーの normalize/compare/serialize/deserialize コールバック                                                 |
| `InputRecord`                 | `put()` および `putMany()` が受け付けるレコード形式                                                                 |
| `KeyedRecord`                 | `key`、`payload`、`_id` フィールドを持つレコードオブジェクト                                                        |
| `PersistedRecord`             | `payload` と `sizeBytes` を持つ内部レコード形式                                                                     |
| `RecordPayload`               | ペイロードの値型（文字列、数値、真偽値、null のネストされたレコード）。配列は未サポートでランタイムで拒否されます。 |
| `EntryId`                     | レコードを識別するブランド付き `number`（エフェメラル、復元時に再発行）                                             |
| `DuplicateKeyPolicy`          | `'allow' \| 'reject' \| 'replace'`                                                                                  |
| `DeleteRebalancePolicy`       | `'standard'` \| `'lazy'`                                                                                            |
| `IndexConfig`                 | インデックス設定（`autoScale`、`maxLeafEntries`、`maxBranchChildren`、`deleteRebalancePolicy`）                     |
| `CapacityConfig`              | 容量制御設定（`maxSize` + `policy`）                                                                                |
| `CapacityPolicy`              | `'strict' \| 'turnover'`                                                                                            |
| `AutoCommitConfig`            | 自動コミット設定（`frequency` + `maxPendingBytes`）                                                                 |
| `AutoCommitFrequencyInput`    | 頻度値（`'immediate'` \| 数値 \| 時間文字列）                                                                       |
| `DatastoreDriver`             | プラガブルバックエンドのドライバインターフェース                                                                    |
| `DatastoreDriverController`   | ドライバコントローラのライフサイクルインターフェース                                                                |
| `DatastoreDriverInitContext`  | 初期化時にドライバに渡されるコンテキスト                                                                            |
| `DatastoreDriverInitResult`   | ドライバ初期化の戻り値                                                                                              |
| `DatastoreDriverSnapshot`     | 永続化用のスナップショットペイロード                                                                                |
| `DatastoreErrorEvent`         | `on('error')` で送出されるエラーイベントの形状                                                                      |
| `DatastoreErrorListener`      | エラーイベント用のリスナーコールバック型                                                                            |
| `FileBackendConfig`           | File ドライバ設定                                                                                                   |
| `FileTargetConfig`            | ファイルターゲット（パスまたはディレクトリ）のユニオン型                                                            |
| `FileTargetByPathConfig`      | 直接 `filePath` を指定するファイルターゲット                                                                        |
| `FileTargetByDirectoryConfig` | ディレクトリベースのファイル解決ターゲット                                                                          |
| `IndexedDBConfig`             | IndexedDB ドライバ設定                                                                                              |
| `LocalStorageConfig`          | localStorage ドライバ設定                                                                                           |
| `OpfsConfig`                  | OPFS ドライバ設定                                                                                                   |
| `SyncStorageConfig`           | Sync Storage ドライバ設定                                                                                           |
| `FrostpillarError`            | すべての Frostpillar エラーのルートクラス                                                                           |
| `ValidationError`             | 不正な入力エラー                                                                                                    |
| `DuplicateKeyError`           | `duplicateKeys: 'reject'` で投げられる重複キーエラー（`ValidationError` を継承）                                    |
| `ConfigurationError`          | 不正な設定エラー                                                                                                    |
| `QuotaExceededError`          | 容量超過エラー                                                                                                      |
| `StorageEngineError`          | ストレージ層エラー                                                                                                  |

詳細な動作仕様は [Datastore API spec](docs/specs/01_DatastoreAPI.md) および [Durable Backends spec](docs/specs/02_DurableBackends.md) を参照してください。

---

## コントリビュートガイド

### 必要な環境

- Node.js `>=24.0.0`
- pnpm `>=10.0.0`

### 開発コマンド

| コマンド            | 説明                                      |
| ------------------- | ----------------------------------------- |
| `pnpm check`        | 型チェック、lint、テスト、textlint を実行 |
| `pnpm test`         | テストを実行                              |
| `pnpm build`        | パッケージをビルド                        |
| `pnpm build:bundle` | ブラウザ IIFE バンドルをビルド            |

### 開発ワークフロー

本プロジェクトは厳格な SDD/TDD ワークフローに従います：

1. **Spec** — 実装前に `docs/specs/` の仕様を更新または作成する。
2. **Test** — コードより先にテストを書く。
3. **Code** — テストをパスする最小限のロジックを実装する。
4. **Verify** — `pnpm check` を実行してすべてがパスすることを確認する。

### ドキュメント

- [README (English)](README.md)
- [Architecture overview](docs/architecture/overview.md)
- [Vision and principles](docs/architecture/vision-and-principles.md)
- [Testing strategy](docs/architecture/testing-strategy.md)
- [Specs index](docs/specs/README.md)
- [ADRs](docs/adr)

---

## ライセンス

[MIT](LICENSE)
