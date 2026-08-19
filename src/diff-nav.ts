/**
 * diff 模式的差异导航条：右上/右下两处「上一处 | 差异 i/n | 下一处」。
 * 索引只针对待处理（pending）的差异块。
 */
import { uiStrings } from './strings';

/**
 * 以视口中心为基准，在待处理块中找导航目标。
 * 中心落在某块范围内时该块算「当前块」，两个方向都跳过它。
 * @param pending 待处理块（按文档位置排序；currentTo 为不含的结束行）
 * @param centerLine 视口中心所在的 0-based 行号
 * @param dir 导航方向：1 为下一处，-1 为上一处
 * @returns 目标块在 pending 中的索引；该方向没有差异时返回 -1
 */
export function findNavTarget(
  pending: readonly { currentFrom: number; currentTo: number }[],
  centerLine: number,
  dir: -1 | 1
): number {
  if (dir === 1) {
    return pending.findIndex(h => h.currentFrom > centerLine);
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    // 纯删除块（from === to）不占行，按所在行参与比较
    const lastLine = Math.max(pending[i].currentFrom, pending[i].currentTo - 1);
    if (lastLine < centerLine) return i;
  }
  return -1;
}

export class DiffNav {
  private bars: { root: HTMLElement; prev: HTMLButtonElement; next: HTMLButtonElement; exit: HTMLButtonElement; count: HTMLElement }[] = [];

  constructor(private onPrev: () => void, private onNext: () => void, private onExit: () => void) {}

  mount(container: HTMLElement): void {
    if (this.bars.length > 0) return;
    for (const pos of ['top', 'bottom'] as const) {
      const t = uiStrings();
      const root = createDiv({ cls: `review-edit-nav review-edit-nav-${pos}` });
      const prev = createEl('button', { cls: 'review-edit-nav-btn', text: t.navPrev });
      prev.onclick = (e) => {
        e.preventDefault();
        this.onPrev();
      };
      const count = createSpan({ cls: 'review-edit-nav-count' });
      const next = createEl('button', { cls: 'review-edit-nav-btn', text: t.navNext });
      next.onclick = (e) => {
        e.preventDefault();
        this.onNext();
      };
      const exit = createEl('button', { cls: 'review-edit-nav-btn review-edit-nav-exit', text: t.navExit });
      exit.setAttribute('aria-label', t.navExitAria);
      exit.onclick = (e) => {
        e.preventDefault();
        this.onExit();
      };
      root.appendChild(prev);
      root.appendChild(count);
      root.appendChild(next);
      root.appendChild(exit);
      container.appendChild(root);
      this.bars.push({ root, prev, next, exit, count });
    }
  }

  /** @param pendingCount 待处理块总数；@param current 计数显示用的当前索引（0-based） */
  update(pendingCount: number, current: number): void {
    const n = Math.max(pendingCount, 1);
    const shown = Math.min(current + 1, n);
    const label = uiStrings().navCount(shown, n);
    // 按钮永不置灰：目标以视口位置为准，任何位置点击都可能重新定位
    for (const b of this.bars) {
      b.count.textContent = label;
    }
  }

  unmount(): void {
    for (const b of this.bars) b.root.remove();
    this.bars = [];
  }
}
