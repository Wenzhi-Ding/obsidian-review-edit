// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DiffNav, adjustNavIndex } from '../src/diff-nav';

describe('adjustNavIndex', () => {
  it('撤销的块在当前位置之前时，索引前移一位', () => {
    expect(adjustNavIndex([5, 6, 7, 8], 6, 2)).toBe(1);
  });

  it('撤销的块在当前位置之后时，索引不变', () => {
    expect(adjustNavIndex([5, 6, 7, 8], 7, 1)).toBe(1);
  });

  it('撤销的块就是当前块时，索引停在原地并夹到最后一个', () => {
    expect(adjustNavIndex([5, 6, 7, 8], 8, 3)).toBe(2);
    expect(adjustNavIndex([5, 6, 7, 8], 5, 0)).toBe(0);
  });

  it('只剩一个待处理块并处理后，索引回到 0', () => {
    expect(adjustNavIndex([5], 5, 0)).toBe(0);
  });

  it('id 不在待处理列表时按原长度夹取', () => {
    expect(adjustNavIndex([5, 6], 99, 1)).toBe(1);
  });
});

describe('DiffNav', () => {
  function mounted() {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onExit = vi.fn();
    const nav = new DiffNav(onPrev, onNext, onExit);
    const container = createDiv();
    document.body.appendChild(container);
    nav.mount(container);
    return { nav, container, onPrev, onNext, onExit };
  }

  it('mount 在容器里加两个导航条（上/下）', () => {
    const { container } = mounted();
    const bars = container.querySelectorAll('.review-edit-nav');
    expect(bars.length).toBe(2);
    expect(container.querySelector('.review-edit-nav-top')).not.toBeNull();
    expect(container.querySelector('.review-edit-nav-bottom')).not.toBeNull();
  });

  it('每个导航条都有退出按钮且点击触发 onExit', () => {
    const { container, onExit } = mounted();
    const exits = container.querySelectorAll('.review-edit-nav-exit');
    expect(exits.length).toBe(2);
    (exits[0] as HTMLElement).click();
    (exits[1] as HTMLElement).click();
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it('update 显示「差异 i/n」并在两端禁用对应按钮', () => {
    const { nav, container } = mounted();
    nav.update(5, 0);
    const top = container.querySelector('.review-edit-nav-top')!;
    expect(top.querySelector('.review-edit-nav-count')!.textContent).toBe('差异 1/5');
    expect((top.querySelector('.review-edit-nav-btn') as HTMLButtonElement).disabled).toBe(true);
    nav.update(5, 2);
    expect(top.querySelector('.review-edit-nav-count')!.textContent).toBe('差异 3/5');
    const [prev, next] = Array.from(top.querySelectorAll<HTMLButtonElement>('.review-edit-nav-btn'));
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    nav.update(5, 4);
    expect(next.disabled).toBe(true);
  });

  it('只剩一处待处理时两个按钮都不置灰（用于重新定位）', () => {
    const { nav, container } = mounted();
    nav.update(1, 0);
    const [prev, next] = Array.from(container.querySelectorAll<HTMLButtonElement>('.review-edit-nav-bottom .review-edit-nav-btn'));
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(container.querySelector('.review-edit-nav-count')!.textContent).toBe('差异 1/1');
  });

  it('上下两个导航条内容一致', () => {
    const { nav, container } = mounted();
    nav.update(3, 1);
    const labels = Array.from(container.querySelectorAll('.review-edit-nav-count')).map(e => e.textContent);
    expect(labels).toEqual(['差异 2/3', '差异 2/3']);
  });

  it('点击按钮触发回调', () => {
    const { nav, container, onPrev, onNext } = mounted();
    nav.update(3, 1);
    const [prev, next] = Array.from(container.querySelectorAll<HTMLButtonElement>('.review-edit-nav-bottom .review-edit-nav-btn'));
    prev.click();
    expect(onPrev).toHaveBeenCalledTimes(1);
    next.click();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('unmount 移除全部导航条且可重复调用', () => {
    const { nav, container } = mounted();
    nav.unmount();
    nav.unmount();
    expect(container.querySelectorAll('.review-edit-nav').length).toBe(0);
  });
});
