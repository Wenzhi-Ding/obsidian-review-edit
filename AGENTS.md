# obsidian-git-diff — agent rules

## 文本判等必须复用 diff-engine 的口径

- 任何「两段笔记文本是否相同/有无差异」的判断（快照过滤、去重、外部修改检测）必须复用 `src/diff-engine.ts` 的 `sameContent()` / `normalizeText()`，禁止裸 `===`/`!==` 比较——编辑器内存是 LF、磁盘/快照可能是 CRLF（Zotero 导入常见），末尾换行有无不算内容差异。
- 改动判等口径时，grep 全库调用点同步（当前调用方：`snapshot-source.filterDiffering`、`diff-mode` 的 divergence 检查）。

Session evidence: 2026-08-17 filterDiffering 首版裸比较与引擎归一化口径不一致，「只差尾换行」的快照进了候选列表，用户选中后报「没有发现差异」；同日 golubov 笔记 185 行全 CRLF，diff 整篇误报。

## 面向社区市场的文案

- `manifest.json` 的 `description` 只写英文（社区市场面向国际用户）。官方风格要求：≤250 字符、动词开头、句号结尾、无 emoji、不以 "This is a plugin" 起头。
- README 英文部分不混中文；中文内容集中在文末「中文说明」章节。
- 用户可见的界面文字一律放 `src/strings.ts`，新增条目同时补 zh/en 两套，不在组件里硬编码单一语言。
- `manifest.json` 任何字段改动推送到 main 后，必须 bump 版本并发新 release（`npm version patch` → 推 tag → 发布 Actions 建的 draft）——社区审核扫描的是 release 资产里的 manifest.json，不是仓库文件；只改仓库不重发，旧资产会继续被打回。
