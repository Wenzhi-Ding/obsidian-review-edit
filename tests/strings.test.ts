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
