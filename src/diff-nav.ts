/**
 * diff 模式的差异导航条：右上/右下两处「上一处 | 差异 i/n | 下一处」。
 * 索引只针对待处理（pending）的差异块。
 */

/**
 * 一个待处理块被保留或撤销后，修正导航索引。
 * @param pendingIdsBefore 变更前的待处理块 id 列表（按文档位置排序）
 * @param removedId 刚被处理掉的块 id
 * @param current 变更前的当前索引（0-based，指向 pendingIdsBefore）
 * @returns 新索引，已夹取到新列表范围内
 */
export function adjustNavIndex(
  pendingIdsBefore: readonly number[],
  removedId: number,
  current: number
): number {
  const pos = pendingIdsBefore.indexOf(removedId);
  if (pos === -1) {
    return Math.max(0, Math.min(current, pendingIdsBefore.length - 1));
  }
  let next = current;
  if (pos < current) next -= 1;
  return Math.max(0, Math.min(next, pendingIdsBefore.length - 2));
}

export class DiffNav {
  private bars: { root: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; count: HTMLElement }[] = [];

  constructor(private onPrev: () => void, private onNext: () => void) {}

  mount(container: HTMLElement): void {
    if (this.bars.length > 0) return;
    for (const pos of ['top', 'bottom'] as const) {
      const root = document.createElement('div');
      root.className = `review-edit-nav review-edit-nav-${pos}`;
      const prev = document.createElement('button');
      prev.className = 'review-edit-nav-btn';
      prev.textContent = '‹ 上一处';
      prev.onclick = (e) => {
        e.preventDefault();
        this.onPrev();
      };
      const count = document.createElement('span');
      count.className = 'review-edit-nav-count';
      const next = document.createElement('button');
      next.className = 'review-edit-nav-btn';
      next.textContent = '下一处 ›';
      next.onclick = (e) => {
        e.preventDefault();
        this.onNext();
      };
      root.appendChild(prev);
      root.appendChild(count);
      root.appendChild(next);
      container.appendChild(root);
      this.bars.push({ root, prev, next, count });
    }
  }

  /** @param pendingCount 待处理块总数；@param current 当前索引（0-based） */
  update(pendingCount: number, current: number): void {
    const n = Math.max(pendingCount, 1);
    const shown = Math.min(current + 1, n);
    const label = `差异 ${shown}/${n}`;
    for (const b of this.bars) {
      b.count.textContent = label;
      // 只剩一处时不置灰：点击任一按钮即重新定位到它（滚动可能已离开）
      b.prev.disabled = pendingCount > 1 && current <= 0;
      b.next.disabled = pendingCount > 1 && current >= pendingCount - 1;
    }
  }

  unmount(): void {
    for (const b of this.bars) b.root.remove();
    this.bars = [];
  }
}
