# Review Edit

在 Obsidian 编辑器内以 git diff 风格审查一篇笔记相对历史快照的改动，逐块「保留 ✓」或「撤销 ✕」。基于核心插件「文件恢复」的快照，不依赖 git。

## 使用

1. 确认 设置 → 核心插件 → 文件恢复 已启用（默认启用）。
2. 编辑一篇笔记（快照按设置里的间隔自动生成，默认 5 分钟）。
3. 三种入口任选：编辑器右上角的「历史比对」按钮（时钟图标，在阅读模式切换按钮旁边）、左侧栏图标、或 Ctrl+P 执行「与历史版本对比」选择基准时间点（「与上一个快照对比」跳过选择直接比最近一个不同的快照）。
4. 绿色行 = 相对基准新增；红色块 = 相对基准删除的旧内容。
5. 编辑器右上角和右下角有导航条「‹ 上一处 | 差异 i/n | 下一处 ›」：n 是待处理差异块总数，点击按钮在差异块之间跳转（滚动居中），进入模式时自动定位到第一个差异块。
6. 「保留 ✓」维持现状；「撤销 ✕」把该块还原为旧版本，导航计数同步减少；全部处理完自动退出。Esc 退出，未处理的改动全部保留。

## 已知限制

- 快照最快也要等一个快照间隔（默认 5 分钟），且默认只保留 7 天，可在文件恢复设置里调整。
- diff 模式期间编辑器只读；文件被外部修改时自动退出模式。
- 首次使用前如果从未编辑过该笔记，则没有快照可选。

## 开发

```bash
npm install
npm run dev        # watch 构建
npm test           # vitest 单元测试
npm run build      # 产物 main.js

# 安装到 vault（Git Bash）
mkdir -p "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit"
cp manifest.json main.js styles.css "/c/Users/wenzh/Documents/MyLibrary/.obsidian/plugins/review-edit/"
```

兼容性：依赖 file-recovery 的内部 IndexedDB 结构（社区插件 Time Machine 采用同一方式），Obsidian 大版本更新后若失效，只需适配 `src/snapshot-source.ts`。
