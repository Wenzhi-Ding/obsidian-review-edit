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
7. **判定 store 名/库结构时，先 grep 官方代码而不是从 leveldb 字节反推**：Obsidian 安装目录 `resources/obsidian.asar` 是明文 JS bundle，可直接字节搜索 `Zw(this.app.appId+"-backup"` 附近的 file-recovery 代码（建库、store、索引定义都在）。陷阱：数据库名是 `<appId>-backup`（如 `c764249c746a28ca-backup`），其中包含子串 `ca-backup`——grep `ca-backup` 命中的全是**数据库名**而非 store 名；store 名一直是 `backups`（带 `path`/`ts` 索引）。2026-08-20 有会话据该子串误判 store 改名并提议改插件，asar 取证证伪。
8. 运行时句柄：`app.internalPlugins.getEnabledPluginById('file-recovery')` 即插件实例，`.db.name` 返回 `<appId>-backup` 可直接确认连接目标；`forceAdd(path, content)` 绕过节流无条件立即写一条快照（经 `obsidian eval` 调用，用于外部编辑前打基线，见 note skill）。

Session evidence: 2026-08-17 DeFi Security「无差异」排查：三步弯路后字节扫描解出全部 6 条备份记录的时间戳与内容，确认快照序列与用户认知一致。2026-08-20 快照缺报关联排查：35 个文件批量外部编辑全部无快照，确认外部编辑对从未打开的文件不触发写入；同日以 asar 代码 + forceAdd 落库实验闭环验证（两个从未打开的文件 eval 后记录立即出现在 002360.log）。
