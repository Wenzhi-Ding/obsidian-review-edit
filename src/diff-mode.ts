import type { App, Editor, MarkdownView, Plugin, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { computeHunks, revertEditSpec, sameContent, shiftAfterReject, type DiffHunk } from './diff-engine';
import { DiffNav, findNavTarget } from './diff-nav';
import { uiStrings } from './strings';
import type { SnapshotEntry } from './snapshot-source';
import {
  READONLY_OFF,
  READONLY_ON,
  diffHunkField,
  readonlyCompartment,
  setDiffHandlers,
  setHunksEffect,
} from './cm-extension';

interface Session {
  view: MarkdownView;
  file: TFile;
  baseline: SnapshotEntry;
  hunks: DiffHunk[];
  savedViewState: Record<string, unknown> | null;
  /** enter 时的 CM 实例；与当前不一致则会话已失效 */
  cm: EditorView;
  /** 差异导航条 */
  nav: DiffNav;
  /** 计数显示用的索引（最近跳转到的待处理块）；导航目标以视口位置为准，不依赖它 */
  navIndex: number;
}

/** editor.cm 是公开的运行时属性但类型包未声明，这里集中做一次非 any 的取值 */
function cmOf(view: MarkdownView): EditorView | undefined {
  return (view.editor as Editor & { cm?: EditorView }).cm;
}

/** 视口中心所在的 0-based 行号 */
function viewportCenterLine(cm: EditorView): number {
  const y = cm.scrollDOM.scrollTop + cm.scrollDOM.clientHeight / 2;
  const pos = cm.lineBlockAtHeight(y).from;
  return cm.state.doc.lineAt(pos).number - 1;
}

export class DiffModeController {
  private session: Session | null = null;

  constructor(private app: App, private plugin: Plugin) {}

  isActive(): boolean {
    return this.session !== null;
  }

  async enter(view: MarkdownView, baseline: SnapshotEntry): Promise<boolean> {
    if (this.session) this.exit();
    const file = view.file;
    if (!file) return false;
    const hunks = computeHunks(baseline.data, view.editor.getValue());
    if (hunks.length === 0) return false;
    const savedViewState = view.getState();
    await this.forceSourceSubMode(view);
    const cm = cmOf(view);
    if (!cm) return false;
    const nav = new DiffNav(() => this.stepNav(-1), () => this.stepNav(1), () => this.exit());
    nav.mount(cm.dom);
    this.session = { view, file, baseline, hunks, savedViewState, cm, nav, navIndex: 0 };
    setDiffHandlers({
      onHunkAction: (id, action) => (action === 'keep' ? this.keep(id) : this.reject(id)),
      onExit: () => this.exit(),
    });
    try {
      cm.dispatch({
        effects: [setHunksEffect.of(hunks), readonlyCompartment.reconfigure(READONLY_ON)],
      });
    } catch {
      this.exit();
      return false;
    }
    nav.update(this.pendingCount(), this.session.navIndex);
    this.scrollToHunk(cm, hunks[0]);
    return true;
  }

  private async forceSourceSubMode(view: MarkdownView) {
    // 实时预览（source: false）下装饰也能渲染，但统一切到源码模式显示最稳
    const state = view.getState() as { mode?: string; source?: boolean | null };
    if (state.mode === 'source' && state.source === false) {
      await view.setState({ ...state, source: true }, { history: false });
    }
  }

  private async restoreMode(view: MarkdownView, saved: Record<string, unknown> | null) {
    const prev = saved as { mode?: string; source?: boolean | null } | null;
    if (prev && prev.mode === 'source' && prev.source === false) {
      await view.setState(saved, { history: false });
    }
  }

  /** 会话仍绑定到同一个活着的 CM 实例时返回它，否则 null */
  private liveCm(): EditorView | null {
    const s = this.session;
    if (!s) return null;
    const cm = cmOf(s.view);
    return cm && cm === s.cm ? cm : null;
  }

  keep(id: number): void {
    if (!this.session) return;
    const cm = this.liveCm();
    if (!cm) {
      this.exit();
      return;
    }
    const s = this.session;
    this.session.hunks = s.hunks.map(h =>
      h.id === id ? { ...h, status: 'kept' as const } : h
    );
    try {
      cm.dispatch({ effects: setHunksEffect.of(this.session.hunks) });
    } catch {
      this.exit();
      return;
    }
    this.afterHunkResolved();
    this.exitIfAllResolved();
  }

  reject(id: number): void {
    if (!this.session) return;
    const cm = this.liveCm();
    if (!cm) {
      this.exit();
      return;
    }
    const hunk = this.session.hunks.find(h => h.id === id);
    if (!hunk || hunk.status !== 'pending') return;
    const spec = revertEditSpec(cm.state.doc, hunk);
    this.session.hunks = shiftAfterReject(this.session.hunks, id);
    try {
      cm.dispatch({
        changes: spec,
        effects: setHunksEffect.of(this.session.hunks),
      });
    } catch {
      this.exit();
      return;
    }
    this.afterHunkResolved();
    this.exitIfAllResolved();
  }

  /** 一个块处理完后：计数显示夹到新范围内并刷新导航条 */
  private afterHunkResolved(): void {
    const s = this.session;
    if (!s) return;
    const count = this.pendingCount();
    s.navIndex = Math.max(0, Math.min(s.navIndex, count - 1));
    s.nav.update(count, s.navIndex);
  }

  private pendingCount(): number {
    return this.session?.hunks.filter(h => h.status === 'pending').length ?? 0;
  }

  /** 导航条按钮：以视口中心为基准去该方向最近的待处理块；该方向没有差异时视图不动 */
  private stepNav(dir: -1 | 1): void {
    const s = this.session;
    if (!s) return;
    const pending = s.hunks.filter(h => h.status === 'pending');
    if (pending.length === 0) return;
    const cm = this.liveCm();
    if (!cm) return;
    const index = findNavTarget(pending, viewportCenterLine(cm), dir);
    if (index < 0) return;
    s.navIndex = index;
    s.nav.update(pending.length, index);
    this.scrollToHunk(cm, pending[index]);
  }

  /** 滚动让差异块出现在编辑器垂直居中位置 */
  private scrollToHunk(cm: EditorView, hunk: DiffHunk): void {
    const doc = cm.state.doc;
    const pos = hunk.currentFrom < doc.lines ? doc.line(hunk.currentFrom + 1).from : doc.length;
    try {
      cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    } catch {
      /* 视图异常时忽略滚动 */
    }
  }

  private exitIfAllResolved(): void {
    const s = this.session;
    if (!s || s.hunks.some(h => h.status === 'pending')) return;
    this.exit();
    new Notice(uiStrings().noticeNoMoreDifferences);
  }

  exit(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    // 先清 handlers 与导航条，保证后续 dispatch 抛错也不会残留失效回调/界面
    setDiffHandlers(null);
    s.nav.unmount();
    const cm = cmOf(s.view);
    if (cm && cm === s.cm) {
      try {
        if (cm.state.field(diffHunkField, false)) {
          cm.dispatch({
            effects: [setHunksEffect.of(null), readonlyCompartment.reconfigure(READONLY_OFF)],
          });
        }
      } catch {
        /* 视图已销毁等，忽略 */
      }
    }
    void this.restoreMode(s.view, s.savedViewState);
  }

  handleVaultModify(file: TFile) {
    if (!this.session || file.path !== this.session.file.path) return;
    const s = this.session;
    // 延迟检查：本插件撤销操作触发的自动保存也走 modify 事件，等它落盘后再比对
    window.setTimeout(() => void this.checkDivergence(s), 400);
  }

  private async checkDivergence(expected: Session) {
    const s = this.session;
    // 定时器回调期间会话可能已退出或被新会话替换
    if (!s || s !== expected) return;
    try {
      const disk = await this.app.vault.cachedRead(s.file);
      if (!sameContent(disk, s.view.editor.getValue())) {
        new Notice(uiStrings().noticeFileChangedExternally);
        this.exit();
      }
    } catch {
      /* 文件已删除等情况直接忽略 */
    }
  }

  handleLeafChange() {
    const s = this.session;
    if (!s) return;
    // 同一视图打开了别的文件，旧会话的装饰已随状态重置失效
    if (!s.view.file || s.view.file.path !== s.file.path) {
      this.exit();
    }
  }
}
