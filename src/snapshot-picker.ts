import type { App, TFile } from 'obsidian';
import { Modal } from 'obsidian';
import type { SnapshotEntry } from './snapshot-source';
import { uiStrings } from './strings';

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
    const t = uiStrings();
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: t.pickerTitle(this.file.basename) });
    const list = this.contentEl.createDiv({ cls: 'review-edit-snapshot-list' });
    for (const e of this.entries) {
      const item = list.createDiv({ cls: 'review-edit-snapshot-item' });
      const time = window.moment(e.ts);
      const head = item.createDiv({ cls: 'review-edit-snapshot-head' });
      head.createSpan({ text: time.format('YYYY-MM-DD HH:mm:ss') });
      head.createSpan({
        cls:
          'review-edit-source-tag ' +
          (e.source === 'file-recovery' ? 'review-edit-source-file-recovery' : 'review-edit-source-own'),
        text: e.source === 'file-recovery' ? t.pickerSourceFileRecovery : t.pickerSourceOwn,
      });
      item.createDiv({ text: `${time.fromNow()} · ${t.pickerCharCount(e.data.length)}`, cls: 'review-edit-snapshot-meta' });
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
