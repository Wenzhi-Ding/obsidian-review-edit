import { MarkdownView, Notice, Plugin } from 'obsidian';
import { diffExtension, readonlyCompartment } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getSnapshots, SnapshotSourceUnavailableError } from './snapshot-source';

export default class ReviewEditPlugin extends Plugin {
  diffMode!: DiffModeController;

  async onload() {
    this.diffMode = new DiffModeController(this.app, this);
    this.registerEditorExtension([diffExtension, readonlyCompartment.of([])]);

    this.addCommand({
      id: 'compare-latest-snapshot',
      name: '与上一个快照对比',
      callback: () => void this.startReview(true),
    });
  }

  private async startReview(useLatest: boolean) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice('请在笔记编辑器中使用');
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
    if (!useLatest) return; // 「与历史版本对比」在 Task 7 接入
    const current = view.editor.getValue();
    const first = entries.find(e => e.data !== current);
    if (!first) {
      new Notice('没有发现差异');
      return;
    }
    if (!(await this.diffMode.enter(view, first))) {
      new Notice('没有发现差异');
    }
  }
}
