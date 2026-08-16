# review-edit 插件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Obsidian 插件 review-edit：在编辑器内以红绿 diff 形式展示当前笔记相对某个文件恢复快照的差异，逐块「保留 ✓ / 撤销 ✕」。

**Architecture:** 五个模块：`snapshot-source`（读文件恢复的 IndexedDB 快照）→ `diff-engine`（纯函数行级 diff + 行号偏移修正）→ `cm-extension`（CodeMirror 6 装饰：红绿行、删除虚拟行、按钮工具条、只读）→ `diff-mode`（会话状态机与守卫）→ `main.ts`（命令与入口）。

**Tech Stack:** TypeScript + esbuild（Obsidian 官方模板模式）、`diff@^5`（Myers 行级算法）、`@codemirror/state` + `@codemirror/view`（由 Obsidian 运行时提供，构建时 external）、vitest 单元测试。

**Spec:** `docs/superpowers/specs/2026-08-17-review-edit-design.md`

## Global Constraints

- UI 文案全部用中文（命令名、通知、按钮）。
- manifest：`id: "review-edit"`，`minAppVersion: "1.5.0"`。
- esbuild externals：`obsidian`、`electron`、全部 `@codemirror/*`、`@lezer/*`、Node 内建模块；`diff` 必须**打包进** main.js。
- 单元测试文件不得在运行时 import `obsidian`（只允许 `import type`），否则 vitest 无法加载。
- 行号约定：`DiffHunk.currentFrom/currentTo` 是 0-based、左闭右开；CodeMirror 的 `doc.line()` 是 1-based。
- 每个任务结束都要 `git commit`，message 用 `feat:`/`test:`/`docs:` 前缀。
- 手动测试 vault：`C:\Users\wenzh\Documents\MyLibrary`（file-recovery 已启用）。快照生成条件：Obsidian 运行中编辑笔记且过了快照间隔（设置 → 核心插件 → 文件恢复 → 快照间隔，可临时调到 1 分钟加速测试）。手测建议在新建的草稿笔记上做。

---

### Task 1: 项目脚手架（构建通过）

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, `styles.css`, `src/main.ts`, `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: 可构建的空插件（`npm run build` 产出 `main.js`）；`ReviewEditPlugin` 类骨架

- [ ] **Step 1: 写入配置文件**

`package.json`：

```json
{
  "name": "review-edit",
  "version": "1.0.0",
  "description": "在编辑器内以 diff 形式审查笔记改动，逐块保留或撤销",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run"
  },
  "keywords": ["obsidian", "diff"],
  "author": "wenzh",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.11.30",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.2",
    "tslib": "^2.6.2",
    "typescript": "^5.4.3",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "@codemirror/state": "^6.4.1",
    "@codemirror/view": "^6.26.0",
    "diff": "^5.2.0",
    "obsidian": "^1.5.7"
  }
}
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2018",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "strict": true,
    "skipLibCheck": true,
    "lib": ["DOM", "ES2018"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`esbuild.config.mjs`：

```js
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: "/* 由 review-edit 构建生成 */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

`manifest.json`：

```json
{
  "id": "review-edit",
  "name": "Review Edit",
  "version": "1.0.0",
  "minAppVersion": "1.5.0",
  "description": "在编辑器内以 diff 形式审查笔记改动，逐块保留或撤销（基于文件恢复快照）",
  "author": "wenzh",
  "isDesktopOnly": false
}
```

`.gitignore`：

```
node_modules/
*.map
```

`src/main.ts`（骨架）：

```ts
import { Plugin } from 'obsidian';

export default class ReviewEditPlugin extends Plugin {
  async onload() {
    console.log('review-edit loaded');
  }
}
```

`styles.css`（空占位，后续任务填充）：

```css
/* review-edit styles */
```

- [ ] **Step 2: 安装依赖并构建**

Run: `npm install && npm run build`
Expected: 无报错，根目录生成 `main.js`，其中不含 `obsidian` 模块代码（external）。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: 插件脚手架（esbuild + ts + vitest 配置）"
```

---

### Task 2: diff-engine —— computeHunks（TDD）

**Files:**
- Create: `src/diff-engine.ts`, `tests/diff-engine.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，`diff` npm 包）
- Produces（后续任务依赖的确切签名）:
  - `type HunkStatus = 'pending' | 'kept'`
  - `type HunkType = 'added' | 'removed' | 'changed'`
  - `interface DiffHunk { id: number; status: HunkStatus; type: HunkType; currentFrom: number; currentTo: number; currentText: string; baselineText: string }`
  - `computeHunks(baseline: string, current: string): DiffHunk[]`（id 从 0 递增，全部初始 `pending`；行号 0-based 左闭右开；纯删除块 `currentFrom === currentTo` 且 `currentText === ''`）

- [ ] **Step 1: 写失败测试**

`tests/diff-engine.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { computeHunks } from '../src/diff-engine';

describe('computeHunks', () => {
  it('内容相同返回空数组', () => {
    expect(computeHunks('a\nb', 'a\nb')).toEqual([]);
  });

  it('纯新增行', () => {
    const hunks = computeHunks('a\nb', 'a\nX\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      id: 0, status: 'pending', type: 'added',
      currentFrom: 1, currentTo: 2, currentText: 'X', baselineText: ''
    });
  });

  it('纯删除行（currentFrom === currentTo）', () => {
    const hunks = computeHunks('a\nX\nb', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'removed', currentFrom: 1, currentTo: 1, currentText: '', baselineText: 'X'
    });
  });

  it('修改行（同位置先删后增）', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nB\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'changed', currentFrom: 1, currentTo: 2, currentText: 'B', baselineText: 'b'
    });
  });

  it('多个差异块行号各自正确', () => {
    const hunks = computeHunks('1\n2\n3\n4\n5', '1\nT\n3\n4\n5\n6');
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ currentFrom: 1, currentTo: 2, type: 'changed' });
    expect(hunks[1]).toMatchObject({ type: 'added', currentFrom: 5, currentTo: 6, currentText: '6' });
  });

  it('基准为空串时全文都是新增', () => {
    const hunks = computeHunks('', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ type: 'added', currentFrom: 0, currentTo: 2 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/diff-engine.test.ts`
Expected: FAIL（模块 `../src/diff-engine` 不存在）。

- [ ] **Step 3: 实现**

`src/diff-engine.ts`：

```ts
import { diffLines } from 'diff';
import type { Text } from '@codemirror/state';

export type HunkStatus = 'pending' | 'kept';
export type HunkType = 'added' | 'removed' | 'changed';

export interface DiffHunk {
  id: number;
  status: HunkStatus;
  type: HunkType;
  /** 当前文档 0-based 起始行（含） */
  currentFrom: number;
  /** 当前文档 0-based 结束行（不含）；纯删除块 currentFrom === currentTo */
  currentTo: number;
  currentText: string;
  baselineText: string;
}

const countLines = (v: string): number =>
  v === '' ? 0 : v.split('\n').length - (v.endsWith('\n') ? 1 : 0);

const stripTrailingNewline = (v: string): string =>
  v.endsWith('\n') ? v.slice(0, -1) : v;

export function computeHunks(baseline: string, current: string): DiffHunk[] {
  const parts = diffLines(baseline, current);
  const hunks: DiffHunk[] = [];
  let line = 0;
  let id = 0;
  for (let i = 0; i < parts.length; ) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      line += countLines(part.value);
      i += 1;
      continue;
    }
    const removedPart = part.removed ? part : null;
    const addedPart = parts[i + 1]?.added ? parts[i + 1] : null;
    const removedText = removedPart ? stripTrailingNewline(removedPart.value) : '';
    const addedText = addedPart ? stripTrailingNewline(addedPart.value) : '';
    const addedCount = addedPart ? countLines(addedPart.value) : 0;
    // 只差一个尾换行时 diff 可能给出空文本段，跳过
    if (removedText !== '' || addedText !== '') {
      hunks.push({
        id: id++,
        status: 'pending',
        type: removedText && addedText ? 'changed' : removedText ? 'removed' : 'added',
        currentFrom: line,
        currentTo: line + addedCount,
        currentText: addedText,
        baselineText: removedText,
      });
    }
    line += addedCount;
    i += removedPart && addedPart ? 2 : 1;
  }
  return hunks;
}
```

（`Text` 类型导入本任务暂未使用，Task 3 的 `revertEditSpec` 会用到；如 strict 报未使用，先去掉这行，Task 3 再加回。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/diff-engine.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/diff-engine.ts tests/diff-engine.test.ts
git commit -m "feat: computeHunks 行级差异块计算"
```

---

### Task 3: diff-engine —— shiftAfterReject + revertEditSpec（TDD）

**Files:**
- Modify: `src/diff-engine.ts`（追加两个函数）
- Modify: `tests/diff-engine.test.ts`（追加测试）

**Interfaces:**
- Consumes: Task 2 的 `DiffHunk`
- Produces:
  - `shiftAfterReject(hunks: DiffHunk[], rejectedId: number): DiffHunk[]` —— 纯函数：剔除被撤销块，把位于其后的块行号平移 `countLines(baselineText) - (currentTo - currentFrom)`
  - `revertEditSpec(doc: Text, hunk: DiffHunk): { from: number; to: number; insert: string }` —— 给定 CM6 `Text` 与差异块，返回可直接用于 `view.dispatch({ changes })` 的替换范围

- [ ] **Step 1: 追加失败测试**

在 `tests/diff-engine.test.ts` 末尾追加（并补导入）：

```ts
import { EditorState } from '@codemirror/state';
import { revertEditSpec, shiftAfterReject, type DiffHunk } from '../src/diff-engine';

const hunk = (over: Partial<DiffHunk>): DiffHunk => ({
  id: 0, status: 'pending', type: 'changed',
  currentFrom: 0, currentTo: 0, currentText: '', baselineText: '',
  ...over,
});

const apply = (docText: string, spec: { from: number; to: number; insert: string }): string =>
  EditorState.create({ doc: docText }).update({ changes: spec }).state.doc.toString();

describe('shiftAfterReject', () => {
  it('撤销删除块后，后续块行号下移（delta 为正）', () => {
    const hunks = [
      hunk({ id: 0, type: 'removed', currentFrom: 1, currentTo: 1, baselineText: 'X\nY' }),
      hunk({ id: 1, currentFrom: 3, currentTo: 4, currentText: 't', baselineText: 'u' }),
      hunk({ id: 2, currentFrom: 0, currentTo: 1, currentText: 'a', baselineText: 'A' }),
    ];
    const out = shiftAfterReject(hunks, 0);
    expect(out.map(h => h.id)).toEqual([1, 2]);
    expect(out.find(h => h.id === 1)).toMatchObject({ currentFrom: 5, currentTo: 6 });
    expect(out.find(h => h.id === 2)).toMatchObject({ currentFrom: 0, currentTo: 1 });
  });

  it('撤销新增块后，后续块行号上移（delta 为负）', () => {
    const hunks = [
      hunk({ id: 0, type: 'added', currentFrom: 1, currentTo: 3, currentText: 'p\nq' }),
      hunk({ id: 1, currentFrom: 3, currentTo: 4, currentText: 't', baselineText: 'u' }),
    ];
    const out = shiftAfterReject(hunks, 0);
    expect(out[0]).toMatchObject({ currentFrom: 1, currentTo: 2 });
  });

  it('id 不存在时原样返回', () => {
    const hunks = [hunk({ id: 0 })];
    expect(shiftAfterReject(hunks, 99)).toBe(hunks);
  });
});

describe('revertEditSpec', () => {
  it('文件中间的删除块：在原位插回旧行', () => {
    const doc = EditorState.create({ doc: 'a\nb' }).doc;
    const spec = revertEditSpec(doc, hunk({ type: 'removed', currentFrom: 1, currentTo: 1, baselineText: 'X' }));
    expect(apply('a\nb', spec)).toBe('a\nX\nb');
  });

  it('文件中间的修改块：替换回旧文本', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nB\nc' }).doc,
      hunk({ type: 'changed', currentFrom: 1, currentTo: 2, baselineText: 'b' })
    );
    expect(apply('a\nB\nc', spec)).toBe('a\nb\nc');
  });

  it('文件中间的新增块：整块删除', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nX\nb' }).doc,
      hunk({ type: 'added', currentFrom: 1, currentTo: 2, currentText: 'X' })
    );
    expect(apply('a\nX\nb', spec)).toBe('a\nb');
  });

  it('末尾修改块且文档无尾换行：不加多余换行', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nB' }).doc,
      hunk({ type: 'changed', currentFrom: 1, currentTo: 2, baselineText: 'b' })
    );
    expect(apply('a\nB', spec)).toBe('a\nb');
  });

  it('末尾删除块：把旧行追加到文件尾并补换行', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nb' }).doc,
      hunk({ type: 'removed', currentFrom: 2, currentTo: 2, baselineText: 'X' })
    );
    expect(apply('a\nb', spec)).toBe('a\nb\nX');
  });

  it('末尾修改块且文档有尾换行：保持尾换行', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nB\n' }).doc,
      hunk({ type: 'changed', currentFrom: 1, currentTo: 2, baselineText: 'b' })
    );
    expect(apply('a\nB\n', spec)).toBe('a\nb\n');
  });

  it('末尾新增块撤销（文档有尾换行）', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nb\nc\n' }).doc,
      hunk({ type: 'added', currentFrom: 2, currentTo: 3, currentText: 'c' })
    );
    expect(apply('a\nb\nc\n', spec)).toBe('a\nb\n');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/diff-engine.test.ts`
Expected: 新增用例 FAIL（两个函数未导出）。

- [ ] **Step 3: 实现（追加到 src/diff-engine.ts 末尾）**

```ts
export function shiftAfterReject(hunks: DiffHunk[], rejectedId: number): DiffHunk[] {
  const rejected = hunks.find(h => h.id === rejectedId);
  if (!rejected) return hunks;
  const delta = countLines(rejected.baselineText) - (rejected.currentTo - rejected.currentFrom);
  return hunks
    .filter(h => h.id !== rejectedId)
    .map(h =>
      h.currentFrom >= rejected.currentTo
        ? { ...h, currentFrom: h.currentFrom + delta, currentTo: h.currentTo + delta }
        : h
    );
}

export function revertEditSpec(doc: Text, h: DiffHunk): { from: number; to: number; insert: string } {
  const from = h.currentFrom < doc.lines ? doc.line(h.currentFrom + 1).from : doc.length;
  const atEof = h.currentTo >= doc.lines;
  const to = atEof ? doc.length : doc.line(h.currentTo + 1).from;
  if (h.currentFrom >= doc.lines) {
    // 纯删除块落在文档末尾：把基准行追加到文件尾部
    const endsWithNewline = doc.length > 0 && doc.sliceString(doc.length - 1) === '\n';
    const lead = doc.length > 0 && !endsWithNewline && h.baselineText !== '' ? '\n' : '';
    return { from, to, insert: lead + h.baselineText };
  }
  if (h.baselineText === '') return { from, to, insert: '' };
  const endsWithNewline = doc.length > 0 && doc.sliceString(doc.length - 1) === '\n';
  const insert = atEof && !endsWithNewline ? h.baselineText : h.baselineText + '\n';
  return { from, to, insert };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/diff-engine.ts tests/diff-engine.test.ts
git commit -m "feat: shiftAfterReject 行号平移与 revertEditSpec 还原范围计算"
```

---

### Task 4: snapshot-source（TDD，mock 内部 API）

**Files:**
- Create: `src/snapshot-source.ts`, `tests/snapshot-source.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface SnapshotEntry { ts: number; data: string }`
  - `class SnapshotSourceUnavailableError extends Error`
  - `getSnapshots(app: App, path: string): Promise<SnapshotEntry[]>` —— 按时间倒序，相邻重复内容去重；file-recovery 不可用时抛 `SnapshotSourceUnavailableError`
  - 注意：`App` 只能 `import type`（见 Global Constraints）

- [ ] **Step 1: 写失败测试**

`tests/snapshot-source.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { getSnapshots, SnapshotSourceUnavailableError } from '../src/snapshot-source';

function mockDb(records: Array<{ path: string; ts: number; data: string }>, withPathIndex = true) {
  return {
    transaction: () => ({
      objectStore: () => ({
        indexNames: { contains: (n: string) => withPathIndex && n === 'path' },
        index: () => ({ getAll: async (p: string) => records.filter(r => r.path === p) }),
        getAll: async () => records,
      }),
    }),
  };
}

function mockApp(db: unknown) {
  return {
    internalPlugins: {
      getEnabledPluginById: (id: string) => (id === 'file-recovery' ? { db } : null),
    },
  } as any;
}

describe('getSnapshots', () => {
  it('file-recovery 不可用时抛 SnapshotSourceUnavailableError', async () => {
    const app = { internalPlugins: { getEnabledPluginById: () => null } } as any;
    await expect(getSnapshots(app, 'x.md')).rejects.toBeInstanceOf(SnapshotSourceUnavailableError);
  });

  it('按时间倒序返回且合并相邻相同内容', async () => {
    const recs = [
      { path: 'a.md', ts: 300, data: 'v2' },
      { path: 'a.md', ts: 200, data: 'v2' },
      { path: 'a.md', ts: 100, data: 'v1' },
      { path: 'b.md', ts: 250, data: 'z' },
    ];
    const out = await getSnapshots(mockApp(mockDb(recs)), 'a.md');
    expect(out).toEqual([{ ts: 300, data: 'v2' }, { ts: 100, data: 'v1' }]);
  });

  it('无 path 索引时回退到全量读取再过滤', async () => {
    const recs = [{ path: 'a.md', ts: 1, data: 'x' }];
    const out = await getSnapshots(mockApp(mockDb(recs, false)), 'a.md');
    expect(out).toEqual([{ ts: 1, data: 'x' }]);
  });

  it('IndexedDB 抛错时原样向上抛出', async () => {
    const db = { transaction: () => { throw new Error('boom'); } };
    await expect(getSnapshots(mockApp(db), 'a.md')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/snapshot-source.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/snapshot-source.ts`：

```ts
import type { App } from 'obsidian';

export interface SnapshotEntry {
  ts: number;
  data: string;
}

export class SnapshotSourceUnavailableError extends Error {
  constructor() {
    super('file-recovery snapshots unavailable');
    this.name = 'SnapshotSourceUnavailableError';
  }
}

interface FileRecoveryBackup {
  path: string;
  ts: number;
  data: string;
}

export async function getSnapshots(app: App, path: string): Promise<SnapshotEntry[]> {
  const plugin = (app as any).internalPlugins?.getEnabledPluginById?.('file-recovery');
  if (!plugin?.db) throw new SnapshotSourceUnavailableError();

  // file-recovery 的 db 事务返回 Promise 化的 IDB 结果（与 Time Machine 插件相同处理）
  const tx = plugin.db.transaction('backups', 'readonly');
  const store = tx.objectStore('backups');
  let backups: FileRecoveryBackup[];
  if (store.indexNames.contains('path')) {
    backups = (await store.index('path').getAll(path)) as FileRecoveryBackup[];
  } else {
    const all = (await store.getAll()) as FileRecoveryBackup[];
    backups = all.filter(b => b.path === path);
  }

  backups.sort((a, b) => b.ts - a.ts);
  // 相邻内容相同只保留最新一条，减少选择器噪音
  const out: SnapshotEntry[] = [];
  for (const b of backups) {
    if (out.length === 0 || out[out.length - 1].data !== b.data) out.push({ ts: b.ts, data: b.data });
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/snapshot-source.ts tests/snapshot-source.test.ts
git commit -m "feat: 读取文件恢复快照（IndexedDB，带去重与降级路径）"
```

---

### Task 5: CM6 装饰渲染 + 会话进入/退出（手动验证）

**Files:**
- Create: `src/cm-extension.ts`, `src/diff-mode.ts`
- Modify: `src/main.ts`, `styles.css`

**Interfaces:**
- Consumes: Task 2/3 的 `computeHunks`、`DiffHunk`；Task 4 的 `getSnapshots`/`SnapshotEntry`/`SnapshotSourceUnavailableError`
- Produces:
  - `cm-extension.ts`：`setHunksEffect: StateEffectType<DiffHunk[] | null>`、`diffHunkField: StateField<DiffHunk[] | null>`、`diffExtension: Extension`、`readonlyCompartment: Compartment`、`READONLY_ON: Extension`、`READONLY_OFF: Extension`、`setDiffHandlers(h: { onHunkAction(id: number, action: 'keep' | 'reject'): void; onExit(): void } | null): void`
  - `diff-mode.ts`：`class DiffModeController { constructor(app: App, plugin: Plugin); enter(view: MarkdownView, baseline: SnapshotEntry): Promise<boolean>; isActive(): boolean; exit(): void }`（`keep`/`reject` 本任务先接空实现，Task 6 填充）

- [ ] **Step 1: 实现 cm-extension.ts**

```ts
import { Compartment, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view';
import type { DiffHunk } from './diff-engine';

export const setHunksEffect = StateEffect.define<DiffHunk[] | null>();

export const diffHunkField = StateField.define<DiffHunks | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHunksEffect)) return e.value;
    }
    return value;
  },
});
type DiffHunks = DiffHunk[];

type DiffHandlers = {
  onHunkAction(id: number, action: 'keep' | 'reject'): void;
  onExit(): void;
};

let handlers: DiffHandlers | null = null;
export function setDiffHandlers(h: DiffHandlers | null) {
  handlers = h;
}

class DeletedLinesWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletedLinesWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'review-edit-deleted';
    for (const line of this.text.split('\n')) {
      const div = document.createElement('div');
      div.textContent = line === '' ? '\u00A0' : line;
      wrap.appendChild(div);
    }
    return wrap;
  }
}

class ToolbarWidget extends WidgetType {
  constructor(readonly hunkId: number) {
    super();
  }
  eq(other: ToolbarWidget) {
    return other.hunkId === this.hunkId;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'review-edit-toolbar';
    const keep = document.createElement('button');
    keep.className = 'review-edit-btn keep';
    keep.textContent = '保留 ✓';
    keep.onclick = (e) => {
      e.preventDefault();
      handlers?.onHunkAction(this.hunkId, 'keep');
    };
    const reject = document.createElement('button');
    reject.className = 'review-edit-btn reject';
    reject.textContent = '撤销 ✕';
    reject.onclick = (e) => {
      e.preventDefault();
      handlers?.onHunkAction(this.hunkId, 'reject');
    };
    wrap.appendChild(keep);
    wrap.appendChild(reject);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const hunks = view.state.field(diffHunkField);
  if (!hunks) return Decoration.none;
  const doc = view.state.doc;
  const ranges = [];
  for (const h of hunks) {
    if (h.currentFrom >= doc.lines) continue; // 行号已越界，跳过防护
    const startPos = doc.line(h.currentFrom + 1).from;
    if (h.status === 'pending') {
      for (let i = h.currentFrom; i < h.currentTo && i < doc.lines; i++) {
        ranges.push(Decoration.line({ class: 'review-edit-line-added' }).range(doc.line(i + 1).from));
      }
      ranges.push(
        Decoration.widget({ widget: new ToolbarWidget(h.id), block: true, side: -1000 }).range(startPos)
      );
      if (h.baselineText !== '') {
        ranges.push(
          Decoration.widget({ widget: new DeletedLinesWidget(h.baselineText), block: true, side: -999 }).range(startPos)
        );
      }
    } else {
      for (let i = h.currentFrom; i < h.currentTo && i < doc.lines; i++) {
        ranges.push(Decoration.line({ class: 'review-edit-line-kept' }).range(doc.line(i + 1).from));
      }
    }
  }
  return Decoration.set(ranges, true);
}

export const readonlyCompartment = new Compartment();
export const READONLY_ON: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
export const READONLY_OFF: Extension = [];

export const diffExtension: Extension = [
  diffHunkField,
  EditorView.decorations.of((view) => buildDecorations(view)),
  keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        if (view.state.field(diffHunkField)) {
          handlers?.onExit();
          return true;
        }
        return false;
      },
    },
  ]),
];
```

注意：`EditorState` 需要从 `@codemirror/state` 导入（上面 READONLY_ON 用到）：把第一行导入改为 `import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';`

- [ ] **Step 2: 实现 diff-mode.ts（本任务的会话骨架）**

```ts
import type { App, MarkdownView, Plugin, TFile } from 'obsidian';
import { computeHunks, type DiffHunk } from './diff-engine';
import type { SnapshotEntry } from './snapshot-source';
import {
  READONLY_OFF,
  READONLY_ON,
  diffHunkField,
  readonlyCompartment,
  setDiffHandlers,
  setHunksEffect,
} from './cm-extension';
import type { EditorView } from '@codemirror/view';

interface Session {
  view: MarkdownView;
  file: TFile;
  baseline: SnapshotEntry;
  hunks: DiffHunk[];
}

export class DiffModeController {
  private session: Session | null = null;

  constructor(private app: App, private plugin: Plugin) {}

  isActive(): boolean {
    return this.session !== null;
  }

  async enter(view: MarkdownView, baseline: SnapshotEntry): Promise<boolean> {
    if (this.session) this.exit();
    const file = view.file;
    if (!file) return false;
    const hunks = computeHunks(baseline.data, view.editor.getValue());
    if (hunks.length === 0) return false;
    this.session = { view, file, baseline, hunks };
    setDiffHandlers({
      onHunkAction: (id, action) => (action === 'keep' ? this.keep(id) : this.reject(id)),
      onExit: () => this.exit(),
    });
    const cm = view.editor.cm as EditorView;
    cm.dispatch({
      effects: [setHunksEffect.of(hunks), readonlyCompartment.reconfigure(READONLY_ON)],
    });
    return true;
  }

  keep(_id: number): void {
    // Task 6 填充
  }

  reject(_id: number): void {
    // Task 6 填充
  }

  exit(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    setDiffHandlers(null);
    const cm = s.view.editor.cm as EditorView;
    if (cm.state.field(diffHunkField, false)) {
      cm.dispatch({
        effects: [setHunksEffect.of(null), readonlyCompartment.reconfigure(READONLY_OFF)],
      });
    }
  }
}
```

- [ ] **Step 3: main.ts 挂扩展与「与上一个快照对比」命令**

`src/main.ts` 全量替换为：

```ts
import { MarkdownView, Notice, Plugin } from 'obsidian';
import { diffExtension, readonlyCompartment } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getSnapshots, SnapshotSourceUnavailableError } from './snapshot-source';

export default class ReviewEditPlugin extends Plugin {
  diffMode!: DiffModeController;

  async onload() {
    this.diffMode = new DiffModeController(this.app, this);
    this.registerEditorExtension([diffExtension, readonlyCompartment.of([])]);

    this.addCommand({
      id: 'compare-latest-snapshot',
      name: '与上一个快照对比',
      callback: () => void this.startReview(true),
    });
  }

  private async startReview(useLatest: boolean) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice('请在笔记编辑器中使用');
      return;
    }
    let entries;
    try {
      entries = await getSnapshots(this.app, view.file.path);
    } catch (e) {
      new Notice(e instanceof SnapshotSourceUnavailableError ? '文件恢复插件未启用或快照数据库不可读' : '读取快照失败');
      return;
    }
    if (entries.length === 0) {
      new Notice('该文件没有可用的历史快照');
      return;
    }
    if (!useLatest) return; // 「与历史版本对比」在 Task 7 接入
    const current = view.editor.getValue();
    const first = entries.find(e => e.data !== current);
    if (!first) {
      new Notice('没有发现差异');
      return;
    }
    if (!(await this.diffMode.enter(view, first))) {
      new Notice('没有发现差异');
    }
  }
}
```

- [ ] **Step 4: styles.css**

```css
/* review-edit：差异行 */
.review-edit-line-added {
  background-color: rgba(46, 160, 67, 0.16);
}
.review-edit-line-kept {
  background-color: rgba(128, 128, 128, 0.10);
}
.review-edit-deleted {
  background-color: rgba(248, 81, 73, 0.14);
  color: var(--text-muted);
  font-family: var(--font-monospace);
  white-space: pre-wrap;
}
.review-edit-deleted > div {
  padding: 0 6px;
}
/* review-edit：差异块工具条 */
.review-edit-toolbar {
  display: flex;
  gap: 4px;
  padding: 2px 0;
}
.review-edit-btn {
  font-size: var(--font-ui-smaller);
  padding: 2px 10px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--background-modifier-border);
}
.review-edit-btn.keep {
  background: rgba(46, 160, 67, 0.20);
}
.review-edit-btn.reject {
  background: rgba(248, 81, 73, 0.20);
}
```

- [ ] **Step 5: 构建并安装到 MyLibrary 手动验证**

Run: `npm run build`

安装（Git Bash）：

```bash
mkdir -p "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit"
cp manifest.json main.js styles.css "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit/"
```

手动验证清单（Obsidian 中：设置 → 第三方插件 → 启用 review-edit）：

1. 先确保有快照：把 设置 → 核心插件 → 文件恢复 → 快照间隔 调到最小，编辑一篇草稿笔记改动几行，等一个间隔。
2. 再改动同一篇笔记几处，Ctrl+P 执行「与上一个快照对比」。
3. 预期：新增行绿底；删除内容以红色块出现在原位置，上方有「保留 ✓ / 撤销 ✕」按钮；编辑器无法打字（只读）。
4. 按 Esc 退出：红绿装饰消失、恢复可编辑。
5. 在实时预览模式下重复 2-3：装饰仍应正常显示（本任务不做模式切换，只验证渲染）。

- [ ] **Step 6: 提交**

```bash
git add src/cm-extension.ts src/diff-mode.ts src/main.ts styles.css
git commit -m "feat: diff 模式渲染（红绿行、删除虚拟行、只读、Esc 退出）"
```

---

### Task 6: 保留/撤销按钮接线（手动验证）

**Files:**
- Modify: `src/diff-mode.ts`（填充 `keep`/`reject`）

**Interfaces:**
- Consumes: Task 3 的 `shiftAfterReject`、`revertEditSpec`；Task 5 的会话骨架
- Produces: `keep(id: number): void`（块标记 `kept`，装饰转灰，工具条消失）、`reject(id: number): void`（用 `revertEditSpec` 替换回基准文本并平移后续块行号）

- [ ] **Step 1: 替换 diff-mode.ts 中的 keep/reject 空实现**

```ts
  keep(id: number): void {
    if (!this.session) return;
    this.session.hunks = this.session.hunks.map(h =>
      h.id === id ? { ...h, status: 'kept' as const } : h
    );
    const cm = this.session.view.editor.cm as EditorView;
    cm.dispatch({ effects: setHunksEffect.of(this.session.hunks) });
  }

  reject(id: number): void {
    if (!this.session) return;
    const cm = this.session.view.editor.cm as EditorView;
    const hunk = this.session.hunks.find(h => h.id === id);
    if (!hunk || hunk.status !== 'pending') return;
    const spec = revertEditSpec(cm.state.doc, hunk);
    this.session.hunks = shiftAfterReject(this.session.hunks, id);
    cm.dispatch({
      changes: spec,
      effects: setHunksEffect.of(this.session.hunks),
    });
  }
```

同时把导入行改为：
`import { computeHunks, revertEditSpec, shiftAfterReject, type DiffHunk } from './diff-engine';`

- [ ] **Step 2: 构建**

Run: `npm run build && npx vitest run`
Expected: 构建成功，既有单测全部 PASS（本任务逻辑已被 Task 3 单测覆盖）。

- [ ] **Step 3: 安装并手动验证**

安装命令同 Task 5 Step 5（复制三件套后，在 Obsidian 中禁用再启用 review-edit 或重启）。

手动验证清单：

1. 进入 diff 模式（同 Task 5）。
2. 点某块的「保留 ✓」：该块变灰、按钮消失，其余块不动。
3. 点另一块的「撤销 ✕」：该块当前文本被替换为红色块里的旧文本，红块消失；它后面未处理块的行号位置正确（颜色仍对准自己的行）。
4. 连续撤销多个块（含相邻块），最后 Esc 退出，检查笔记内容：被撤销的都还原了、被保留/未处理的都维持现状。
5. 撤销一个「新增块」（绿色行）：这些行被删掉。
6. 撤销一个「末尾块」：文件结尾内容正确，不多不少换行。

- [ ] **Step 4: 提交**

```bash
git add src/diff-mode.ts
git commit -m "feat: 保留/撤销按钮接线（含行号平移）"
```

---

### Task 7: 快照选择器、模式切换还原、守卫、完整命令（手动验证）

**Files:**
- Create: `src/snapshot-picker.ts`
- Modify: `src/diff-mode.ts`（模式切换与还原、外部修改守卫、视图切换守卫）
- Modify: `src/main.ts`（三条命令、ribbon、事件注册、onunload）

**Interfaces:**
- Consumes: 前序全部产物
- Produces:
  - `snapshot-picker.ts`：`class SnapshotPickerModal extends Modal { constructor(app: App, file: TFile, entries: SnapshotEntry[], onChoose: (e: SnapshotEntry) => void) }`
  - `DiffModeController` 新增公开方法：`handleVaultModify(file: TFile): void`、`handleLeafChange(): void`（由 main.ts 注册的事件调用）

- [ ] **Step 1: 实现 snapshot-picker.ts**

```ts
import type { App, TFile } from 'obsidian';
import { Modal } from 'obsidian';
import type { SnapshotEntry } from './snapshot-source';

export class SnapshotPickerModal extends Modal {
  constructor(
    app: App,
    private file: TFile,
    private entries: SnapshotEntry[],
    private onChoose: (e: SnapshotEntry) => void
  ) {
    super(app);
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: `选择 ${this.file.basename} 的对比基准` });
    const list = this.contentEl.createDiv({ cls: 'review-edit-snapshot-list' });
    for (const e of this.entries) {
      const item = list.createDiv({ cls: 'review-edit-snapshot-item' });
      const time = window.moment(e.ts);
      item.createDiv({ text: time.format('YYYY-MM-DD HH:mm:ss') });
      item.createDiv({ text: `${time.fromNow()} · ${e.data.length} 字符`, cls: 'review-edit-snapshot-meta' });
      item.onclick = () => {
        this.close();
        this.onChoose(e);
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
```

`styles.css` 追加：

```css
.review-edit-snapshot-list {
  max-height: 360px;
  overflow-y: auto;
}
.review-edit-snapshot-item {
  padding: 6px 10px;
  cursor: pointer;
}
.review-edit-snapshot-item:hover {
  background: var(--background-modifier-hover);
}
.review-edit-snapshot-meta {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
```

- [ ] **Step 2: diff-mode.ts 增加模式切换与守卫**

在 `Session` 接口加字段 `savedViewState: Record<string, unknown> | null`；`enter` 记录并切换；新增方法。改动后的相关片段（其余保持 Task 6 结果不变）：

```ts
// enter 内、computeHunks 之后：
    const savedViewState = view.getState() as Record<string, unknown>;
    await this.forceSourceSubMode(view);
    this.session = { view, file, baseline, hunks, savedViewState };
```

```ts
  private async forceSourceSubMode(view: MarkdownView) {
    // 实时预览（source: false）下装饰也能渲染，但统一切到源码模式显示最稳
    const state = view.getState() as { mode?: string; source?: boolean | null };
    if (state.mode === 'source' && state.source === false) {
      await view.setState({ ...state, source: true } as any);
    }
  }

  private async restoreMode(view: MarkdownView, saved: Record<string, unknown> | null) {
    if (saved && (saved as any).mode === 'source' && (saved as any).source === false) {
      await view.setState(saved as any);
    }
  }
```

`exit()` 末尾追加一行：`void this.restoreMode(s.view, s.savedViewState);`

新增守卫方法：

```ts
  handleVaultModify(file: TFile) {
    if (!this.session || file.path !== this.session.file.path) return;
    // 延迟检查：本插件撤销操作触发的自动保存也走 modify 事件，等它落盘后再比对
    window.setTimeout(() => void this.checkDivergence(), 400);
  }

  private async checkDivergence() {
    const s = this.session;
    if (!s) return;
    try {
      const disk = await this.app.vault.cachedRead(s.file);
      if (disk !== s.view.editor.getValue()) {
        new Notice('文件被外部修改，已退出 diff 模式');
        this.exit();
      }
    } catch {
      /* 文件已删除等情况直接忽略 */
    }
  }

  handleLeafChange() {
    const s = this.session;
    if (!s) return;
    // 同一视图打开了别的文件，旧会话的装饰已随状态重置失效
    if (!s.view.file || s.view.file.path !== s.file.path) {
      this.exit();
    }
  }
```

（需要在文件顶部导入 `Notice`。）

- [ ] **Step 3: main.ts 完整接入**

`src/main.ts` 全量替换为：

```ts
import { MarkdownView, Notice, Plugin } from 'obsidian';
import { diffExtension, readonlyCompartment } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getSnapshots, SnapshotSourceUnavailableError } from './snapshot-source';
import { SnapshotPickerModal } from './snapshot-picker';

export default class ReviewEditPlugin extends Plugin {
  diffMode!: DiffModeController;

  async onload() {
    this.diffMode = new DiffModeController(this.app, this);
    this.registerEditorExtension([diffExtension, readonlyCompartment.of([])]);

    this.registerEvent(
      this.app.vault.on('modify', f => this.diffMode.handleVaultModify(f))
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.diffMode.handleLeafChange())
    );

    this.addCommand({
      id: 'compare-snapshot',
      name: '与历史版本对比',
      callback: () => void this.startReview(false),
    });
    this.addCommand({
      id: 'compare-latest-snapshot',
      name: '与上一个快照对比',
      callback: () => void this.startReview(true),
    });
    this.addCommand({
      id: 'exit-diff-mode',
      name: '退出 diff 模式',
      callback: () => this.diffMode.exit(),
    });
    this.addRibbonIcon('git-compare', '与历史版本对比', () => void this.startReview(false));
  }

  onunload() {
    this.diffMode.exit();
  }

  private async startReview(useLatest: boolean) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice('请在笔记编辑器中使用');
      return;
    }
    if ((view.getState() as { mode?: string }).mode === 'preview') {
      new Notice('请在编辑模式（而非阅读模式）下使用');
      return;
    }
    let entries;
    try {
      entries = await getSnapshots(this.app, view.file.path);
    } catch (e) {
      new Notice(e instanceof SnapshotSourceUnavailableError ? '文件恢复插件未启用或快照数据库不可读' : '读取快照失败');
      return;
    }
    if (entries.length === 0) {
      new Notice('该文件没有可用的历史快照');
      return;
    }
    const current = view.editor.getValue();
    if (useLatest) {
      const first = entries.find(e => e.data !== current);
      if (!first) {
        new Notice('没有发现差异');
        return;
      }
      if (!(await this.diffMode.enter(view, first))) new Notice('没有发现差异');
    } else {
      new SnapshotPickerModal(this.app, view.file, entries, async e => {
        if (!(await this.diffMode.enter(view, e))) new Notice('没有发现差异');
      }).open();
    }
  }
}
```

- [ ] **Step 4: 构建**

Run: `npm run build && npx vitest run`
Expected: 构建成功、单测全过。

- [ ] **Step 5: 安装并手动验证**

安装同 Task 5 Step 5。手动验证清单：

1. 「与历史版本对比」：弹出快照列表（时间倒序、去重后），点选进入 diff 模式。
2. 实时预览下进入：自动切到源码模式；退出后回到实时预览。
3. 源码模式下进入/退出：模式不变。
4. Esc、命令「退出 diff 模式」、点 ribbon 后取消，三条路径都能正常退出。
5. diff 模式中用外部程序改同一文件并保存：约半秒后弹「文件被外部修改，已退出 diff 模式」。
6. diff 模式中点击其他笔记（同窗格切换）：会话自动清理，无报错、无残留装饰。
7. 阅读模式下执行命令：提示「请在编辑模式（而非阅读模式）下使用」。
8. 没有差异时执行「与上一个快照对比」：提示「没有发现差异」。

若第 2 步 `view.setState({ source: true })` 在当前 Obsidian 版本不生效（实时预览没切走），降级方案：装饰本身支持实时预览渲染（Task 5 已验证），删除 forceSourceSubMode/restoreMode 调用即可，功能不受影响——按此调整并在提交信息里注明。

- [ ] **Step 6: 提交**

```bash
git add src/snapshot-picker.ts src/diff-mode.ts src/main.ts styles.css
git commit -m "feat: 快照选择器、源码模式切换还原、外部修改与视图切换守卫"
```

---

### Task 8: README 与对照 spec 的收尾核查

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 全部
- Produces: 文档与最终核查结论

- [ ] **Step 1: 写 README.md**

```markdown
# Review Edit

在 Obsidian 编辑器内以 git diff 风格审查一篇笔记相对历史快照的改动，逐块「保留 ✓」或「撤销 ✕」。基于核心插件「文件恢复」的快照，不依赖 git。

## 使用

1. 确认 设置 → 核心插件 → 文件恢复 已启用（默认启用）。
2. 编辑一篇笔记（快照按设置里的间隔自动生成，默认 5 分钟）。
3. Ctrl+P 执行「与历史版本对比」选择基准时间点，或「与上一个快照对比」快速对比。
4. 绿色行 = 相对基准新增；红色块 = 相对基准删除的旧内容。
5. 「保留 ✓」维持现状；「撤销 ✕」把该块还原为旧版本。Esc 退出，未处理的改动全部保留。

## 已知限制

- 快照最快也要等一个快照间隔（默认 5 分钟），且默认只保留 7 天，可在文件恢复设置里调整。
- diff 模式期间编辑器只读；文件被外部修改时自动退出模式。
- 首次使用前如果从未编辑过该笔记，则没有快照可选。

## 开发

​```bash
npm install
npm run dev        # watch 构建
npm test           # vitest 单元测试
npm run build      # 产物 main.js

# 安装到 vault（Git Bash）
mkdir -p "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit"
cp manifest.json main.js styles.css "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit/"
​```

兼容性：依赖 file-recovery 的内部 IndexedDB 结构（社区插件 Time Machine 采用同一方式），Obsidian 大版本更新后若失效，只需适配 `src/snapshot-source.ts`。
```

（注意：README 里嵌套代码块的三个反引号按实际文件写入，不要转义字符。）

- [ ] **Step 2: 对照 spec 核查**

逐条检查 `docs/superpowers/specs/2026-08-17-review-edit-design.md`：

- §3 两条命令 + ribbon ✓（Task 7）
- §5 渲染、按钮、退出默认保留、外部修改自动退出 ✓（Task 5/6/7）
- §7 四种错误通知 + 阅读模式提示 ✓（Task 7）
- §8 测试：`npx vitest run` 全过 ✓（Task 2/3/4）
- 手动清单全部复跑一遍（Task 5/6/7 的清单）。

发现问题回修对应模块并补充提交。

- [ ] **Step 3: 最终构建与提交**

Run: `npm run build && npx vitest run`
Expected: 全部通过。

```bash
git add README.md
git commit -m "docs: README 与收尾核查"
```
