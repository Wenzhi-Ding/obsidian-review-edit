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
  /** 选择器里区分快照来源的徽标 */
  pickerSourceOwn: string;
  pickerSourceFileRecovery: string;
  /** —— 自动快照（设置页 + 通知） —— */
  settingsOwnSnapshotsSection: string;
  settingOwnSnapshotsName: string;
  settingOwnSnapshotsDesc: string;
  settingThresholdName: string;
  settingThresholdDesc: string;
  settingRetentionName: string;
  settingRetentionDesc: string;
  /** 声明式设置 number 控件的行内校验错误（1.13+） */
  settingThresholdInvalid: string;
  settingRetentionInvalid: string;
  settingBaselineName: string;
  settingBaselineDesc: string;
  settingPurgeName: string;
  settingPurgeDesc: string;
  confirmPurgeTitle: string;
  confirmPurgeBody: string;
  confirmPurgeConfirm: string;
  confirmPurgeCancel: string;
  noticeBaselineDone: (count: number) => string;
  noticeBaselineProgress: (done: number, total: number) => string;
  noticeStoreOpenFailed: string;
  noticePurgeDone: string;
  noticeOwnStoreReadFailed: string;
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
  pickerSourceOwn: 'Review Edit 自动快照',
  pickerSourceFileRecovery: 'Obsidian 文件恢复',
  settingsOwnSnapshotsSection: '自动快照',
  settingOwnSnapshotsName: '启用自动快照',
  settingOwnSnapshotsDesc: '在每次编辑会话开始前自动保存笔记快照，供历史比对使用。快照只存储在本机，不上传。',
  settingThresholdName: '会话边界阈值（分钟）',
  settingThresholdDesc: '两次编辑的间隔超过该时长视为新的编辑会话，会话开始前的内容会被自动快照。范围 1–60。',
  settingRetentionName: '快照保留天数',
  settingRetentionDesc: '更早的自动快照会被自动清理。范围 1–365。',
  settingThresholdInvalid: '请输入 1–60 之间的整数。',
  settingRetentionInvalid: '请输入 1–365 之间的整数。',
  settingBaselineName: '重建快照',
  settingBaselineDesc: '为所有笔记写入当前内容的快照（内容未变化的自动跳过）。',
  settingPurgeName: '清除全部自动快照',
  settingPurgeDesc: '删除本插件保存的全部快照，操作不可恢复。',
  confirmPurgeTitle: '清除全部自动快照',
  confirmPurgeBody: '将删除本插件保存的全部快照，该操作不可恢复。确定继续吗？',
  confirmPurgeConfirm: '清除',
  confirmPurgeCancel: '取消',
  noticeBaselineDone: count => `重建快照完成：写入 ${count} 条`,
  noticeBaselineProgress: (done, total) => `正在重建快照：${done}/${total}`,
  noticeStoreOpenFailed: '自动快照库打开失败，自动快照已停用',
  noticePurgeDone: '已清除全部自动快照',
  noticeOwnStoreReadFailed: '读取自动快照失败，本次仅使用文件恢复的快照',
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
  pickerSourceOwn: 'Review Edit snapshot',
  pickerSourceFileRecovery: 'Obsidian File Recovery',
  settingsOwnSnapshotsSection: 'Automatic snapshots',
  settingOwnSnapshotsName: 'Enable automatic snapshots',
  settingOwnSnapshotsDesc:
    'Automatically snapshot notes before each editing session for later comparison. Snapshots never leave this device.',
  settingThresholdName: 'Session boundary threshold (minutes)',
  settingThresholdDesc:
    'A gap longer than this between edits starts a new session; the pre-session content is snapshotted. Range 1–60.',
  settingRetentionName: 'Snapshot retention (days)',
  settingRetentionDesc: 'Older automatic snapshots are pruned automatically. Range 1–365.',
  settingThresholdInvalid: 'Enter a whole number between 1 and 60.',
  settingRetentionInvalid: 'Enter a whole number between 1 and 365.',
  settingBaselineName: 'Rebuild snapshots',
  settingBaselineDesc: 'Snapshot the current content of all notes (unchanged notes are skipped).',
  settingPurgeName: 'Purge all automatic snapshots',
  settingPurgeDesc: 'Delete every snapshot stored by this plugin. This cannot be undone.',
  confirmPurgeTitle: 'Purge all automatic snapshots',
  confirmPurgeBody: 'All snapshots stored by this plugin will be deleted. This cannot be undone. Continue?',
  confirmPurgeConfirm: 'Purge',
  confirmPurgeCancel: 'Cancel',
  noticeBaselineDone: count => `Snapshot rebuild complete: ${count} snapshots written`,
  noticeBaselineProgress: (done, total) => `Rebuilding snapshots: ${done}/${total}`,
  noticeStoreOpenFailed: 'Failed to open the snapshot store; automatic snapshots are disabled',
  noticePurgeDone: 'All automatic snapshots purged',
  noticeOwnStoreReadFailed: 'Failed to read automatic snapshots; using File Recovery snapshots only',
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
