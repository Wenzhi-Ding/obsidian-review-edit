# 自建快照系统设计（own snapshot system）

日期：2026-08-20
状态：设计已口头确认，待 spec 评审
规模：架构级（新增子系统，约 750 行）

## 背景与动机

review-edit 目前的唯一数据源是 Obsidian file-recovery 核心插件的快照库。它有两个盲区：

1. **外部编辑对从未在编辑器打开过的文件不产生快照**。2026-08-20 的排查确认：35 个文件经脚本批量外部编辑后，file-recovery 全部没有写入快照，改前内容无法找回，review-edit 报「没有快照/没有差异」。当前的补偿方案是让 agent 在外部编辑前用 `obsidian eval` 调 `forceAdd` 手动打基线（见 note skill），这只对本机有效，社区用户无从得知。
2. **硬依赖**：file-recovery 被禁用时插件直接不可用（`SnapshotSourceUnavailableError`）。

目标：插件自带一套快照系统，用户安装后零配置、零前置操作，任何来源的编辑（编辑器内、外部脚本）发生前，改前状态已经在插件自己的库里；file-recovery 降级为可选补充源。

## 可行性实验（2026-08-20，本机 vault，8205 个 md）

在 Obsidian 运行时注册 `vault.on('modify' | 'create' | 'delete' | 'rename')` 监听并外部操作文件，结论：

- 对从未打开的文件做**原位外部修改**（追加写入），`modify` 秒级触发；
- 对已存在文件做**原子重命名式写入**（临时文件 rename 覆盖目标，Write 工具的写法），目标文件的 `modify` 触发；
- 新建文件只触发 `create`（新建没有改前内容，无需快照）；删除触发 `delete`；
- 即：8 月 20 日 35 个文件没快照的原因在 file-recovery 自己的写入逻辑，**不在事件层**。插件直接监听 vault 事件即可看到全部编辑来源。
- 插件往 `.obsidian/` 下写文件不会触发 vault 事件（vault 索引不包含 `.obsidian`），自建库的写入不会自触发监听器。

## 目标 / 非目标

**目标**

- 任何编辑发生前，改前内容已在自建库中（编辑器内编辑、外部编辑、Obsidian 运行中的全部场景）。
- file-recovery 降为补充源，禁用不阻塞任何功能。
- 写入放大可控：每文件每次编辑会话最多写两条快照。
- 判等口径复用 `sameContent()`（AGENTS.md 规则）。

**非目标**

- 会话内高频中间版本（file-recovery 已覆盖打开的文件；YAGNI）。
- 非 markdown 文件、云同步、快照导出。
- 拦截 Obsidian 关闭期间的外部编辑（物理不可能）。

## 总体结构

```
main.ts ──挂载──> SnapshotRecorder（新）──写入──> SnapshotStore（新，IndexedDB）
   │                                              │
   │ startReview                                  │ getEntries(path)
   └──> snapshot-source.getMergedSnapshots <──────┘
              └──> file-recovery 源（现有，降级为补充）
```

- `src/snapshot-store.ts`：IndexedDB 封装，无 Obsidian 依赖，接口化便于测试。
- `src/snapshot-recorder.ts`：监听 vault 事件，实现会话边界算法，持有内存缓存与计时器。
- `src/settings.ts`：设置面板。
- `src/snapshot-source.ts`：新增 `getMergedSnapshots()` 合并两源。
- `src/strings.ts`：新增文案（zh/en 两套）。

## 采集算法（SnapshotRecorder）

**状态**（全部内存，重启即清）：

- `lastModifyTs: Map<path, number>` — 该文件最近一次 modify 事件时间；
- `lastKnown: Map<path, string>` — 该文件最近一次 modify 时的内容（只缓存本会话被改过的文件，几百个文件约几 MB，不做全库缓存）；
- `endTimers: Map<path, timeoutId>` — 会话结束计时器；
- `ops: Map<path, Promise>` — 同一文件的操作串行化，避免读写竞态。

**onModify(file)**（`TFile` 且 `extension === 'md'`，否则忽略）：

1. `now = Date.now()`；`prev = lastModifyTs.get(path)`；写回 `lastModifyTs`。
2. 重设会话结束计时器：清旧的，`setTimeout(thresholdMs)` 到期执行 onBurstEnd(path)。
3. **会话边界判定**：`prev === undefined || now - prev >= thresholdMs` 视为新会话开始：
   - 改前内容 = `lastKnown.get(path)`，取不到（重启后首改）则 `await store.getLatest(path)?.data`；
   - `store.add(path, now, 改前内容)`（add 内部有去重闸门，见下）。
4. 读当前内容 `await vault.read(file)`，更新 `lastKnown`。读失败（文件已删等）捕获后跳过。

**onBurstEnd(path)**：静默满阈值，`store.add(path, Date.now(), lastKnown.get(path))`。不清 `lastModifyTs`：下次 modify 按旧时间戳判定为会话开始，会把 burst-end 内容再走一次 add，去重闸门挡掉，行为自洽。

**onCreate(file)**（md）：`store.add(path, now, await vault.read(file))`——给「agent 新建文件后继续编辑」的场景一个 v1 锚点。

**onRename(file, oldPath)**：`store.migratePath(oldPath, file.path)`，同步迁移内存 map 的键。file-recovery 不迁移快照（note skill「先 mv 再打基线」规则的成因），自建库修掉这个问题。

**onDelete**：不清理记录（保留给「文件恢复后仍有历史」的场景），由保留期统一淘汰。

**onunload（dispose）**：清全部计时器；对 `lastKnown` 中每项发起 `store.add` 但不 await（IndexedDB 是异步事务，退出前已发起的事务大概率能提交，尽力而为）；关闭数据库。

**去重闸门**：`store.add(path, ts, data)` 内部先取该路径最新一条，`sameContent(data, latest.data)` 为真则跳过写入。直接规避 file-recovery「路径变动也落快照」的噪音（`snapshot-source.ts:69-71` 注释记录的同类问题）。

## 存储设计（SnapshotStore）

- 数据库：IndexedDB，名 `review-edit-snapshots`，version 1。
- objectStore `snapshots`：keyPath `id`（autoIncrement）；记录 `{id, path, ts, data}`；索引 `path`（按路径取历史）、`ts`（按时间淘汰）。
- 不用插件目录散文件方案的原因：IDB 有事务保证（崩溃不写坏索引）、path 直接做索引（无需文件名编码）、与 file-recovery 同机制且已在本机规模（8205 文件）验证。代价是用户不能直接翻文件夹，用设置面板的清除按钮补偿。
- 数据只在本机浏览器的 IndexedDB 里，不出机器。

**接口**：

```ts
interface SnapshotStoreLike {
  getLatest(path: string): Promise<SnapshotEntry | null>;
  getEntries(path: string): Promise<SnapshotEntry[]>;
  add(path: string, ts: number, data: string): Promise<boolean>; // 是否真的写入（去重闸门）
  migratePath(oldPath: string, newPath: string): Promise<void>;
  pruneRetention(keepDays: number): Promise<number>;             // 返回删除条数
  purge(): Promise<void>;
  close(): void;
}
```

`open()` 失败（IDB 不可用/配额）时：Notice 提示一次，自建快照停用，file-recovery 补充源与插件其余功能不受影响。

## 快照源合并（snapshot-source.ts）

新增：

```ts
export async function getMergedSnapshots(
  app: App, path: string, store: SnapshotStoreLike | null
): Promise<SnapshotEntry[]>
```

- 自建库：`store.getEntries(path)`，失败 → 空数组 + Notice 一次；
- file-recovery：现有 `getSnapshots` 的读取逻辑，`SnapshotSourceUnavailableError` → 空数组（静默降级）；
- 合并后按 `ts` 降序，用现有「相邻内容相同只保留最新」逻辑去重（从 `getSnapshots` 里抽成 `dedupeAdjacent()` 复用）；
- **两源都失败**才抛 `SnapshotSourceUnavailableError`；自建库可用时永不因 file-recovery 缺失而报错。
- `main.ts` 的 `startReview` 改调 `getMergedSnapshots`；`SnapshotEntry` 结构不变，选择器与 diff 模式零改动。

## 基线扫描

- 触发：`onLayoutReady` 后，若 `ownSnapshotsEnabled && !baselined` 自动后台执行。
- 流程：遍历 `vault.getMarkdownFiles()`，每批 200 个，批间 `setTimeout(0)` 让出主线程；每文件 `vault.cachedRead` 后 `store.add(path, now, content)`——首跑全量写入，重跑经去重闸门自动增量（内容没变即跳过），「重建基线」按钮复用同一段代码。
- 完成：写 `baselined = true` 并 saveData，Notice 报告写入条数。预计本机 8205 文件 1–2 分钟。
- 中途被关闭开关：每批开始检查开关，关了就中止。

## 设置

```ts
interface ReviewEditSettings {
  ownSnapshotsEnabled: boolean;      // 默认 true
  burstThresholdMinutes: number;     // 默认 1（即 60 秒），范围 1–60
  retentionDays: number;             // 默认 30，范围 1–365
  baselined: boolean;                // 默认 false
}
```

经 `plugin.loadData/saveData` 存 `data.json`。面板项：开关、阈值、保留天数、「重建基线」按钮、「清除全部快照」按钮（带确认 Modal，调 `store.purge()`）。

开关与阈值在运行中切换立即生效：关闭即 dispose recorder（清计时器、尽力 flush），重新开启即重新挂载（`baselined` 已为 true 则不重跑基线）；阈值取当下值，不追溯已设的计时器。

**保留期清理**：启动后与每 24 小时（`registerInterval`）执行 `pruneRetention(retentionDays)`，删除 `ts` 早于截止时间的记录。

## 边界与已知限制（设计接受）

- **Obsidian 关闭期间的外部编辑**无法拦截：基线退化为上次会话的记录，差异仍可审，只是基线旧一点。
- **退出时的尾随编辑**：静默未满阈值的最后一段编辑（≤ 阈值，默认 60 秒）的会话结束快照可能没写进库；dispose 尽力发起写入但不保证完成。file-recovery 的同类缺口是 5 分钟，本设计更小。
- **移动端**：manifest 维持 `isDesktopOnly: false`，IDB 在移动端渲染器可用，但不做专门测试，按尽力而为处理；file-recovery 源在移动端不存在（现有守卫已覆盖）。

## 测试计划（vitest）

- `snapshot-recorder.test.ts`：注入假 store（内存实现 `SnapshotStoreLike`）+ 假时钟（`vi.useFakeTimers`）+ 假 vault.read（队列返回内容）。用例：会话开始写改前内容；静默满阈值写改后内容；阈值内连续 modify 不额外写；去重闸门（内容与最新条相同不写）；create 写初始条；rename 迁移；非 md 忽略；vault.read 失败吞掉；dispose 清计时器并尽力 flush。
- `snapshot-store.test.ts`：新增 devDependency `fake-indexeddb`，测 add/getLatest/getEntries/migratePath/pruneRetention/purge 及去重闸门。
- `snapshot-source.test.ts`（扩展）：合并去重、file-recovery 不可用降级、两源都不可用抛错。
- `strings.test.ts`（扩展）：新键在 zh/en 两套齐全。
- 端到端手动验证一次：沿用 2026-08-20 的实验方法（外部新建、原位追加、原子重命名覆盖，核对库内记录）。

## 文件清单

| 文件 | 动作 | 约行数 |
|---|---|---|
| `src/snapshot-store.ts` | 新增 | 150 |
| `src/snapshot-recorder.ts` | 新增 | 180 |
| `src/settings.ts` | 新增 | 100 |
| `src/snapshot-source.ts` | 改（合并 + 抽 dedupeAdjacent） | +40 |
| `src/main.ts` | 改（挂载 recorder/store/设置） | +30 |
| `src/strings.ts` | 改（新键 zh/en） | +30 |
| `tests/` 三个新测试 + 两个扩展 | 新增/改 | 250 |
| `README.md` | 改（自建快照说明 + 隐私声明） | — |

## 文案与发版

- 新增 strings 键（zh/en）：设置区标题、开关、阈值、保留天数、重建基线、清除快照（含确认弹窗四条）、基线完成 Notice（含条数）、自建库打开失败 Notice、清除完成 Notice。
- `manifest.json` 的 `description` 去掉对 File Recovery 的依赖表述，草案：`Review note changes as an inline diff and keep or revert each hunk, with automatic snapshots taken before every edit.`（英文、动词开头、句号结尾、≤250 字符，符合 AGENTS.md 规则）。
- 功能新增，发版走 `npm version minor`（1.1.0），按 AGENTS.md 流程推 main + tag、发布 draft 时填 release notes、发布后核对资产。
- README 英文正文新增自建快照一节（含「数据只存本机、可一键清除」的隐私说明），中文说明放文末中文章节。
