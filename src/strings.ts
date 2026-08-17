/**
 * 用户可见文案的唯一来源：中文环境用中文，其余语言一律英文。
 * 语言判定跟随 Obsidian 界面语言（moment.locale()，如 'zh-cn'、'zh-tw'、'en'）。
 */

export interface UiStrings {
  /** 命令面板：选择基准快照比对 */
  commandCompareHistory: string;
  /** 命令面板：直接比最近一个不同的快照 */
  commandComparePrevious: string;
  commandExitDiffMode: string;
  noticeNeedEditor: string;
  noticeNeedSourceMode: string;
  noticeSnapshotSourceUnavailable: string;
  noticeReadSnapshotsFailed: string;
  noticeNoSnapshots: string;
  noticeNoDifferences: string;
  noticeEnterDiffFailed: string;
  noticeNoMoreDifferences: string;
  noticeFileChangedExternally: string;
  navPrev: string;
  navNext: string;
  navExit: string;
  navExitAria: string;
  navCount: (shown: number, total: number) => string;
  keepButton: string;
  revertButton: string;
  pickerTitle: (basename: string) => string;
  pickerCharCount: (chars: number) => string;
}

const zh: UiStrings = {
  commandCompareHistory: '与历史版本对比',
  commandComparePrevious: '与上一个快照对比',
  commandExitDiffMode: '退出 diff 模式',
  noticeNeedEditor: '请在笔记编辑器中使用',
  noticeNeedSourceMode: '请在编辑模式（而非阅读模式）下使用',
  noticeSnapshotSourceUnavailable: '文件恢复插件未启用或快照数据库不可读',
  noticeReadSnapshotsFailed: '读取快照失败',
  noticeNoSnapshots: '该文件没有可用的历史快照',
  noticeNoDifferences: '没有发现差异',
  noticeEnterDiffFailed: '进入 diff 模式失败',
  noticeNoMoreDifferences: '没有更多差异，已退出 diff 模式',
  noticeFileChangedExternally: '文件被外部修改，已退出 diff 模式',
  navPrev: '‹ 上一处',
  navNext: '下一处 ›',
  navExit: '退出',
  navExitAria: '退出 diff 模式（未处理的改动全部保留）',
  navCount: (shown, total) => `差异 ${shown}/${total}`,
  keepButton: '保留 ✓',
  revertButton: '撤销 ✕',
  pickerTitle: basename => `选择 ${basename} 的对比基准`,
  pickerCharCount: chars => `${chars} 字符`,
};

const en: UiStrings = {
  commandCompareHistory: 'Compare with an earlier snapshot',
  commandComparePrevious: 'Compare with the previous snapshot',
  commandExitDiffMode: 'Exit diff mode',
  noticeNeedEditor: 'Please use this in a note editor',
  noticeNeedSourceMode: 'Please switch to editing view (not reading view)',
  noticeSnapshotSourceUnavailable: 'File Recovery is disabled or its snapshot database is unreadable',
  noticeReadSnapshotsFailed: 'Failed to read snapshots',
  noticeNoSnapshots: 'No snapshots available for this file',
  noticeNoDifferences: 'No differences found',
  noticeEnterDiffFailed: 'Failed to enter diff mode',
  noticeNoMoreDifferences: 'No pending changes left — exited diff mode',
  noticeFileChangedExternally: 'File was modified externally — exited diff mode',
  navPrev: '‹ Prev',
  navNext: 'Next ›',
  navExit: 'Exit',
  navExitAria: 'Exit diff mode (keeps all unhandled changes)',
  navCount: (shown, total) => `Diff ${shown}/${total}`,
  keepButton: 'Keep ✓',
  revertButton: 'Revert ✕',
  pickerTitle: basename => `Choose a baseline for ${basename}`,
  pickerCharCount: chars => `${chars} chars`,
};

export function stringsForLocale(locale: string): UiStrings {
  return locale.toLowerCase().startsWith('zh') ? zh : en;
}

/**
 * 取当前界面文案。moment 是 Obsidian 注入的全局；测试等无该全局的环境回退英文。
 * 每次渲染调用即可，语言切换伴随应用重载，无需缓存失效处理。
 */
export function uiStrings(): UiStrings {
  const locale = typeof window !== 'undefined' && window.moment ? window.moment.locale() : 'en';
  return stringsForLocale(locale);
}
