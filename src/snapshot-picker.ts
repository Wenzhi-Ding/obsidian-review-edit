import type { App, TFile } from 'obsidian';
import { Modal } from 'obsidian';
import type { SnapshotEntry } from './snapshot-source';

export class SnapshotPickerModal extends Modal {
  constructor(
    app: App,
    private file: TFile,
    private entries: SnapshotEntry[],
    private onChoose: (e: SnapshotEntry) => void
  ) {
    super(app);
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: `选择 ${this.file.basename} 的对比基准` });
    const list = this.contentEl.createDiv({ cls: 'review-edit-snapshot-list' });
    for (const e of this.entries) {
      const item = list.createDiv({ cls: 'review-edit-snapshot-item' });
      const time = window.moment(e.ts);
      item.createDiv({ text: time.format('YYYY-MM-DD HH:mm:ss') });
      item.createDiv({ text: `${time.fromNow()} · ${e.data.length} 字符`, cls: 'review-edit-snapshot-meta' });
      item.onclick = () => {
        this.close();
        this.onChoose(e);
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
