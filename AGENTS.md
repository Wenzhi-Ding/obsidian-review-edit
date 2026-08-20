# obsidian-git-diff — agent rules

## 文本判等必须复用 diff-engine 的口径

- 任何「两段笔记文本是否相同/有无差异」的判断（快照过滤、去重、外部修改检测）必须复用 `src/diff-engine.ts` 的 `sameContent()` / `normalizeText()`，禁止裸 `===`/`!==` 比较——编辑器内存是 LF、磁盘/快照可能是 CRLF（Zotero 导入常见），末尾换行有无不算内容差异。
- 改动判等口径时，grep 全库调用点同步（当前调用方：`snapshot-source.filterDiffering`、`snapshot-source.dedupeAdjacent`、`snapshot-store` 的 add 去重闸门、`diff-mode` 的 divergence 检查）。

Session evidence: 2026-08-17 filterDiffering 首版裸比较与引擎归一化口径不一致，「只差尾换行」的快照进了候选列表，用户选中后报「没有发现差异」；同日 golubov 笔记 185 行全 CRLF，diff 整篇误报。

## 面向社区市场的文案

- `manifest.json` 的 `description` 只写英文（社区市场面向国际用户）。官方风格要求：≤250 字符、动词开头、句号结尾、无 emoji、不以 "This is a plugin" 起头。
- README 英文部分不混中文；中文内容集中在文末「中文说明」章节。
- 用户可见的界面文字一律放 `src/strings.ts`，新增条目同时补 zh/en 两套，不在组件里硬编码单一语言。
- `manifest.json` 任何字段改动推送到 main 后，必须 bump 版本并发新 release（`npm version patch` → 推 tag → 发布 Actions 建的 draft）——社区审核扫描的是 release 资产里的 manifest.json，不是仓库文件；只改仓库不重发，旧资产会继续被打回。

## 发版与本地验证

- 发版：`npm version patch`（version-bump.mjs 自动同步 `manifest.json`、`versions.json`）→ 推 main 和 tag（tag 名即版本号，无 `v` 前缀）→ Actions 构建 draft（资产 `main.js`/`manifest.json`/`styles.css`，含 artifact attestation）。
- 发布 draft 时必须填 release notes（面向用户的变更 + compare 链接）：Actions 建的 draft 没有 body，`gh release edit <tag> --draft=false` 要带 `--notes`；空描述会被审核提示。发布后下载资产核对 manifest 版本号——审核扫的是 release 资产，不是仓库文件。
- 社区市场经 developer dashboard（community.obsidian.md）提交仓库；初审通过后用户自动获得新 release，每个新 release 会被自动复审。
- 让用户验证前，先把构建产物复制进 vault（Git Bash）：`cp manifest.json main.js styles.css "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit/"`——Obsidian 加载的是 vault 里的文件，仓库里的构建产物用户看不到。

## 插件开发与排障

- 常驻 `Notice`（duration 0）必须三处清理：finally、下次触发前、`onunload`——任何中途失败的运行都会把它永久留在屏幕上。
- 全库扫描在个别环境出现过「扫描结束后随机瞬间整个渲染进程冻死」，未结案（2026-08-20；头号嫌疑常驻通知已移除，改按钮文本显示进度）。再遇报告：`npm run build:diag` 产出带诊断的构建（写 vault 的 `.obsidian/plugins/review-edit/rebuild.log`），复现后读日志——f 行与心跳同停＝主线程被外来任务堵死；f 行停而心跳在＝扫描 await 悬挂。
- 本机排障通道：`obsidian eval` 运行在与用户主窗口不同的窗口上下文（其 DOM 查询不代表主窗口），长任务回显丢失但仍在执行——验证执行用文件写副作用，勿以"无回显"断言未执行或冻死。
