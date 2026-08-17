import { MarkdownView, Notice, Plugin, setIcon, TFile } from 'obsidian';
import { diffExtension, readonlyCompartment } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getSnapshots, filterDiffering, SnapshotSourceUnavailableError } from './snapshot-source';
import { SnapshotPickerModal } from './snapshot-picker';

export default class ReviewEditPlugin extends Plugin {
  diffMode!: DiffModeController;

  async onload() {
    this.diffMode = new DiffModeController(this.app, this);
    this.registerEditorExtension([diffExtension, readonlyCompartment.of([])]);

    this.registerEvent(
      this.app.vault.on('modify', f => {
        if (f instanceof TFile) this.diffMode.handleVaultModify(f);
      })
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.diffMode.handleLeafChange())
    );
    // 每个打开的笔记视图右上角加一个「历史比对」按钮；视图关闭时随 DOM 销毁
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.ensureHeaderButtons())
    );
    this.app.workspace.onLayoutReady(() => this.ensureHeaderButtons());

    this.addCommand({
      id: 'compare-snapshot',
      name: '与历史版本对比',
      callback: () => void this.startReview(false),
    });
    this.addCommand({
      id: 'compare-latest-snapshot',
      name: '与上一个快照对比',
      callback: () => void this.startReview(true),
    });
    this.addCommand({
      id: 'exit-diff-mode',
      name: '退出 diff 模式',
      callback: () => this.diffMode.exit(),
    });
    this.addRibbonIcon('git-compare', '与历史版本对比', () => void this.startReview(false));
  }

  onunload() {
    this.diffMode.exit();
  }

  /** 幂等地给所有 Markdown 视图头部的按钮区加历史比对按钮 */
  private ensureHeaderButtons() {
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const actions = view.containerEl.querySelector('.view-actions');
      if (!actions || actions.querySelector('.review-edit-header-btn')) return;
      const btn = createDiv({ cls: 'clickable-icon review-edit-header-btn' });
      btn.setAttribute('aria-label', '与历史版本对比');
      btn.setAttribute('aria-label-position', 'left');
      setIcon(btn, 'history');
      btn.onclick = () => void this.startReview(false);
      actions.prepend(btn);
    });
  }

  private async startReview(useLatest: boolean) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice('请在笔记编辑器中使用');
      return;
    }
    if ((view.getState() as { mode?: string }).mode === 'preview') {
      new Notice('请在编辑模式（而非阅读模式）下使用');
      return;
    }
    let rawEntries;
    try {
      rawEntries = await getSnapshots(this.app, view.file.path);
    } catch (e) {
      new Notice(e instanceof SnapshotSourceUnavailableError ? '文件恢复插件未启用或快照数据库不可读' : '读取快照失败');
      return;
    }
    if (rawEntries.length === 0) {
      new Notice('该文件没有可用的历史快照');
      return;
    }
    // 候选列表只留与当前内容不同的快照（Obsidian 落快照不一定伴随内容变化）
    const entries = filterDiffering(rawEntries, view.editor.getValue());
    if (entries.length === 0) {
      new Notice('没有发现差异');
      return;
    }
    if (useLatest) {
      if (!(await this.diffMode.enter(view, entries[0]))) new Notice('没有发现差异');
    } else {
      // onChoose 是裸调用，未捕获的 rejection 会逃逸成 unhandled rejection
      new SnapshotPickerModal(this.app, view.file, entries, e => {
        void (async () => {
          try {
            if (!(await this.diffMode.enter(view, e))) new Notice('没有发现差异');
          } catch {
            new Notice('进入 diff 模式失败');
          }
        })();
      }).open();
    }
  }
}
