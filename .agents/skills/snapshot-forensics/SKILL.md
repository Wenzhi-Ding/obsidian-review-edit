---
name: snapshot-forensics
description: "排查 review-edit 插件读取的 file-recovery 快照数据问题时使用：直接检查 Obsidian 的 IndexedDB/LevelDB 原始字节，确认快照条目的真实内容与时间线。"
---

# snapshot-forensics：file-recovery 快照取证

**何时使用**: 插件行为与用户对快照的描述不符（「明明有差异却说没有」「整篇都变了」），需要看快照数据库里到底存了什么。

**如何使用**:

1. 数据库位置：`$APPDATA/obsidian/IndexedDB/app_obsidian.md_0.indexeddb.leveldb/`。Obsidian 运行时 LOCK 被占——先整目录 `cp -r` 到临时目录再操作（LOCK 复制失败无碍，其余文件完整即可）。
2. **不要用 classic-level 等 Node 库打开**：Chromium 的 LevelDB 变体报 "Database failed to open"。直接做字节扫描。
3. 记录结构（V8/Blink 序列化）：备份记录含字段 `path`、`ts`、`data`；键名与纯 ASCII 字符串按单字节（Latin-1）存，含中文的字符串按 UTF-16LE 存，**每个字符串独立选编码**（路径 Latin-1、正文 UTF-16 是常态）。字节模式：`22 04 'path' 22 <len> <路径>` 开始一条记录；`'ts'` 后 `4E` 标记 + 8 字节小端 double 是时间戳。
4. 取证用**字节模式搜索**而非窗口解码：UTF-16 关键词要转成 `'C\0o\0l\0d\0'` 形式再搜；`subarray(任意偏移).toString('utf16le')` 受起始奇偶影响不可靠（必要时候偶偏移各解一次交叉验证）。
5. `.ldb` 块可能 snappy 压缩，明文 grep 命中率不定；`.log`（最新记录）通常未压缩。明文 grep 无命中**不能**下「不存在」结论。
6. 对照 vault 文件系统核实当前内容、换行风格与路径（文件可能被移动或有同名副本；Zotero 导入笔记常整篇 CRLF）。

Session evidence: 2026-08-17 DeFi Security「无差异」排查：三步弯路后字节扫描解出全部 6 条备份记录的时间戳与内容，确认快照序列与用户认知一致。
