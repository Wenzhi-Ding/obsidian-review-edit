// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { stringsForLocale, uiStrings } from '../src/strings';

describe('stringsForLocale', () => {
  it('zh 开头的 locale 用中文文案', () => {
    expect(stringsForLocale('zh-cn').navCount(1, 5)).toBe('差异 1/5');
    expect(stringsForLocale('zh-TW').keepButton).toBe('保留 ✓');
  });

  it('其余 locale 一律英文', () => {
    expect(stringsForLocale('en').navCount(1, 5)).toBe('Diff 1/5');
    expect(stringsForLocale('de').keepButton).toBe('Keep ✓');
  });
});

describe('uiStrings', () => {
  // window.moment 是 Obsidian 运行时注入的；jsdom 里手工挂/摘来模拟两种环境
  const w = window as unknown as { moment?: { locale(): string } };

  afterEach(() => {
    delete w.moment;
  });

  it('moment.locale 为中文时用中文', () => {
    w.moment = { locale: () => 'zh-cn' };
    expect(uiStrings().navCount(1, 5)).toBe('差异 1/5');
  });

  it('moment.locale 非中文时用英文', () => {
    w.moment = { locale: () => 'fr' };
    expect(uiStrings().navCount(1, 5)).toBe('Diff 1/5');
  });

  it('无 moment 环境（测试/未注入）回退英文', () => {
    expect(uiStrings().navCount(1, 5)).toBe('Diff 1/5');
  });
});

describe('自动快照设置文案', () => {
  const NEW_KEYS = [
    'settingsOwnSnapshotsSection',
    'settingOwnSnapshotsName',
    'settingOwnSnapshotsDesc',
    'settingThresholdName',
    'settingThresholdDesc',
    'settingRetentionName',
    'settingRetentionDesc',
    'settingBaselineName',
    'settingBaselineDesc',
    'settingPurgeName',
    'settingPurgeDesc',
    'confirmPurgeTitle',
    'confirmPurgeBody',
    'confirmPurgeConfirm',
    'confirmPurgeCancel',
    'noticeStoreOpenFailed',
    'noticePurgeDone',
    'noticeOwnStoreReadFailed',
  ] as const;

  it('新键在 zh/en 两套里都是非空字符串', () => {
    const zh = stringsForLocale('zh-cn') as unknown as Record<string, unknown>;
    const en = stringsForLocale('en') as unknown as Record<string, unknown>;
    for (const k of NEW_KEYS) {
      expect(typeof zh[k]).toBe('string');
      expect((zh[k] as string).length).toBeGreaterThan(0);
      expect(typeof en[k]).toBe('string');
      expect((en[k] as string).length).toBeGreaterThan(0);
    }
  });

  it('noticeBaselineDone 带条数插值', () => {
    expect(stringsForLocale('zh-cn').noticeBaselineDone(42)).toBe('重建快照完成：写入 42 条');
    expect(stringsForLocale('en').noticeBaselineDone(42)).toBe('Snapshot rebuild complete: 42 snapshots written');
  });

  it('noticeBaselineProgress 带进度插值', () => {
    expect(stringsForLocale('zh-cn').noticeBaselineProgress(3, 10)).toBe('正在重建快照：3/10');
    expect(stringsForLocale('en').noticeBaselineProgress(3, 10)).toBe('Rebuilding snapshots: 3/10');
  });
});
