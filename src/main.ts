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
  /** 当前常驻进度通知的持有者；重建结束/插件卸载时清理，防止残留。
   *  用对象包装而非直接持有 Notice：闭包内赋值的属性在 finally 里不会被流分析收窄。 */
  private progressHolder: { notice: Notice | null } | null = null;
  /** SettingsHost：设置页注入的进度回调；设置页关闭时置回 null（改走通知兜底） */
  onBaselineProgressUI: ((text: string | null) => void) | null = null;

  private hideProgressNotice(): void {
    this.progressHolder?.notice?.hide();
    this.progressHolder = null;
  }
  private logChain: Promise<void> = Promise.resolve();

  /** SettingsHost：设置面板的诊断锚点（按钮点击等事件也进诊断日志）；生产构建下 appendLog 直接短路 */
  diagLog(line: string): void {
    this.appendLog(line);
  }

  /** 诊断日志：写插件目录 rebuild.log，进程冻死后可从磁盘读取定位停点 */
  private appendLog(line: string): void {
    if (!__DIAG__) return;
    // performance.memory 是 Chromium 私有 API，取不到就空串
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heap = mem ? ` heapMB=${Math.round(mem.usedJSHeapSize / 1048576)}` : '';
    const text = `${new Date().toISOString()} ${line}${heap}\n`;
    const logPath = `${this.app.vault.configDir}/plugins/review-edit/rebuild.log`;
    // 链式 append 保证顺序；不阻塞扫描主流程
    this.logChain = this.logChain
      .then(() => this.app.vault.adapter.append(logPath, text))
      .then(() => undefined, () => {});
  }

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
    this.hideProgressNotice();
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
    // 清掉上次运行可能残留的常驻进度通知（中途出错/冻死时会留在屏幕上）
    this.hideProgressNotice();
    // 对象包装：闭包内赋值的变量在 finally 里会被流分析收窄，无法 ?.hide()
    const progress: { notice: Notice | null } = { notice: null };
    this.progressHolder = progress;
    let lastPaint = 0;
    this.logChain = Promise.resolve();
    if (__DIAG__) {
      // 心跳：主线程被外来同步任务堵死时心跳与扫描行同时停止；扫描自身 await 卡死时心跳仍在。
      // 保留到结束后 35 秒——两次实测的堵死都发生在扫描末尾/收尾窗口，覆盖完整嫌疑区间。
      const heartbeat = window.setInterval(() => this.appendLog('heartbeat'), 5000);
      this.registerInterval(heartbeat);
      this.registerInterval(window.setTimeout(() => window.clearInterval(heartbeat), 35_000));
    }
    try {
      if (__DIAG__) {
        // 追加而非清空：冻死那次运行的日志要保留到事后取证；超过 1MB 时重写，避免无上限增长
        const logPath = `${this.app.vault.configDir}/plugins/review-edit/rebuild.log`;
        const stat = await this.app.vault.adapter.stat(logPath).catch(() => null);
        if (stat && stat.size > 1_000_000) {
          await this.app.vault.adapter.write(logPath, '').catch(() => {});
        }
        await this.app.vault.adapter
          .append(logPath, `\n${new Date().toISOString()} rebuild-start\n`)
          .catch(() => {});
      }
      if (__DIAG__) this.appendLog('scan-begin');
      const written = await runBaselineScan(this.app.vault, store, {
        shouldContinue: () => this.settings.ownSnapshotsEnabled && this.store === store,
        onProgress: (done, total) => {
          // 逐文件回调、按 250ms 节流重绘；最后一个文件强制刷新
          if (done !== total && Date.now() - lastPaint < 250) return;
          lastPaint = Date.now();
          const msg = t.noticeBaselineProgress(done, total);
          if (this.onBaselineProgressUI) this.onBaselineProgressUI(msg);
          else if (!progress.notice) progress.notice = new Notice(msg, 0);
          else progress.notice.setMessage(msg);
        },
        onLog: __DIAG__ ? (line: string) => this.appendLog(line) : undefined,
      });
      if (__DIAG__) this.appendLog(`scan-return written=${written}`);
      if (!this.settings.baselined) {
        this.settings.baselined = true;
        await this.saveSettings();
      }
      await this.logChain;
      if (__DIAG__) this.appendLog('completion-notice-next');
      new Notice(t.noticeBaselineDone(written), 8000);
    } finally {
      if (__DIAG__) this.appendLog('rebuild-finally');
      await this.logChain;
      if (__DIAG__) this.appendLog('hiding-progress');
      this.onBaselineProgressUI?.(null);
      this.hideProgressNotice();
      if (__DIAG__) this.appendLog('progress-hidden');
      this.baselineRunning = false;
      // 存活探针：结束后主线程仍活着才会打出这些行——堵死后日志止于探针之前
      if (__DIAG__) {
        for (const d of [2000, 5000, 10000, 30000]) {
          this.registerInterval(
            window.setTimeout(() => this.appendLog(`alive +${d / 1000}s`), d)
          );
        }
      }
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
