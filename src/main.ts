import { MarkdownView, Notice, Plugin } from 'obsidian';
import type { TFile } from 'obsidian';
import { diffExtension, readonlyCompartment } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getSnapshots, SnapshotSourceUnavailableError } from './snapshot-source';
import { SnapshotPickerModal } from './snapshot-picker';

export default class ReviewEditPlugin extends Plugin {
  diffMode!: DiffModeController;

  async onload() {
    this.diffMode = new DiffModeController(this.app, this);
    this.registerEditorExtension([diffExtension, readonlyCompartment.of([])]);

    this.registerEvent(
      this.app.vault.on('modify', f => this.diffMode.handleVaultModify(f as TFile))
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.diffMode.handleLeafChange())
    );

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
    let entries;
    try {
      entries = await getSnapshots(this.app, view.file.path);
    } catch (e) {
      new Notice(e instanceof SnapshotSourceUnavailableError ? '文件恢复插件未启用或快照数据库不可读' : '读取快照失败');
      return;
    }
    if (entries.length === 0) {
      new Notice('该文件没有可用的历史快照');
      return;
    }
    const current = view.editor.getValue();
    if (useLatest) {
      const first = entries.find(e => e.data !== current);
      if (!first) {
        new Notice('没有发现差异');
        return;
      }
      if (!(await this.diffMode.enter(view, first))) new Notice('没有发现差异');
    } else {
      // onChoose 是裸调用，未捕获的 rejection 会逃逸成 unhandled rejection
      new SnapshotPickerModal(this.app, view.file, entries, async e => {
        try {
          if (!(await this.diffMode.enter(view, e))) new Notice('没有发现差异');
        } catch {
          new Notice('进入 diff 模式失败');
        }
      }).open();
    }
  }
}
