# review-edit 插件设计文档

日期：2026-08-17
状态：已与用户确认方向与关键交互

## 1. 背景与目标

用户有 8000+ 篇笔记的 Obsidian vault（多设备 + Dropbox 同步），希望像 git diff 模式一样，在 Obsidian 文本编辑器里查看一篇笔记相对某个历史版本的差异，并逐块选择「保留」或「撤销」。

核心诉求：

- 差异直接渲染在真实编辑器里（不是独立面板）。
- 逐块接受/拒绝，拒绝即把该块还原为旧版本。
- 不依赖 git（用户担心仓库体积，且当前 vault 不是 git 仓库）。

## 2. 版本基准：文件恢复快照

用 Obsidian 核心插件「文件恢复」（file-recovery）的快照作为对比基准。

- 存储位置：IndexedDB 的 `backups` 对象仓库，记录结构为 `{ path: string, ts: number, data: string }`。
- 读取方式：`app.internalPlugins.getEnabledPluginById('file-recovery')` 拿到插件实例后访问其 `db`（内部 API，无官方文档；Time Machine 插件验证了此路径可行）。
- 快照默认每 5 分钟、且文件有变化时才生成，保留期默认 7 天。这些限制对「回看一段时间内编辑」的场景足够。
- 用户当前 vault 已启用 file-recovery 但尚未积累快照，属正常现象。

## 3. 插件概览

- 插件 id / 显示名：`review-edit`
- 技术栈：TypeScript + esbuild（Obsidian 官方插件模板结构：`manifest.json`、`main.js`、`styles.css`）。
- 入口：
  - 命令「与历史版本对比」：弹出快照选择器，选中后进入 diff 模式。
  - 命令「与上一个快照对比」：跳过选择器直接用最近一个快照。
  - 侧边栏图标：等同于「与历史版本对比」。

## 4. 模块划分

| 模块 | 职责 | 依赖 |
|------|------|------|
| `snapshot-source` | 从 file-recovery 的 IndexedDB 读指定文件的全部快照，按时间倒序返回 `{ts, data}[]`；内部 API 不可用时抛出可识别错误 | obsidian 内部 API |
| `diff-engine` | 纯函数：基准文本 + 当前文本 → 差异块列表；提供撤销某块后对后续块行号的偏移修正 | `diff`（npm，Myers 行级算法） |
| `snapshot-picker` | Modal：列出快照（相对时间 + 绝对时间 + 内容长度），选中回调 | snapshot-source |
| `diff-mode` | 进入/退出 diff 模式的状态机：切换源码模式、挂载 CM6 扩展、设只读、监听外部修改、退出时还原 | cm-extension |
| `cm-extension` | CodeMirror 6 装饰：红/绿行背景、删除行虚拟行、差异块工具条（保留/撤销按钮） | @codemirror/view |

## 5. diff 模式交互设计

进入：

1. 编辑器切换到源码模式（记录进入前的模式，退出时还原）。
2. 文档设为只读（用户已确认：diff 模式期间禁止打字编辑，纯审查态）。
3. 渲染差异：
   - 当前内容相对基准新增的行：绿色背景。
   - 相对基准删除的行：以红色背景虚拟行插回原位置，旧文本按纯文本样式显示。
   - 每个差异块首行上方浮动工具条：「保留 ✓」「撤销 ✕」。

块处理：

- 保留 ✓：该块装饰转为已处理样式（灰色淡出）。
- 撤销 ✕：通过 CM6 transaction 把该块当前文本替换为基准文本；该块差异消失；diff-engine 修正后续差异块的行号偏移。

退出（Esc 或「退出 diff 模式」命令/按钮）：

- 未明确撤销的改动全部默认保留（等同接受），不弹确认框。
- 移除装饰与只读状态，还原编辑器模式。

边界规则：

- diff 模式期间文件被外部修改（vault `modify` 事件，非本插件事务）：自动退出模式并弹通知。

## 6. 数据流

命令 → snapshot-picker 查询 IndexedDB → 用户选时间点 → diff-engine(基准内容, 编辑器当前内容) → diff-mode 进入并渲染 → 用户逐块 保留/撤销（CM6 transaction + 行号偏移修正）→ 退出 → 清理。

## 7. 错误处理

| 情况 | 行为 |
|------|------|
| file-recovery 未启用或内部 API 缺失 | 通知「文件恢复插件未启用或不可读取」，命令终止 |
| 当前文件没有任何快照 | 通知「该文件没有可用的历史快照」 |
| 基准与当前内容无差异 | 通知「没有发现差异」，不进入模式 |
| 非Markdown文本文件/活动视图不是编辑器 | 通知「请在笔记编辑器中使用」 |

IndexedDB 事务的 promise 化返回值按 Time Machine 的处理方式兼容。

## 8. 测试策略

- vitest 单元测试：
  - diff-engine：差异块生成（增/删/改/移动）、撤销后行号偏移修正。
  - snapshot-source：以 mock 的内部插件对象模拟 IndexedDB 行为。
- 手动测试（开发 vault + obsidian hot-reload 插件）：
  - 进入/退出模式、编辑器模式还原、只读生效、Esc 退出。
  - 保留/撤销各类型的差异块、连续撤销多个块后行号正确。
  - 外部修改触发自动退出。
  - 实时预览用户进入 diff 模式后模式切换正确。

## 9. 非目标（第一版不做）

- git 作为基准来源（`snapshot-source` 的接口按「基准来源」抽象，未来可加 git provider）。
- 行内词级高亮。
- 左右分栏 diff 视图。
- diff 模式期间的手动编辑。
- 对 `.canvas` 等非文本文件的支持。

## 10. 项目事实记录

- 用户主 vault：`C:\Users\wenzh\Documents\MyLibrary`（约 8000 篇笔记，装了 easy-typing-obsidian、zotero-direct）。
- 另一 vault：`C:\Users\wenzh\Dropbox\Research\2024_ceo_ability_ml`。
- 两个 vault 均启用 file-recovery，均非 git 仓库。
- 插件代码仓库：`C:\Users\wenzh\Dropbox\Code\obsidian-git-diff`。

## 11. v1.1 增补（2026-08-17 实施后）

- 判等口径：忽略 CRLF/LF 行尾风格与末尾换行（`sameContent`/`normalizeText`），候选过滤与 diff 引擎共用同一判等函数。
- 选择器过滤：与当前内容相同的快照不入候选列表；「与上一个快照对比」取过滤后最近一条。
- diff 模式导航：编辑器右上/右下浮动导航条（上一处/下一处/差异 i/n/退出），只剩一处时按钮用于重新定位，进入时自动定位首个差异，全部处理完自动退出。
- 编辑器头部右上角增加「历史比对」按钮（时钟图标），点击打开快照选择器。
