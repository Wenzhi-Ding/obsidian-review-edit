import { MarkdownView, Notice, Plugin, setIcon, TFile } from 'obsidian';
import { diffExtension, readonlyCompartment } from './cm-extension';
import { DiffModeController } from './diff-mode';
import { getMergedSnapshots, filterDiffering, SnapshotSourceUnavailableError } from './snapshot-source';
import { runBaselineScan, SnapshotRecorder } from './snapshot-recorder';
import { SnapshotStore } from './snapshot-store';
import { DEFAULT_SETTINGS, ReviewEditSettingTab, type ReviewEditSettings, type SettingsHost } from './settings';
import { SnapshotPickerModal } from './snapshot-picker';
import { uiStrings } from './strings';

export default class ReviewEditPlugin extends Plugin implements SettingsHost {
  diffMode!: DiffModeController;
  settings: ReviewEditSettings = { ...DEFAULT_SETTINGS };
  private store: SnapshotStore | null = null;
  private recorder: SnapshotRecorder | null = null;
  private ownStoreErrorNoticed = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ReviewEditSettingTab(this.app, this));
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
    this.app.workspace.onLayoutReady(() => void this.afterLayoutReady());

    const t = uiStrings();
    this.addCommand({
      id: 'compare-snapshot',
      name: t.commandCompareHistory,
      callback: () => void this.startReview(false),
    });
    this.addCommand({
      id: 'compare-latest-snapshot',
      name: t.commandComparePrevious,
      callback: () => void this.startReview(true),
    });
    this.addCommand({
      id: 'exit-diff-mode',
      name: t.commandExitDiffMode,
      callback: () => this.diffMode.exit(),
    });
    this.addRibbonIcon('git-compare', t.commandCompareHistory, () => void this.startReview(false));
  }

  onunload() {
    this.diffMode.exit();
    this.disableOwnSnapshots();
    this.store?.close();
    this.store = null;
  }

  /** SettingsHost：设置持久化 */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ReviewEditSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  private async afterLayoutReady(): Promise<void> {
    if (!this.settings.ownSnapshotsEnabled) return;
    await this.enableOwnSnapshots();
    // 每日保留期清理；registerInterval 随插件卸载自动撤销
    this.registerInterval(
      window.setInterval(() => {
        void this.store?.pruneRetention(this.settings.retentionDays).catch(() => {});
      }, 24 * 60 * 60 * 1000)
    );
  }

  /** SettingsHost：开启（或重启后恢复）自动快照 */
  async enableOwnSnapshots(): Promise<void> {
    if (!this.store) {
      try {
        this.store = await SnapshotStore.open();
      } catch {
        new Notice(uiStrings().noticeStoreOpenFailed);
        return;
      }
    }
    if (this.recorder) return;
    this.recorder = new SnapshotRecorder(this.app.vault, this.store, {
      thresholdMs: () => this.settings.burstThresholdMinutes * 60_000,
    });
    this.recorder.mount();
    void this.store.pruneRetention(this.settings.retentionDays).catch(() => {});
    if (!this.settings.baselined) await this.rebuildBaseline();
  }

  /** SettingsHost：运行中关闭——立即停录，已存快照保留 */
  disableOwnSnapshots(): void {
    this.recorder?.dispose();
    this.recorder = null;
  }

  /** SettingsHost：手动/首次全量快照（原「基线」）；常驻通知回报进度 */
  private baselineRunning = false;

  async rebuildBaseline(): Promise<void> {
    const store = this.store;
    if (!store || this.baselineRunning) return;
    this.baselineRunning = true;
    const t = uiStrings();
    // 对象包装：闭包内赋值的变量在 finally 里会被流分析收窄，无法 ?.hide()
    const progress: { notice: Notice | null } = { notice: null };
    let lastPaint = 0;
    try {
      const written = await runBaselineScan(this.app.vault, store, {
        shouldContinue: () => this.settings.ownSnapshotsEnabled && this.store === store,
        onProgress: (done, total) => {
          // 逐文件回调、按 250ms 节流重绘；最后一个文件强制刷新
          if (done !== total && Date.now() - lastPaint < 250) return;
          lastPaint = Date.now();
          const msg = t.noticeBaselineProgress(done, total);
          if (!progress.notice) progress.notice = new Notice(msg, 0);
          else progress.notice.setMessage(msg);
        },
      });
      if (!this.settings.baselined) {
        this.settings.baselined = true;
        await this.saveSettings();
      }
      new Notice(t.noticeBaselineDone(written));
    } finally {
      progress.notice?.hide();
      this.baselineRunning = false;
    }
  }

  /** SettingsHost：清除全部自建快照（不动 baselined——重建由用户显式触发） */
  async purgeSnapshots(): Promise<void> {
    await this.store?.purge();
    new Notice(uiStrings().noticePurgeDone);
  }

  /** 幂等地给所有 Markdown 视图头部的按钮区加历史比对按钮 */
  private ensureHeaderButtons() {
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      const actions = view.containerEl.querySelector('.view-actions');
      if (!actions || actions.querySelector('.review-edit-header-btn')) return;
      const btn = createDiv({ cls: 'clickable-icon review-edit-header-btn' });
      btn.setAttribute('aria-label', uiStrings().commandCompareHistory);
      btn.setAttribute('aria-label-position', 'left');
      setIcon(btn, 'history');
      btn.onclick = () => void this.startReview(false);
      actions.prepend(btn);
    });
  }

  private async startReview(useLatest: boolean) {
    const t = uiStrings();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) {
      new Notice(t.noticeNeedEditor);
      return;
    }
    if ((view.getState() as { mode?: string }).mode === 'preview') {
      new Notice(t.noticeNeedSourceMode);
      return;
    }
    let rawEntries;
    try {
      const store = this.settings.ownSnapshotsEnabled ? this.store : null;
      rawEntries = await getMergedSnapshots(this.app, view.file.path, store, () => {
        if (this.ownStoreErrorNoticed) return;
        this.ownStoreErrorNoticed = true;
        new Notice(uiStrings().noticeOwnStoreReadFailed);
      });
    } catch (e) {
      new Notice(e instanceof SnapshotSourceUnavailableError ? t.noticeSnapshotSourceUnavailable : t.noticeReadSnapshotsFailed);
      return;
    }
    if (rawEntries.length === 0) {
      new Notice(t.noticeNoSnapshots);
      return;
    }
    // 候选列表只留与当前内容不同的快照（Obsidian 落快照不一定伴随内容变化）
    const entries = filterDiffering(rawEntries, view.editor.getValue());
    if (entries.length === 0) {
      new Notice(t.noticeNoDifferences);
      return;
    }
    if (useLatest) {
      if (!(await this.diffMode.enter(view, entries[0]))) new Notice(t.noticeNoDifferences);
    } else {
      // onChoose 是裸调用，未捕获的 rejection 会逃逸成 unhandled rejection
      new SnapshotPickerModal(this.app, view.file, entries, e => {
        void (async () => {
          try {
            if (!(await this.diffMode.enter(view, e))) new Notice(t.noticeNoDifferences);
          } catch {
            new Notice(t.noticeEnterDiffFailed);
          }
        })();
      }).open();
    }
  }
}
