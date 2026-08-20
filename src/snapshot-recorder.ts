import type { EventRef, TAbstractFile, TFile, Vault } from 'obsidian';
import type { SnapshotStoreLike } from './snapshot-store';

type Timer = ReturnType<typeof setTimeout>;

/** vault 的最小依赖面；真实 Vault 结构满足，测试传假件 */
export type RecorderVault = Pick<Vault, 'on' | 'offref' | 'read'>;

export interface RecorderOptions {
  /** 会话边界阈值，每次事件实时读取（设置页改阈值立即生效） */
  thresholdMs(): number;
  now?(): number;
  setTimeout?(fn: () => void, ms: number): Timer;
  clearTimeout?(t: Timer): void;
}

/**
 * 会话边界快照：某次 modify 距上次 ≥ 阈值视为新编辑会话——
 * 会话开始把改前内容写库（即「编辑前快照」），静默满阈值把改后内容写库。
 * 每文件每次会话最多两条写入；所有 store 写入经过 add 的去重闸门。
 */
export class SnapshotRecorder {
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => Timer;
  private readonly cancelTimer: (t: Timer) => void;
  private readonly thresholdMs: () => number;
  private readonly refs: EventRef[] = [];
  private readonly lastModifyTs = new Map<string, number>();
  /** 本会话内最近一次 modify 时的内容；改前内容优先取这里，取不到（重启后首改）读库 */
  private readonly lastKnown = new Map<string, string>();
  private readonly endTimers = new Map<string, Timer>();
  /** 同一文件的操作串行化，避免读写竞态；链上错误全部吞掉（快照尽力而为） */
  private readonly ops = new Map<string, Promise<void>>();

  constructor(
    private vault: RecorderVault,
    private store: SnapshotStoreLike,
    opts: RecorderOptions
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelTimer = opts.clearTimeout ?? (t => clearTimeout(t));
    this.thresholdMs = opts.thresholdMs;
  }

  mount(): void {
    this.refs.push(
      this.vault.on('modify', f => this.onModify(f as TFile)),
      this.vault.on('create', f => this.onCreate(f as TFile)),
      this.vault.on('rename', (f, oldPath) => this.onRename(f as TFile, oldPath))
    );
  }

  dispose(): void {
    for (const t of this.endTimers.values()) this.cancelTimer(t);
    this.endTimers.clear();
    // 尽力 flush：IDB 事务已发起的大概率能在退出前提交，不保证完成
    for (const [path, data] of this.lastKnown) {
      void this.store.add(path, this.now(), data).catch(() => {});
    }
    for (const ref of this.refs) this.vault.offref(ref);
    this.refs.length = 0;
  }

  private enqueue(path: string, fn: () => Promise<unknown>): Promise<void> {
    const prev = this.ops.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn).then(
      () => undefined,
      () => undefined
    );
    this.ops.set(path, next);
    return next;
  }

  private onModify(file: TAbstractFile): void {
    const f = file as TFile;
    if (f.extension !== 'md') return;
    const path = f.path;
    const ts = this.now();
    const prev = this.lastModifyTs.get(path);
    this.lastModifyTs.set(path, ts);
    this.armBurstEnd(path);
    const burstStart = prev === undefined || ts - prev >= this.thresholdMs();
    void this.enqueue(path, async () => {
      if (burstStart) {
        const pre = this.lastKnown.get(path) ?? (await this.store.getLatest(path))?.data;
        if (pre !== undefined) await this.store.add(path, ts, pre);
      }
      try {
        this.lastKnown.set(path, await this.vault.read(f));
      } catch {
        /* 文件已删等，跳过 */
      }
    });
  }

  private armBurstEnd(path: string): void {
    const prev = this.endTimers.get(path);
    if (prev !== undefined) this.cancelTimer(prev);
    this.endTimers.set(
      path,
      this.schedule(() => {
        this.endTimers.delete(path);
        this.onBurstEnd(path);
      }, this.thresholdMs())
    );
  }

  private onBurstEnd(path: string): void {
    const content = this.lastKnown.get(path);
    if (content === undefined) return;
    // 不清 lastModifyTs：下次 modify 判定为新会话、改前内容=本次结束内容，
    // 去重闸门挡掉重复写入，行为自洽
    void this.enqueue(path, () => this.store.add(path, this.now(), content));
  }

  private onCreate(file: TAbstractFile): void {
    const f = file as TFile;
    if (f.extension !== 'md') return;
    const ts = this.now();
    void this.enqueue(f.path, async () => {
      try {
        const data = await this.vault.read(f);
        await this.store.add(f.path, ts, data);
        this.lastKnown.set(f.path, data);
      } catch {
        /* 忽略 */
      }
    });
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    const f = file as TFile;
    void this.enqueue(oldPath, () => this.store.migratePath(oldPath, f.path)).then(() => {
      const ts = this.lastModifyTs.get(oldPath);
      if (ts !== undefined) {
        this.lastModifyTs.set(f.path, ts);
        this.lastModifyTs.delete(oldPath);
      }
      const content = this.lastKnown.get(oldPath);
      if (content !== undefined) {
        this.lastKnown.set(f.path, content);
        this.lastKnown.delete(oldPath);
      }
      const t = this.endTimers.get(oldPath);
      if (t !== undefined) {
        this.endTimers.set(f.path, t);
        this.endTimers.delete(oldPath);
      }
    });
  }
}

export interface BaselineScanOptions {
  batchSize?: number;
  yieldControl?: () => Promise<void>;
  shouldContinue?: () => boolean;
  now?: () => number;
}

/**
 * 全库基线扫描：为每个 md 文件写一条当前内容快照。
 * 内容未变化的文件被 add 的去重闸门跳过，重跑天然增量。
 * 分批执行、批间让出主线程，避免大 vault 卡顿。
 */
export async function runBaselineScan(
  vault: Pick<Vault, 'getMarkdownFiles' | 'cachedRead'>,
  store: SnapshotStoreLike,
  opts: BaselineScanOptions = {}
): Promise<number> {
  const batchSize = opts.batchSize ?? 200;
  const yieldControl = opts.yieldControl ?? (() => new Promise<void>(r => setTimeout(r, 0)));
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const now = opts.now ?? Date.now;
  const files = vault.getMarkdownFiles();
  let written = 0;
  for (let i = 0; i < files.length; i += batchSize) {
    for (const f of files.slice(i, i + batchSize)) {
      if (!shouldContinue()) return written;
      try {
        if (await store.add(f.path, now(), await vault.cachedRead(f))) written++;
      } catch {
        /* 单文件失败跳过 */
      }
    }
    await yieldControl();
  }
  return written;
}
