// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DiffNav, findNavTarget } from '../src/diff-nav';

const h = (currentFrom: number, currentTo: number) => ({ currentFrom, currentTo });

describe('findNavTarget', () => {
  // 三块：A 占 10-12 行，B 占 20 行，C 占 30 行（currentTo 不含）
  const abc = [h(10, 13), h(20, 21), h(30, 31)];

  it('视口中心在全部差异上方时，下一处去第一处，上一处无处可去', () => {
    expect(findNavTarget(abc, 5, 1)).toBe(0);
    expect(findNavTarget(abc, 5, -1)).toBe(-1);
  });

  it('视口中心在全部差异下方时，上一处去最后一处，下一处无处可去', () => {
    expect(findNavTarget(abc, 35, -1)).toBe(2);
    expect(findNavTarget(abc, 35, 1)).toBe(-1);
  });

  it('视口中心在两块之间时，两个方向各取最近的一块', () => {
    expect(findNavTarget(abc, 15, 1)).toBe(1);
    expect(findNavTarget(abc, 15, -1)).toBe(0);
  });

  it('视口中心落在某块内部时该块算当前块，两个方向都跳过它', () => {
    expect(findNavTarget(abc, 11, 1)).toBe(1);
    expect(findNavTarget(abc, 11, -1)).toBe(-1);
    expect(findNavTarget(abc, 30, -1)).toBe(1);
  });

  it('视口中心正好在块首行或末行时该块仍算当前块', () => {
    expect(findNavTarget(abc, 10, 1)).toBe(1);
    expect(findNavTarget(abc, 10, -1)).toBe(-1);
    expect(findNavTarget(abc, 12, -1)).toBe(-1);
    expect(findNavTarget(abc, 20, 1)).toBe(2);
  });

  it('纯删除块（currentFrom === currentTo）位于中心时算当前块', () => {
    const withDeletion = [h(20, 21), h(25, 25), h(30, 31)];
    expect(findNavTarget(withDeletion, 25, 1)).toBe(2);
    expect(findNavTarget(withDeletion, 25, -1)).toBe(0);
  });

  it('高块占满视口、中心无法移出块内时，上一处不会停在该块', () => {
    expect(findNavTarget([h(0, 30), h(40, 41)], 15, -1)).toBe(-1);
    expect(findNavTarget([h(0, 30), h(40, 41)], 15, 1)).toBe(1);
  });

  it('只有一处差异且中心已在它上面时，两个方向都无处可去', () => {
    expect(findNavTarget([h(10, 13)], 11, 1)).toBe(-1);
    expect(findNavTarget([h(10, 13)], 11, -1)).toBe(-1);
  });

  it('没有待处理差异时返回 -1', () => {
    expect(findNavTarget([], 10, 1)).toBe(-1);
    expect(findNavTarget([], 10, -1)).toBe(-1);
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

  it('update 显示「Diff i/n」，按钮在任何位置都不置灰', () => {
    const { nav, container } = mounted();
    nav.update(5, 0);
    const top = container.querySelector('.review-edit-nav-top')!;
    expect(top.querySelector('.review-edit-nav-count')!.textContent).toBe('Diff 1/5');
    nav.update(5, 4);
    expect(top.querySelector('.review-edit-nav-count')!.textContent).toBe('Diff 5/5');
    const [prev, next] = Array.from(top.querySelectorAll<HTMLButtonElement>('.review-edit-nav-btn'));
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
  });

  it('只剩一处待处理时两个按钮同样可点击（用于重新定位）', () => {
    const { nav, container } = mounted();
    nav.update(1, 0);
    const [prev, next] = Array.from(container.querySelectorAll<HTMLButtonElement>('.review-edit-nav-bottom .review-edit-nav-btn'));
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    expect(container.querySelector('.review-edit-nav-count')!.textContent).toBe('Diff 1/1');
  });

  it('上下两个导航条内容一致', () => {
    const { nav, container } = mounted();
    nav.update(3, 1);
    const labels = Array.from(container.querySelectorAll('.review-edit-nav-count')).map(e => e.textContent);
    expect(labels).toEqual(['Diff 2/3', 'Diff 2/3']);
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
