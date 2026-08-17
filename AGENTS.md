# obsidian-git-diff — agent rules

## 文本判等必须复用 diff-engine 的口径

- 任何「两段笔记文本是否相同/有无差异」的判断（快照过滤、去重、外部修改检测）必须复用 `src/diff-engine.ts` 的 `sameContent()` / `normalizeText()`，禁止裸 `===`/`!==` 比较——编辑器内存是 LF、磁盘/快照可能是 CRLF（Zotero 导入常见），末尾换行有无不算内容差异。
- 改动判等口径时，grep 全库调用点同步（当前调用方：`snapshot-source.filterDiffering`、`diff-mode` 的 divergence 检查）。

Session evidence: 2026-08-17 filterDiffering 首版裸比较与引擎归一化口径不一致，「只差尾换行」的快照进了候选列表，用户选中后报「没有发现差异」；同日 golubov 笔记 185 行全 CRLF，diff 整篇误报。
