# 自建快照系统实现计划（own snapshot system）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件自带一套零配置的自动快照系统：任何来源的编辑发生前，改前内容已在插件自己的 IndexedDB 里；file-recovery 降为补充源。

**Architecture:** 三个新模块——`SnapshotStore`（IndexedDB 封装）、`SnapshotRecorder`（vault 事件 + 会话边界算法：编辑间隔超阈值视为新会话，会话开始写改前内容、静默后写改后内容）、`runBaselineScan`（首次全量基线，增量重跑）。`snapshot-source.ts` 新增 `getMergedSnapshots()` 合并自建库与 file-recovery 两源。

**Tech Stack:** TypeScript + Obsidian Plugin API（^1.5.0）+ IndexedDB + vitest（新 devDependency `fake-indexeddb`）。

**Spec:** `docs/superpowers/specs/2026-08-20-own-snapshot-system-design.md`（实现时 spec 与本计划一起读）。

## Global Constraints

- 内容判等一律用 `src/diff-engine.ts` 的 `sameContent()`，禁止裸 `===`/`!==` 比较两段笔记文本（AGENTS.md 规则）。
- 用户可见文案一律进 `src/strings.ts`，新增条目同时补 zh/en 两套，不在组件里硬编码。
- 被单测覆盖的模块（snapshot-store / snapshot-recorder / snapshot-source / strings）**不得运行时 import `obsidian`**，只允许 `import type`（obsidian 包无运行时实现，现有测试全靠这条约定跑在 vitest 里）。
- tsconfig `strict: true`、target ES2018——不用 ES2019+ 运行时 API。
- 提交直接进 main（仓库惯例，沿用 `feat:`/`test:`/`docs:` 前缀 + 中文说明）。**不要** `git add` 这些与本功能无关的遗留改动：`.agents/skills/snapshot-forensics/SKILL.md`。
- 发版（`npm version minor` + push + release）是面向社区的外部动作，须用户确认后单独执行，不在本计划任务内。
- 每个任务结束跑 `npm test`；改动 `src/` 的任务额外跑 `npm run build`（tsc 类型检查 + esbuild）。

---

### Task 1: SnapshotStore（IndexedDB 封装）

**Files:**
- Modify: `package.json`（新增 devDependency）
- Create: `src/snapshot-store.ts`
- Test: `tests/snapshot-store.test.ts`

**Interfaces:**
- Consumes: `SnapshotEntry`（`src/snapshot-source.ts` 已有，`{ts: number; data: string}`）、`sameContent`（`src/diff-engine.ts`）。
- Produces: `SnapshotStoreLike` 接口与 `SnapshotStore` 类（静态 `open(): Promise<SnapshotStore>`，方法 `getLatest/getEntries/add/migratePath/pruneRetention/purge/close`）。Task 3/4/7 依赖这些签名。

- [ ] **Step 1: 安装 fake-indexeddb**

Run: `npm install --save-dev fake-indexeddb`
Expected: package.json devDependencies 出现 `fake-indexeddb`。

- [ ] **Step 2: 写失败测试**

创建 `tests/snapshot-store.test.ts`（node 环境即可，不加 jsdom 注解；`fake-indexeddb/global` 注册全局 indexedDB）：

```ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, SnapshotStore } from '../src/snapshot-store';

/** 每个用例独立的库：先删库再开新连接 */
async function freshStore(): Promise<SnapshotStore> {
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  return SnapshotStore.open();
}

describe('SnapshotStore', () => {
  let store: SnapshotStore;
  afterEach(() => store?.close());

  it('add 写入后 getEntries 按时间倒序返回，getLatest 取最新一条', async () => {
    store = await freshStore();
    expect(await store.add('a.md', 100, 'v1')).toBe(true);
    expect(await store.add('a.md', 300, 'v3')).toBe(true);
    expect(await store.add('a.md', 200, 'v2')).toBe(true);
    expect(await store.add('b.md', 250, 'other')).toBe(true);
    expect(await store.getEntries('a.md')).toEqual([
      { ts: 300, data: 'v3' },
      { ts: 200, data: 'v2' },
      { ts: 100, data: 'v1' },
    ]);
    expect(await store.getLatest('a.md')).toEqual({ ts: 300, data: 'v3' });
    expect(await store.getLatest('nope.md')).toBeNull();
  });

  it('add 的去重闸门：内容与最新一条相同时跳过（含仅换行风格差异）', async () => {
    store = await freshStore();
    expect(await store.add('a.md', 100, 'a\nb\n')).toBe(true);
    expect(await store.add('a.md', 200, 'a\nb\n')).toBe(false);
    // 编辑器内存是 LF、磁盘/快照可能是 CRLF——sameContent 口径下不算差异
    expect(await store.add('a.md', 300, 'a\r\nb\r\n')).toBe(false);
    expect(await store.getEntries('a.md')).toEqual([{ ts: 100, data: 'a\nb\n' }]);
    expect(await store.add('a.md', 400, 'a\nX\n')).toBe(true);
  });

  it('migratePath 把旧路径的记录迁到新路径', async () => {
    store = await freshStore();
    await store.add('old/dir/x.md', 100, 'v1');
    await store.add('old/dir/x.md', 200, 'v2');
    await store.add('keep.md', 150, 'z');
    await store.migratePath('old/dir/x.md', 'new/dir/x.md');
    expect(await store.getEntries('old/dir/x.md')).toEqual([]);
    expect(await store.getEntries('new/dir/x.md')).toEqual([
      { ts: 200, data: 'v2' },
      { ts: 100, data: 'v1' },
    ]);
    expect(await store.getLatest('keep.md')).toEqual({ ts: 150, data: 'z' });
  });

  it('pruneRetention 删除过期记录并返回条数', async () => {
    store = await freshStore();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await store.add('a.md', now - 40 * day, 'old');
    await store.add('a.md', now - 10 * day, 'mid');
    await store.add('b.md', now - 1 * day, 'new');
    expect(await store.pruneRetention(30)).toBe(1);
    expect(await store.getEntries('a.md')).toEqual([{ ts: now - 10 * day, data: 'mid' }]);
    expect(await store.getLatest('b.md')).toEqual({ ts: now - 1 * day, data: 'new' });
  });

  it('purge 清空全部记录', async () => {
    store = await freshStore();
    await store.add('a.md', 100, 'v1');
    await store.add('b.md', 200, 'v2');
    await store.purge();
    expect(await store.getEntries('a.md')).toEqual([]);
    expect(await store.getLatest('b.md')).toBeNull();
  });

  it('close 后操作拒绝', async () => {
    store = await freshStore();
    store.close();
    await expect(store.add('a.md', 1, 'x')).rejects.toThrow('snapshot store closed');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/snapshot-store.test.ts`
Expected: FAIL——`Cannot find module '../src/snapshot-store'`。

- [ ] **Step 4: 实现 snapshot-store.ts**

创建 `src/snapshot-store.ts`（只有 `import type { SnapshotEntry } from './snapshot-source'`，无运行时 obsidian 依赖）：

```ts
import { sameContent } from './diff-engine';
import type { SnapshotEntry } from './snapshot-source';

export const DB_NAME = 'review-edit-snapshots';

interface SnapshotRecord {
  id?: number;
  path: string;
  ts: number;
  data: string;
}

/** recorder 与快照源合并依赖的最小接口；测试用内存实现替换 */
export interface SnapshotStoreLike {
  getLatest(path: string): Promise<SnapshotEntry | null>;
  getEntries(path: string): Promise<SnapshotEntry[]>;
  /** 去重闸门：内容与该路径最新一条相同时（sameContent 口径）不写入，返回 false */
  add(path: string, ts: number, data: string): Promise<boolean>;
  migratePath(oldPath: string, newPath: string): Promise<void>;
  /** 删除 ts 早于保留期截止时间的记录，返回删除条数 */
  pruneRetention(keepDays: number): Promise<number>;
  purge(): Promise<void>;
  close(): void;
}

export class SnapshotStore implements SnapshotStoreLike {
  private db: IDBDatabase;
  private closed = false;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(): Promise<SnapshotStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
        store.createIndex('path', 'path');
        store.createIndex('ts', 'ts');
      };
      req.onsuccess = () => resolve(new SnapshotStore(req.result));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  close(): void {
    this.closed = true;
    this.db.close();
  }

  /** 单事务包装：resolve 时机取事务 complete，结果取请求 result */
  private tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | void
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('snapshot store closed'));
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction('snapshots', mode);
      const req = run(tx.objectStore('snapshots')) as IDBRequest<T> | undefined;
      tx.oncomplete = () => resolve(req ? req.result : (undefined as unknown as T));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async getEntries(path: string): Promise<SnapshotEntry[]> {
    const records = await this.tx<SnapshotRecord[]>('readonly', s => s.index('path').getAll(path));
    return [...records].sort((a, b) => b.ts - a.ts).map(r => ({ ts: r.ts, data: r.data }));
  }

  async getLatest(path: string): Promise<SnapshotEntry | null> {
    const entries = await this.getEntries(path);
    return entries[0] ?? null;
  }

  async add(path: string, ts: number, data: string): Promise<boolean> {
    const latest = await this.getLatest(path);
    if (latest && sameContent(latest.data, data)) return false;
    await this.tx('readwrite', s => {
      s.add({ path, ts, data } as SnapshotRecord);
    });
    return true;
  }

  async migratePath(oldPath: string, newPath: string): Promise<void> {
    const records = await this.tx<SnapshotRecord[]>('readonly', s => s.index('path').getAll(oldPath));
    if (records.length === 0) return;
    await this.tx('readwrite', s => {
      for (const r of records) s.put({ ...r, path: newPath });
    });
  }

  async pruneRetention(keepDays: number): Promise<number> {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const expired = await this.tx<SnapshotRecord[]>('readonly', s =>
      s.index('ts').getAll(IDBKeyRange.upperBound(cutoff))
    );
    if (expired.length === 0) return 0;
    await this.tx('readwrite', s => {
      for (const r of expired) s.delete(r.id!);
    });
    return expired.length;
  }

  async purge(): Promise<void> {
    await this.tx('readwrite', s => {
      s.clear();
    });
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/snapshot-store.test.ts`
Expected: 7 个用例全 PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json src/snapshot-store.ts tests/snapshot-store.test.ts
git commit -m "feat: SnapshotStore——自建快照的 IndexedDB 封装（去重闸门/迁移/保留期清理）"
```

---

### Task 2: snapshot-source 双源合并

**Files:**
- Modify: `src/snapshot-source.ts`
- Test: `tests/snapshot-source.test.ts`（扩展）

**Interfaces:**
- Consumes: Task 1 的 `SnapshotStoreLike`；现有 `getSnapshots`/`SnapshotSourceUnavailableError`/`SnapshotEntry`。
- Produces: `dedupeAdjacent(entries: SnapshotEntry[]): SnapshotEntry[]`、`getMergedSnapshots(app: App, path: string, store: SnapshotStoreLike | null, onOwnStoreError?: () => void): Promise<SnapshotEntry[]>`。Task 7 的 `startReview` 依赖后者。

- [ ] **Step 1: 写失败测试**

在 `tests/snapshot-source.test.ts` 追加（文件头部 import 行改为）：

```ts
import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { SnapshotStoreLike } from '../src/snapshot-store';
import {
  dedupeAdjacent,
  filterDiffering,
  getMergedSnapshots,
  getSnapshots,
  SnapshotSourceUnavailableError,
} from '../src/snapshot-source';
```

追加用例（`mockDb`/`mockApp` 复用文件里已有的工厂）：

```ts
function mockStore(entries: Array<{ path: string; ts: number; data: string }>, fail = false): SnapshotStoreLike {
  return {
    getLatest: async p => entries.filter(e => e.path === p).sort((a, b) => b.ts - a.ts)[0] ?? null,
    getEntries: async p =>
      entries.filter(e => e.path === p).sort((a, b) => b.ts - a.ts).map(({ ts, data }) => ({ ts, data })),
    add: async () => false,
    migratePath: async () => {},
    pruneRetention: async () => 0,
    purge: async () => {},
    close: () => {},
    ...(fail ? { getEntries: async () => { throw new Error('own boom'); } } : {}),
  };
}

describe('dedupeAdjacent', () => {
  it('相邻同内容只留最新，跨源合并用同一口径（含换行风格差异）', () => {
    expect(dedupeAdjacent([
      { ts: 300, data: 'v2' },
      { ts: 280, data: 'v2' },
      { ts: 270, data: 'v2\r\n' },
      { ts: 100, data: 'v1' },
    ])).toEqual([{ ts: 300, data: 'v2' }, { ts: 100, data: 'v1' }]);
  });
});

describe('getMergedSnapshots', () => {
  it('两源按时间倒序合并并去重相邻同内容', async () => {
    const fr = mockApp(mockDb([
      { path: 'a.md', ts: 100, data: 'v1' },
      { path: 'a.md', ts: 400, data: 'v3' },
    ]));
    const own = mockStore([{ path: 'a.md', ts: 200, data: 'v2' }]);
    expect(await getMergedSnapshots(fr, 'a.md', own)).toEqual([
      { ts: 400, data: 'v3' },
      { ts: 200, data: 'v2' },
      { ts: 100, data: 'v1' },
    ]);
  });

  it('自建库读失败：返回 file-recovery 条目并回调 onOwnStoreError', async () => {
    const onErr = vi.fn();
    const fr = mockApp(mockDb([{ path: 'a.md', ts: 100, data: 'v1' }]));
    expect(await getMergedSnapshots(fr, 'a.md', mockStore([], true), onErr)).toEqual([
      { ts: 100, data: 'v1' },
    ]);
    expect(onErr).toHaveBeenCalledTimes(1);
  });

  it('file-recovery 不可用但自建库可用（含为空）：返回自建条目，不抛错', async () => {
    const noFr = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
    expect(await getMergedSnapshots(noFr, 'a.md', mockStore([{ path: 'a.md', ts: 1, data: 'x' }])))
      .toEqual([{ ts: 1, data: 'x' }]);
    expect(await getMergedSnapshots(noFr, 'a.md', mockStore([]))).toEqual([]);
  });

  it('两源都失败抛 SnapshotSourceUnavailableError', async () => {
    const noFr = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
    await expect(getMergedSnapshots(noFr, 'a.md', mockStore([], true)))
      .rejects.toBeInstanceOf(SnapshotSourceUnavailableError);
  });

  it('store 为 null（功能关闭）时行为与旧 getSnapshots 一致：不可用即抛错', async () => {
    const noFr = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
    await expect(getMergedSnapshots(noFr, 'a.md', null))
      .rejects.toBeInstanceOf(SnapshotSourceUnavailableError);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/snapshot-source.test.ts`
Expected: 新用例 FAIL（`dedupeAdjacent`/`getMergedSnapshots` 未导出），原有 9 个用例仍 PASS。

- [ ] **Step 3: 实现**

改 `src/snapshot-source.ts`：

1. 头部加 `import type { SnapshotStoreLike } from './snapshot-store';`（type-only，无运行时循环依赖——snapshot-store 对 snapshot-source 也是 type-only）。
2. 把 `getSnapshots` 尾部的去重循环（现 59-63 行）抽成导出函数，判等换 `sameContent`（AGENTS.md 口径，原来裸 `!==` 会让仅换行风格不同的相邻条目重复展示）：

```ts
/** 相邻内容相同只保留最新一条，减少选择器噪音；「相同」按 diff 引擎口径 */
export function dedupeAdjacent(entries: SnapshotEntry[]): SnapshotEntry[] {
  const out: SnapshotEntry[] = [];
  for (const e of entries) {
    if (out.length === 0 || !sameContent(out[out.length - 1].data, e.data)) out.push(e);
  }
  return out;
}
```

`getSnapshots` 尾部改为：

```ts
  backups.sort((a, b) => b.ts - a.ts);
  return dedupeAdjacent(backups.map(b => ({ ts: b.ts, data: b.data })));
```

3. 文件末尾追加：

```ts
/**
 * 合并自建快照库与 file-recovery 两源，按时间倒序去重相邻同内容。
 * 失败语义：file-recovery 不可用则静默降级；自建库读失败回调 onOwnStoreError 后降级；
 * 两者都拿不到数据才抛 SnapshotSourceUnavailableError。
 */
export async function getMergedSnapshots(
  app: App,
  path: string,
  store: SnapshotStoreLike | null,
  onOwnStoreError?: () => void
): Promise<SnapshotEntry[]> {
  let own: SnapshotEntry[] = [];
  let ownFailed = false;
  if (store) {
    try {
      own = await store.getEntries(path);
    } catch {
      ownFailed = true;
      onOwnStoreError?.();
    }
  }
  let fr: SnapshotEntry[] = [];
  let frFailed = false;
  try {
    fr = await getSnapshots(app, path);
  } catch {
    frFailed = true;
  }
  if (frFailed && (ownFailed || !store)) throw new SnapshotSourceUnavailableError();
  return dedupeAdjacent([...own, ...fr].sort((a, b) => b.ts - a.ts));
}
```

- [ ] **Step 4: 跑全量测试确认通过**

Run: `npm test`
Expected: 全部 PASS（含原有用例——现有 `getSnapshots` 用例的数据没有换行风格差异，抽函数不影响其断言）。

- [ ] **Step 5: 提交**

```bash
git add src/snapshot-source.ts tests/snapshot-source.test.ts
git commit -m "feat: getMergedSnapshots 双源合并，file-recovery 降为补充源；相邻去重改用 sameContent 口径"
```

---

### Task 3: SnapshotRecorder（会话边界算法）

**Files:**
- Create: `src/snapshot-recorder.ts`
- Test: `tests/snapshot-recorder.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `SnapshotStoreLike`；`import type { EventRef, TAbstractFile, TFile, Vault } from 'obsidian'`（全部 type-only）。
- Produces: `type RecorderVault = Pick<Vault, 'on' | 'offref' | 'read'>`、`class SnapshotRecorder`（`mount()`/`dispose()`）、`interface RecorderOptions { thresholdMs(): number; now?(): number; setTimeout?(fn, ms); clearTimeout?(t) }`。Task 7 依赖 `new SnapshotRecorder(vault, store, {thresholdMs})`。

- [ ] **Step 1: 写失败测试**

创建 `tests/snapshot-recorder.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventRef, TFile } from 'obsidian';
import { sameContent } from '../src/diff-engine';
import type { SnapshotStoreLike } from '../src/snapshot-store';
import { SnapshotRecorder, type RecorderVault } from '../src/snapshot-recorder';

/** 内存实现：记录 add 调用，真实执行去重闸门，可注入既有条目模拟「重启前的库」 */
class MemoryStore implements SnapshotStoreLike {
  entries: { path: string; ts: number; data: string }[] = [];
  addCalls: { path: string; ts: number; data: string }[] = [];
  migrateCalls: { oldPath: string; newPath: string }[] = [];
  constructor(seed: { path: string; ts: number; data: string }[] = []) {
    this.entries = [...seed];
  }
  private sorted(path: string) {
    return this.entries.filter(e => e.path === path).sort((a, b) => b.ts - a.ts);
  }
  async getLatest(path: string) {
    const top = this.sorted(path)[0];
    return top ? { ts: top.ts, data: top.data } : null;
  }
  async getEntries(path: string) {
    return this.sorted(path).map(({ ts, data }) => ({ ts, data }));
  }
  async add(path: string, ts: number, data: string) {
    this.addCalls.push({ path, ts, data });
    const latest = await this.getLatest(path);
    if (latest && sameContent(latest.data, data)) return false;
    this.entries.push({ path, ts, data });
    return true;
  }
  async migratePath(oldPath: string, newPath: string) {
    this.migrateCalls.push({ oldPath, newPath });
    for (const e of this.entries) if (e.path === oldPath) e.path = newPath;
  }
  async pruneRetention() {
    return 0;
  }
  async purge() {
    this.entries = [];
  }
  close() {}
}

function mdFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

/** vault 假件：read 返回 content() 的当前值；fire 手动派发事件 */
function fakeVault(content: () => string | Promise<string>) {
  const handlers = new Map<string, Array<(f: unknown, old?: string) => void>>();
  const refs: EventRef[] = [];
  return {
    vault: {
      on: (ev: string, cb: (f: unknown, old?: string) => void) => {
        const list = handlers.get(ev) ?? [];
        list.push(cb);
        handlers.set(ev, list);
        const ref = {} as EventRef;
        refs.push(ref);
        return ref;
      },
      offref: (ref: EventRef) => {
        const i = refs.indexOf(ref);
        if (i >= 0) refs.splice(i, 1);
      },
      read: async () => content(),
    } as unknown as RecorderVault,
    fire: (ev: 'modify' | 'create', file: unknown) => {
      for (const cb of handlers.get(ev) ?? []) cb(file);
    },
    fireRename: (file: unknown, oldPath: string) => {
      for (const cb of handlers.get('rename') ?? []) cb(file, oldPath);
    },
    registeredRefs: () => refs.length,
  };
}

describe('SnapshotRecorder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const THRESHOLD = 60_000;
  function setup(content: () => string | Promise<string>, seed?: ConstructorParameters<typeof MemoryStore>[0]) {
    const store = new MemoryStore(seed);
    const env = fakeVault(content);
    let nowMs = 1_000_000;
    const rec = new SnapshotRecorder(env.vault, store, {
      thresholdMs: () => THRESHOLD,
      now: () => nowMs,
    });
    rec.mount();
    return { store, env, rec, tick: (ms: number) => (nowMs += ms) };
  }
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('会话开始：改前内容入快照（重启后从库取），随后 lastKnown 更新为新内容', async () => {
    const { store, env, tick } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await settle();
    expect(store.addCalls).toEqual([{ path: 'a.md', ts: 1_000_000, data: 'v1' }]);
    // 注意：advanceTimers 只推进计时器，不推进注入的 now（nowMs 不变），会话结束的 ts 仍是 1_000_000
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1); // 静默满阈值 → 会话结束
    expect(store.addCalls).toEqual([
      { path: 'a.md', ts: 1_000_000, data: 'v1' },
      { path: 'a.md', ts: 1_000_000, data: 'v2' },
    ]);
  });

  it('阈值内连续 modify 不重复写改前快照；计时器随每次修改重置', async () => {
    const { store, env, tick } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await settle();
    tick(30_000);
    env.fire('modify', mdFile('a.md'));
    await settle();
    tick(30_000);
    env.fire('modify', mdFile('a.md')); // 距首次 60s，仍 < 阈值（60s 须「大于等于」才算新会话）
    await settle();
    expect(store.addCalls.filter(c => c.data === 'v1')).toHaveLength(1);
    // 只在最后一次 modify 后静默满阈值才写会话结束快照
    await vi.advanceTimersByTimeAsync(50_000);
    expect(store.addCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(THRESHOLD);
    expect(store.addCalls).toHaveLength(2);
    expect(store.addCalls[1].data).toBe('v2');
  });

  it('新会话再次编辑：改前内容=上次会话结束内容，去重闸门挡掉重复写入', async () => {
    const { store, env, tick } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1); // 会话结束：v2 入库
    tick(2 * 60 * 60 * 1000); // 两小时后再编辑
    env.fire('modify', mdFile('a.md'));
    await settle();
    expect(store.addCalls).toHaveLength(3); // 第三次 add 被调用……
    expect(store.entries).toHaveLength(2); // ……但内容与最新条相同，未真正写入
  });

  it('本会话内已知内容直接来自内存：改前快照取上次 modify 的内容而非库里旧值', async () => {
    let disk = 'v2';
    const { store, env, tick } = setup(() => disk, [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1); // 会话结束：v2 入库
    disk = 'v3';
    tick(120_000);
    env.fire('modify', mdFile('a.md')); // 新会话：改前应取内存里的 v2
    await settle();
    expect(store.addCalls.at(-1)!.data).toBe('v2');
  });

  it('create：新建文件立即写初始快照', async () => {
    const { store, env } = setup(() => 'v1');
    env.fire('create', mdFile('new.md'));
    await settle();
    expect(store.entries).toEqual([{ path: 'new.md', ts: 1_000_000, data: 'v1' }]);
  });

  it('rename：迁移库记录并同步内存键', async () => {
    let disk = 'v2';
    const { store, env, tick } = setup(() => disk);
    env.fire('create', mdFile('old.md'));
    await settle();
    env.fire('rename', mdFile('new.md'), 'old.md');
    await settle();
    expect(store.migrateCalls).toEqual([{ oldPath: 'old.md', newPath: 'new.md' }]);
    await expect(store.getEntries('new.md')).resolves.toHaveLength(1);
    await expect(store.getEntries('old.md')).resolves.toHaveLength(0);
    tick(120_000);
    env.fire('modify', mdFile('new.md')); // 新路径继续编辑，改前=迁移来的 v1……
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1);
    // ……会话结束写 v2，都应记在新路径下
    expect(store.entries.every(e => e.path === 'new.md')).toBe(true);
  });

  it('非 md 文件忽略', async () => {
    const { store, env } = setup(() => 'x');
    env.fire('modify', { path: 'a.png', extension: 'png' } as unknown as TFile);
    env.fire('modify', { path: 'folder' } as unknown as TFile); // 无 extension（文件夹）
    await settle();
    expect(store.addCalls).toHaveLength(0);
  });

  it('vault.read 失败吞掉，不产生 unhandled rejection', async () => {
    const { store, env } = setup(() => {
      throw new Error('disk gone');
    });
    env.fire('modify', mdFile('a.md'));
    await expect(settle()).resolves.toBeUndefined();
    expect(store.addCalls).toHaveLength(0);
  });

  it('dispose：清计时器、尽力 flush lastKnown、注销全部事件', async () => {
    const { store, env, rec } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    const before = env.registeredRefs();
    env.fire('modify', mdFile('a.md'));
    await settle();
    rec.dispose();
    await vi.advanceTimersByTimeAsync(10 * THRESHOLD); // 计时器已清，不再有会话结束写入
    expect(store.addCalls).toHaveLength(2); // 改前 v1 + dispose flush 的 v2
    expect(env.registeredRefs()).toBe(before - 3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/snapshot-recorder.test.ts`
Expected: FAIL——`Cannot find module '../src/snapshot-recorder'`。

- [ ] **Step 3: 实现 snapshot-recorder.ts**

创建 `src/snapshot-recorder.ts`（obsidian 全部 type-only import，无运行时依赖）：

```ts
import type { EventRef, TAbstractFile, TFile, Vault } from 'obsidian';
import type { SnapshotStoreLike } from './snapshot-store';

type Timer = ReturnType<typeof setTimeout>;

/** vault 的最小依赖面；真实 Vault 结构满足，测试传假件 */
export type RecorderVault = Pick<Vault, 'on' | 'offref' | 'read'>;

export interface RecorderOptions {
  /** 会话边界阈值，每次事件实时读取（设置页改阈值立即生效） */
  thresholdMs(): number;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): Timer;
  clearTimeout?(t: Timer): void;
}

/**
 * 会话边界快照：某次 modify 距上次 ≥ 阈值视为新编辑会话——
 * 会话开始把改前内容写库（即「编辑前快照」），静默满阈值把改后内容写库。
 * 每文件每次会话最多两条写入；所有 store 写入经过 add 的去重闸门。
 */
export class SnapshotRecorder {
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => Timer;
  private readonly cancelTimer: (t: Timer) => void;
  private readonly thresholdMs: () => number;
  private readonly refs: EventRef[] = [];
  private readonly lastModifyTs = new Map<string, number>();
  /** 本会话内最近一次 modify 时的内容；改前内容优先取这里，取不到（重启后首改）读库 */
  private readonly lastKnown = new Map<string, string>();
  private readonly endTimers = new Map<string, Timer>();
  /** 同一文件的操作串行化，避免读写竞态；链上错误全部吞掉（快照尽力而为） */
  private readonly ops = new Map<string, Promise<void>>();

  constructor(
    private vault: RecorderVault,
    private store: SnapshotStoreLike,
    opts: RecorderOptions
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelTimer = opts.clearTimeout ?? (t => clearTimeout(t));
    this.thresholdMs = opts.thresholdMs;
  }

  mount(): void {
    this.refs.push(
      this.vault.on('modify', f => this.onModify(f as TFile)),
      this.vault.on('create', f => this.onCreate(f as TFile)),
      this.vault.on('rename', (f, oldPath) => this.onRename(f as TFile, oldPath))
    );
  }

  dispose(): void {
    for (const t of this.endTimers.values()) this.cancelTimer(t);
    this.endTimers.clear();
    // 尽力 flush：IDB 事务已发起的大概率能在退出前提交，不保证完成
    for (const [path, data] of this.lastKnown) {
      void this.store.add(path, this.now(), data).catch(() => {});
    }
    for (const ref of this.refs) this.vault.offref(ref);
    this.refs.length = 0;
  }

  private enqueue(path: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.ops.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn).then(
      () => undefined,
      () => undefined
    );
    this.ops.set(path, next);
    return next;
  }

  private onModify(file: TAbstractFile): void {
    const f = file as TFile;
    if (f.extension !== 'md') return;
    const path = f.path;
    const ts = this.now();
    const prev = this.lastModifyTs.get(path);
    this.lastModifyTs.set(path, ts);
    this.armBurstEnd(path);
    const burstStart = prev === undefined || ts - prev >= this.thresholdMs();
    void this.enqueue(path, async () => {
      if (burstStart) {
        const pre = this.lastKnown.get(path) ?? (await this.store.getLatest(path))?.data;
        if (pre !== undefined) await this.store.add(path, ts, pre);
      }
      try {
        this.lastKnown.set(path, await this.vault.read(f));
      } catch {
        /* 文件已删等，跳过 */
      }
    });
  }

  private armBurstEnd(path: string): void {
    const prev = this.endTimers.get(path);
    if (prev !== undefined) this.cancelTimer(prev);
    this.endTimers.set(
      path,
      this.schedule(() => {
        this.endTimers.delete(path);
        this.onBurstEnd(path);
      }, this.thresholdMs())
    );
  }

  private onBurstEnd(path: string): void {
    const content = this.lastKnown.get(path);
    if (content === undefined) return;
    // 不清 lastModifyTs：下次 modify 判定为新会话、改前内容=本次结束内容，
    // 去重闸门挡掉重复写入，行为自洽
    void this.enqueue(path, () => this.store.add(path, this.now(), content));
  }

  private onCreate(file: TAbstractFile): void {
    const f = file as TFile;
    if (f.extension !== 'md') return;
    const ts = this.now();
    void this.enqueue(f.path, async () => {
      try {
        const data = await this.vault.read(f);
        await this.store.add(f.path, ts, data);
        this.lastKnown.set(f.path, data);
      } catch {
        /* 忽略 */
      }
    });
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    const f = file as TFile;
    void this.enqueue(oldPath, () => this.store.migratePath(oldPath, f.path)).then(() => {
      for (const m of [this.lastModifyTs, this.lastKnown]) {
        if (m.has(oldPath)) {
          m.set(f.path, m.get(oldPath)!);
          m.delete(oldPath);
        }
      }
      const t = this.endTimers.get(oldPath);
      if (t !== undefined) {
        this.endTimers.set(f.path, t);
        this.endTimers.delete(oldPath);
      }
    });
  }
}
```

注意 `onRename` 里 `m.get(oldPath)!`——Map 读后写不会为 undefined（`m.has` 已保证），非空断言成立。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/snapshot-recorder.test.ts`
Expected: 9 个用例全 PASS。若「阈值内连续 modify」用例对 `>=` 边界敏感，确认实现用 `ts - prev >= thresholdMs()`（间隔恰等于阈值即新会话）。

- [ ] **Step 5: 提交**

```bash
git add src/snapshot-recorder.ts tests/snapshot-recorder.test.ts
git commit -m "feat: SnapshotRecorder 会话边界快照——编辑间隔超阈值自动保存改前/改后内容"
```

---

### Task 4: runBaselineScan（首次全量基线）

**Files:**
- Modify: `src/snapshot-recorder.ts`（文件末尾追加）
- Test: `tests/snapshot-recorder.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `SnapshotStoreLike`；`import type { TFile, Vault } from 'obsidian'`。
- Produces: `runBaselineScan(vault: Pick<Vault, 'getMarkdownFiles' | 'cachedRead'>, store: SnapshotStoreLike, opts?: BaselineScanOptions): Promise<number>`（返回写入条数）。Task 7 调用它。

- [ ] **Step 1: 写失败测试**

在 `tests/snapshot-recorder.test.ts` 追加（import 行补 `runBaselineScan`）：

```ts
describe('runBaselineScan', () => {
  function scanVault(files: string[]) {
    let readCount = 0;
    return {
      vault: {
        getMarkdownFiles: () => files.map(p => ({ path: p, extension: 'md' } as unknown as TFile)),
        cachedRead: async (f: unknown) => {
          readCount++;
          return `content of ${(f as TFile).path}`;
        },
      } as unknown as Parameters<typeof runBaselineScan>[0],
      readCount: () => readCount,
    };
  }

  it('分批读全部文件写入快照，批间让出控制权', async () => {
    const store = new MemoryStore();
    const files = Array.from({ length: 205 }, (_, i) => `note${i}.md`);
    const { vault } = scanVault(files);
    let yields = 0;
    const written = await runBaselineScan(vault, store, {
      batchSize: 100,
      yieldControl: async () => {
        yields++;
      },
    });
    expect(written).toBe(205);
    expect(store.entries).toHaveLength(205);
    expect(yields).toBeGreaterThanOrEqual(2); // 205 / 100 → 至少两次批间让出
  });

  it('重跑经去重闸门自动增量：内容没变不写入', async () => {
    const store = new MemoryStore();
    const { vault } = scanVault(['a.md', 'b.md']);
    expect(await runBaselineScan(vault, store)).toBe(2);
    expect(await runBaselineScan(vault, store)).toBe(0);
  });

  it('shouldContinue 中途变 false：立即停止并返回已完成数', async () => {
    const store = new MemoryStore();
    const { vault } = scanVault(['a.md', 'b.md', 'c.md']);
    let call = 0;
    const written = await runBaselineScan(vault, store, {
      batchSize: 1,
      shouldContinue: () => ++call <= 2,
    });
    expect(written).toBe(2);
    expect(store.entries).toHaveLength(2);
  });

  it('单文件读失败跳过，不影响其余文件', async () => {
    const store = new MemoryStore();
    const vault = {
      getMarkdownFiles: () =>
        ['ok.md', 'bad.md'].map(p => ({ path: p, extension: 'md' } as unknown as TFile)),
      cachedRead: async (f: unknown) => {
        if ((f as TFile).path === 'bad.md') throw new Error('boom');
        return 'x';
      },
    } as unknown as Parameters<typeof runBaselineScan>[0];
    expect(await runBaselineScan(vault, store)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/snapshot-recorder.test.ts`
Expected: 新 describe FAIL（`runBaselineScan` 未导出）。

- [ ] **Step 3: 实现**

`src/snapshot-recorder.ts` 头部 import 补 `Vault`（type-only），末尾追加：

```ts
export interface BaselineScanOptions {
  batchSize?: number;
  yieldControl?: () => Promise<void>;
  shouldContinue?: () => boolean;
  now?: () => number;
}

/**
 * 全库基线扫描：为每个 md 文件写一条当前内容快照。
 * 内容未变化的文件被 add 的去重闸门跳过，重跑天然增量。
 * 分批执行、批间让出主线程，避免大 vault 卡顿。
 */
export async function runBaselineScan(
  vault: Pick<Vault, 'getMarkdownFiles' | 'cachedRead'>,
  store: SnapshotStoreLike,
  opts: BaselineScanOptions = {}
): Promise<number> {
  const batchSize = opts.batchSize ?? 200;
  const yieldControl = opts.yieldControl ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const now = opts.now ?? Date.now;
  const files = vault.getMarkdownFiles();
  let written = 0;
  for (let i = 0; i < files.length; i += batchSize) {
    if (!shouldContinue()) return written;
    for (const f of files.slice(i, i + batchSize)) {
      if (!shouldContinue()) return written;
      try {
        if (await store.add(f.path, now(), await vault.cachedRead(f))) written++;
      } catch {
        /* 单文件失败跳过 */
      }
    }
    await yieldControl();
  }
  return written;
}
```

- [ ] **Step 4: 跑全量测试确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/snapshot-recorder.ts tests/snapshot-recorder.test.ts
git commit -m "feat: runBaselineScan 首次全量基线——分批增量扫描，重跑零成本"
```

---

### Task 5: strings 新键

**Files:**
- Modify: `src/strings.ts`
- Test: `tests/strings.test.ts`（扩展）

**Interfaces:**
- Consumes: 现有 `UiStrings`/`stringsForLocale`。
- Produces: 下列新键（Task 6/7 消费，键名一字不差）：
  `settingsOwnSnapshotsSection`、`settingOwnSnapshotsName`、`settingOwnSnapshotsDesc`、`settingThresholdName`、`settingThresholdDesc`、`settingRetentionName`、`settingRetentionDesc`、`settingBaselineName`、`settingBaselineDesc`、`settingPurgeName`、`settingPurgeDesc`、`confirmPurgeTitle`、`confirmPurgeBody`、`confirmPurgeConfirm`、`confirmPurgeCancel`、`noticeBaselineDone(count)`、`noticeStoreOpenFailed`、`noticePurgeDone`、`noticeOwnStoreReadFailed`。

- [ ] **Step 1: 写失败测试**

在 `tests/strings.test.ts` 追加：

```ts
describe('自动快照设置文案', () => {
  const NEW_KEYS = [
    'settingsOwnSnapshotsSection',
    'settingOwnSnapshotsName',
    'settingOwnSnapshotsDesc',
    'settingThresholdName',
    'settingThresholdDesc',
    'settingRetentionName',
    'settingRetentionDesc',
    'settingBaselineName',
    'settingBaselineDesc',
    'settingPurgeName',
    'settingPurgeDesc',
    'confirmPurgeTitle',
    'confirmPurgeBody',
    'confirmPurgeConfirm',
    'confirmPurgeCancel',
    'noticeStoreOpenFailed',
    'noticePurgeDone',
    'noticeOwnStoreReadFailed',
  ] as const;

  it('新键在 zh/en 两套里都是非空字符串', () => {
    const zh = stringsForLocale('zh-cn') as unknown as Record<string, unknown>;
    const en = stringsForLocale('en') as unknown as Record<string, unknown>;
    for (const k of NEW_KEYS) {
      expect(typeof zh[k]).toBe('string');
      expect((zh[k] as string).length).toBeGreaterThan(0);
      expect(typeof en[k]).toBe('string');
      expect((en[k] as string).length).toBeGreaterThan(0);
    }
  });

  it('noticeBaselineDone 带条数插值', () => {
    expect(stringsForLocale('zh-cn').noticeBaselineDone(42)).toBe('基线完成：写入 42 条快照');
    expect(stringsForLocale('en').noticeBaselineDone(42)).toBe('Baseline complete: 42 snapshots written');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/strings.test.ts`
Expected: FAIL——`UiStrings` 上不存在新键（tsc 层面编译报错或运行时 undefined）。

- [ ] **Step 3: 实现**

`src/strings.ts` 的 `UiStrings` 接口追加（含注释）：

```ts
  /** —— 自动快照（设置页 + 通知） —— */
  settingsOwnSnapshotsSection: string;
  settingOwnSnapshotsName: string;
  settingOwnSnapshotsDesc: string;
  settingThresholdName: string;
  settingThresholdDesc: string;
  settingRetentionName: string;
  settingRetentionDesc: string;
  settingBaselineName: string;
  settingBaselineDesc: string;
  settingPurgeName: string;
  settingPurgeDesc: string;
  confirmPurgeTitle: string;
  confirmPurgeBody: string;
  confirmPurgeConfirm: string;
  confirmPurgeCancel: string;
  noticeBaselineDone: (count: number) => string;
  noticeStoreOpenFailed: string;
  noticePurgeDone: string;
  noticeOwnStoreReadFailed: string;
```

`zh` 对象追加：

```ts
  settingsOwnSnapshotsSection: '自动快照',
  settingOwnSnapshotsName: '启用自动快照',
  settingOwnSnapshotsDesc: '在每次编辑会话开始前自动保存笔记快照，供历史比对使用。快照只存储在本机，不上传。',
  settingThresholdName: '会话边界阈值（分钟）',
  settingThresholdDesc: '两次编辑的间隔超过该时长视为新的编辑会话，会话开始前的内容会被自动快照。范围 1–60。',
  settingRetentionName: '快照保留天数',
  settingRetentionDesc: '更早的自动快照会被自动清理。范围 1–365。',
  settingBaselineName: '重建基线',
  settingBaselineDesc: '为所有笔记写入当前内容的快照（内容未变化的自动跳过）。',
  settingPurgeName: '清除全部自动快照',
  settingPurgeDesc: '删除本插件保存的全部快照，操作不可恢复。',
  confirmPurgeTitle: '清除全部自动快照',
  confirmPurgeBody: '将删除本插件保存的全部快照，该操作不可恢复。确定继续吗？',
  confirmPurgeConfirm: '清除',
  confirmPurgeCancel: '取消',
  noticeBaselineDone: count => `基线完成：写入 ${count} 条快照`,
  noticeStoreOpenFailed: '自动快照库打开失败，自动快照已停用',
  noticePurgeDone: '已清除全部自动快照',
  noticeOwnStoreReadFailed: '读取自动快照失败，本次仅使用文件恢复的快照',
```

`en` 对象追加：

```ts
  settingsOwnSnapshotsSection: 'Automatic snapshots',
  settingOwnSnapshotsName: 'Enable automatic snapshots',
  settingOwnSnapshotsDesc: 'Automatically snapshot notes before each editing session for later comparison. Snapshots never leave this device.',
  settingThresholdName: 'Session boundary threshold (minutes)',
  settingThresholdDesc: 'A gap longer than this between edits starts a new session; the pre-session content is snapshotted. Range 1–60.',
  settingRetentionName: 'Snapshot retention (days)',
  settingRetentionDesc: 'Older automatic snapshots are pruned automatically. Range 1–365.',
  settingBaselineName: 'Rebuild baseline',
  settingBaselineDesc: 'Snapshot the current content of all notes (unchanged notes are skipped).',
  settingPurgeName: 'Purge all automatic snapshots',
  settingPurgeDesc: 'Delete every snapshot stored by this plugin. This cannot be undone.',
  confirmPurgeTitle: 'Purge all automatic snapshots',
  confirmPurgeBody: 'All snapshots stored by this plugin will be deleted. This cannot be undone. Continue?',
  confirmPurgeConfirm: 'Purge',
  confirmPurgeCancel: 'Cancel',
  noticeBaselineDone: count => `Baseline complete: ${count} snapshots written`,
  noticeStoreOpenFailed: 'Failed to open the snapshot store; automatic snapshots are disabled',
  noticePurgeDone: 'All automatic snapshots purged',
  noticeOwnStoreReadFailed: 'Failed to read automatic snapshots; using File Recovery snapshots only',
```

测试文件头部 import 行补上 `stringsForLocale`（若尚未导入）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/strings.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/strings.ts tests/strings.test.ts
git commit -m "feat: 自动快照设置页与通知文案（zh/en）"
```

---

### Task 6: settings 模块（设置面板）

**Files:**
- Create: `src/settings.ts`

**Interfaces:**
- Consumes: Task 5 的全部新键；`PluginSettingTab`/`Setting`/`Modal`（运行时 import obsidian——本模块**不做单测**，与 main.ts 同等对待，靠 `npm run build` 的 tsc 检查 + Task 8 手动验证）。
- Produces: `ReviewEditSettings`（四字段）、`DEFAULT_SETTINGS`、`SettingsHost` 接口、`ReviewEditSettingTab`。Task 7 的插件类实现 `SettingsHost`。

- [ ] **Step 1: 实现 settings.ts**

```ts
import type { App, Plugin } from 'obsidian';
import { Modal, PluginSettingTab, Setting } from 'obsidian';
import { uiStrings } from './strings';

export interface ReviewEditSettings {
  ownSnapshotsEnabled: boolean;
  burstThresholdMinutes: number;
  retentionDays: number;
  /** 首次全量基线是否已完成；不清除重建依据，purge 也不重置（重建由用户显式触发） */
  baselined: boolean;
}

export const DEFAULT_SETTINGS: ReviewEditSettings = {
  ownSnapshotsEnabled: true,
  burstThresholdMinutes: 1,
  retentionDays: 30,
  baselined: false,
};

/** 设置面板的宿主：main.ts 的插件实例实现这个接口 */
export interface SettingsHost {
  settings: ReviewEditSettings;
  saveSettings(): Promise<void>;
  enableOwnSnapshots(): Promise<void>;
  disableOwnSnapshots(): void;
  rebuildBaseline(): Promise<void>;
  purgeSnapshots(): Promise<void>;
}

class PurgeConfirmModal extends Modal {
  constructor(app: App, private host: SettingsHost) {
    super(app);
  }

  onOpen(): void {
    const t = uiStrings();
    this.titleEl.setText(t.confirmPurgeTitle);
    this.contentEl.createEl('p', { text: t.confirmPurgeBody });
    new Setting(this.contentEl)
      .addButton(b =>
        b.setButtonText(t.confirmPurgeConfirm)
          .setWarning()
          .onClick(() => {
            void this.host.purgeSnapshots().finally(() => this.close());
          })
      )
      .addButton(b => b.setButtonText(t.confirmPurgeCancel).onClick(() => this.close()));
  }
}

export class ReviewEditSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: SettingsHost) {
    super(app, plugin as unknown as Plugin);
  }

  display(): void {
    const t = uiStrings();
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t.settingsOwnSnapshotsSection).setHeading();

    new Setting(containerEl)
      .setName(t.settingOwnSnapshotsName)
      .setDesc(t.settingOwnSnapshotsDesc)
      .addToggle(tg =>
        tg.setValue(this.plugin.settings.ownSnapshotsEnabled).onChange(async v => {
          this.plugin.settings.ownSnapshotsEnabled = v;
          await this.plugin.saveSettings();
          if (v) await this.plugin.enableOwnSnapshots();
          else this.plugin.disableOwnSnapshots();
        })
      );

    new Setting(containerEl)
      .setName(t.settingThresholdName)
      .setDesc(t.settingThresholdDesc)
      .addText(tx =>
        tx.setValue(String(this.plugin.settings.burstThresholdMinutes)).onChange(async v => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n >= 1 && n <= 60) {
            this.plugin.settings.burstThresholdMinutes = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName(t.settingRetentionName)
      .setDesc(t.settingRetentionDesc)
      .addText(tx =>
        tx.setValue(String(this.plugin.settings.retentionDays)).onChange(async v => {
          const n = Math.round(Number(v));
          if (Number.isFinite(n) && n >= 1 && n <= 365) {
            this.plugin.settings.retentionDays = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName(t.settingBaselineName)
      .setDesc(t.settingBaselineDesc)
      .addButton(b => b.setButtonText(t.settingBaselineName).onClick(() => void this.plugin.rebuildBaseline()));

    new Setting(containerEl)
      .setName(t.settingPurgeName)
      .setDesc(t.settingPurgeDesc)
      .addButton(b => b.setButtonText(t.settingPurgeName).onClick(() => new PurgeConfirmModal(this.app, this.plugin).open()));
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run build`
Expected: tsc 无错误（此时 main.ts 还没引用本模块，仅验证本文件自洽）。

- [ ] **Step 3: 提交**

```bash
git add src/settings.ts
git commit -m "feat: 自动快照设置面板（开关/阈值/保留期/重建基线/清除）"
```

---

### Task 7: main.ts 总装

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 1 `SnapshotStore`、Task 3 `SnapshotRecorder`/`RecorderVault`/`runBaselineScan`、Task 2 `getMergedSnapshots`、Task 6 `ReviewEditSettings`/`DEFAULT_SETTINGS`/`ReviewEditSettingTab`/`SettingsHost`。
- Produces: 完整可运行的插件（实现 `SettingsHost`）。

- [ ] **Step 1: 改 main.ts**

改动点（其余保持原样）：

1. import 区改为：

```ts
import { MarkdownView, Notice, Plugin, setIcon, TFile } from 'obsidian';
import { cm-extension 部分不变 } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getMergedSnapshots, filterDiffering, SnapshotSourceUnavailableError } from './snapshot-source';
import { runBaselineScan, SnapshotRecorder } from './snapshot-recorder';
import { SnapshotStore } from './snapshot-store';
import { DEFAULT_SETTINGS, ReviewEditSettingTab, type ReviewEditSettings, type SettingsHost } from './settings';
import { SnapshotPickerModal } from './snapshot-picker';
import { uiStrings } from './strings';
```

（第一行 `cm-extension` 等原有 import 内容保持不变，这里只列新增/替换的行。）

2. 类成员与 onload 开头：

```ts
export default class ReviewEditPlugin extends Plugin implements SettingsHost {
  diffMode!: DiffModeController;
  settings: ReviewEditSettings = { ...DEFAULT_SETTINGS };
  private store: SnapshotStore | null = null;
  private recorder: SnapshotRecorder | null = null;
  private ownStoreErrorNoticed = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ReviewEditSettingTab(this.app, this));
    this.diffMode = new DiffModeController(this.app, this);
    // ……（原有 registerEditorExtension / registerEvent / onLayoutReady(ensureHeaderButtons) / 命令 / ribbon 全部保持不变）……
    this.app.workspace.onLayoutReady(() => void this.afterLayoutReady());
  }
```

注意：原 `onLayoutReady(() => this.ensureHeaderButtons())` 保留，另加一行 `onLayoutReady(() => void this.afterLayoutReady())`。

3. 新增私有与公有方法（放在 `ensureHeaderButtons` 之前）：

```ts
  /** SettingsHost：设置持久化 */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ReviewEditSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  private async afterLayoutReady(): Promise<void> {
    if (!this.settings.ownSnapshotsEnabled) return;
    await this.enableOwnSnapshots();
    // 每日保留期清理；registerInterval 随插件卸载自动撤销
    this.registerInterval(
      window.setInterval(() => {
        void this.store?.pruneRetention(this.settings.retentionDays).catch(() => {});
      }, 24 * 60 * 60 * 1000)
    );
  }

  /** SettingsHost：开启（或重启后恢复）自动快照 */
  async enableOwnSnapshots(): Promise<void> {
    if (!this.store) {
      try {
        this.store = await SnapshotStore.open();
      } catch {
        new Notice(uiStrings().noticeStoreOpenFailed);
        return;
      }
    }
    if (this.recorder) return;
    this.recorder = new SnapshotRecorder(this.app.vault, this.store, {
      thresholdMs: () => this.settings.burstThresholdMinutes * 60_000,
    });
    this.recorder.mount();
    void this.store.pruneRetention(this.settings.retentionDays).catch(() => {});
    if (!this.settings.baselined) await this.rebuildBaseline();
  }

  /** SettingsHost：运行中关闭——立即停录，已存快照保留 */
  disableOwnSnapshots(): void {
    this.recorder?.dispose();
    this.recorder = null;
  }

  /** SettingsHost：手动/首次基线 */
  async rebuildBaseline(): Promise<void> {
    const store = this.store;
    if (!store) return;
    const written = await runBaselineScan(this.app.vault, store, {
      shouldContinue: () => this.settings.ownSnapshotsEnabled && this.store === store,
    });
    if (!this.settings.baselined) {
      this.settings.baselined = true;
      await this.saveSettings();
    }
    new Notice(uiStrings().noticeBaselineDone(written));
  }

  /** SettingsHost：清除全部自建快照（不动 baselined——重建由用户显式触发） */
  async purgeSnapshots(): Promise<void> {
    await this.store?.purge();
    new Notice(uiStrings().noticePurgeDone);
  }
```

4. `onunload` 改为（recorder 的 flush 先于关库，给已发起的事务留提交机会）：

```ts
  onunload() {
    this.diffMode.exit();
    this.disableOwnSnapshots();
    this.store?.close();
    this.store = null;
  }
```

5. `startReview` 里替换快照读取（原 79-85 行区域）：

```ts
    let rawEntries;
    try {
      const store = this.settings.ownSnapshotsEnabled ? this.store : null;
      rawEntries = await getMergedSnapshots(this.app, view.file.path, store, () => {
        if (this.ownStoreErrorNoticed) return;
        this.ownStoreErrorNoticed = true;
        new Notice(uiStrings().noticeOwnStoreReadFailed);
      });
    } catch (e) {
      new Notice(e instanceof SnapshotSourceUnavailableError ? t.noticeSnapshotSourceUnavailable : t.noticeReadSnapshotsFailed);
      return;
    }
```

- [ ] **Step 2: 构建与全量测试**

Run: `npm test && npm run build`
Expected: 全部测试 PASS，tsc + esbuild 无错误。lint 一并跑：`npm run lint`，有告警按提示修。

- [ ] **Step 3: 提交**

```bash
git add src/main.ts
git commit -m "feat: 总装自动快照——启动基线/每日清理/双源读取/设置宿主"
```

---

### Task 8: README、manifest 与端到端验证

**Files:**
- Modify: `README.md`、`manifest.json`

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 文档与产物更新；用户可在 vault 里手动验证的清单。发版本身（`npm version minor` + push + release）**须用户确认后执行**，不在本任务提交内。

- [ ] **Step 1: 改 manifest description**

`manifest.json` 的 `description` 改为：

```json
  "description": "Review note edits as a Git-style diff and keep or revert each hunk. Automatic snapshots before every edit. Ideal for reviewing AI edits.",
```

（135 字符，英文、动词开头、句号结尾、无 emoji，符合 AGENTS.md 规则。注意：manifest 改动合入 main 后需要发版，见 Step 5。）

- [ ] **Step 2: 改 README**

英文正文（在现有功能介绍之后加一节）：

```markdown
## Automatic snapshots

Once enabled, Review Edit maintains its own snapshot store: whenever you stop editing a note for longer than the session threshold (1 minute by default), the pre-edit content is snapshotted automatically — no setup, and it works for edits made by external tools and scripts while Obsidian is running, not just in-app edits. On first launch it takes a baseline snapshot of your whole vault in the background, and snapshots older than the retention period (30 days by default) are pruned automatically.

Snapshots are stored locally in this device's IndexedDB and never leave your machine. You can purge all of them anytime from the plugin settings. File Recovery snapshots, when available, are still used as an additional source.
```

文末「中文说明」章节追加对应中文段落（内容与上文一致，按 README 现有中文段落风格）：

```markdown
### 自动快照

启用后插件自带一套快照系统：笔记编辑停顿超过会话阈值（默认 1 分钟）即自动保存改前内容，零配置；只要 Obsidian 在运行，外部工具和脚本对笔记的修改同样会被记录（首次启动会后台做一次全库基线，过期快照按保留期自动清理，默认 30 天）。快照只存在本机 IndexedDB，不上传，可随时在设置里一键清除。文件恢复的快照仍会作为补充数据源使用。
```

- [ ] **Step 3: 全量验证**

Run: `npm test && npm run build && npm run lint`
Expected: 全绿。

- [ ] **Step 4: 复制产物进 vault 并手动端到端验证（按 AGENTS.md 流程）**

```bash
cp manifest.json main.js styles.css "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit/"
```

请用户在 Obsidian 里重载插件（或重启），然后依次验证（每步用 `obsidian eval` 查库）：

1. 基线完成：设置页出现「自动快照」区；稍等 1–2 分钟后弹「基线完成：写入 N 条快照」。核对条数：

```bash
obsidian eval code="(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('review-edit-snapshots');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});return await new Promise((res,rej)=>{const rq=db.transaction('snapshots').objectStore('snapshots').count();rq.onsuccess=()=>res('entries='+rq.result);rq.onerror=()=>rej(rq.error)})})()"
```

2. 外部编辑场景（复刻 2026-08-20 实验）：git bash 里 `printf 'v2\n' >> "/c/Users/wenzh/Documents/MyLibrary/<某个从未打开的笔记>.md"`，等 2 分钟（跨过阈值），查该路径的记录：

```bash
obsidian eval code="(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('review-edit-snapshots');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const path='<笔记相对路径>';return await new Promise((res,rej)=>{const rq=db.transaction('snapshots').objectStore('snapshots').index('path').getAll(path);rq.onsuccess=()=>res(JSON.stringify(rq.result.map(r=>({ts:r.ts,len:r.data.length}))));rq.onerror=()=>rej(rq.error)})})()"
```

（把 `<笔记相对路径>` 换成实际路径；应看到改前内容一条 + 改后内容一条。）
3. UI 验证：打开该笔记 → 历史比对 → 选择器里出现自建快照条目 → diff 正常。
4. 设置页：改阈值、清除快照（确认弹窗）各走一遍。

- [ ] **Step 5: 提交（不含发版）**

```bash
git add README.md manifest.json
git commit -m "docs: README/manifest 增加自动快照说明（发版待确认后执行 npm version minor）"
```

发版提醒（用户确认后执行，按 AGENTS.md）：`npm version minor` → 推 main 与 tag → Actions draft 构建后 `gh release edit <tag> --draft=false --notes "<面向用户的变更 + compare 链接>"` → 下载资产核对 manifest 版本号。

---

## 计划自审记录

- **Spec 覆盖**：采集算法（Task 3）、存储（Task 1）、双源合并与失败语义（Task 2）、基线（Task 4）、设置与运行中切换（Task 6/7）、保留期清理（Task 7 `afterLayoutReady` + `registerInterval`）、文案（Task 5）、README/manifest/发版（Task 8）、移动端说明（spec 已声明尽力而为，无代码任务）。已知边界（离线编辑、退出尾随 60 秒）在 spec 声明为接受项，无需实现。
- **类型一致性**：`SnapshotStoreLike` 的 7 个方法在 Task 1 定义、Task 2/3/4 按同一签名消费；`RecorderVault = Pick<Vault,'on'|'offref'|'read'>` 使 `this.app.vault` 无需断言即可传入；`FileLike` 已移除（统一用 type-only `TFile` + 测试侧 `as unknown as TFile`）。
- **无占位符**：所有代码块完整可粘贴；main.ts 的 import 示例注明「原有 import 保持不变」的仅是未改动的行，改动行全部给出。
