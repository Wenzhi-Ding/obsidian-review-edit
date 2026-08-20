import type { App } from 'obsidian';
import { sameContent } from './diff-engine';
import type { SnapshotStoreLike } from './snapshot-store';

export interface SnapshotEntry {
  ts: number;
  data: string;
}

export class SnapshotSourceUnavailableError extends Error {
  constructor() {
    super('file-recovery snapshots unavailable');
    this.name = 'SnapshotSourceUnavailableError';
  }
}

interface FileRecoveryBackup {
  path: string;
  ts: number;
  data: string;
}

/**
 * 以下为 file-recovery 核心插件的内部结构（无公开类型，Time Machine 插件采用同一做法）：
 * db 事务返回 Promise 化的 IDB 结果（与 Time Machine 插件相同处理），事务失败时 reject。
 */
interface SnapshotStore {
  indexNames: { contains(name: string): boolean };
  index(name: string): { getAll(key: string): Promise<FileRecoveryBackup[]> };
  getAll(): Promise<FileRecoveryBackup[]>;
}

interface FileRecoveryPlugin {
  db: {
    transaction(stores: string, mode: 'readonly'): { objectStore(name: string): SnapshotStore };
  };
}

interface InternalPlugins {
  getEnabledPluginById?(id: string): FileRecoveryPlugin | undefined;
}

type AppWithInternalPlugins = App & { internalPlugins?: InternalPlugins };

export async function getSnapshots(app: App, path: string): Promise<SnapshotEntry[]> {
  const plugin = (app as AppWithInternalPlugins).internalPlugins?.getEnabledPluginById?.('file-recovery');
  if (!plugin?.db) throw new SnapshotSourceUnavailableError();

  const tx = plugin.db.transaction('backups', 'readonly');
  const store = tx.objectStore('backups');
  let backups: FileRecoveryBackup[];
  if (store.indexNames.contains('path')) {
    backups = await store.index('path').getAll(path);
  } else {
    const all = await store.getAll();
    backups = all.filter(b => b.path === path);
  }

  backups.sort((a, b) => b.ts - a.ts);
  return dedupeAdjacent(backups.map(b => ({ ts: b.ts, data: b.data })));
}

/** 相邻内容相同只保留最新一条，减少选择器噪音；「相同」按 diff 引擎口径 */
export function dedupeAdjacent(entries: SnapshotEntry[]): SnapshotEntry[] {
  const out: SnapshotEntry[] = [];
  for (const e of entries) {
    if (out.length === 0 || !sameContent(out[out.length - 1].data, e.data)) out.push(e);
  }
  return out;
}

/**
 * 剔除与当前内容相同的快照。
 * Obsidian 不只在内容变化时落快照（如路径变动），候选列表里混入
 * 与当前一致的条目只会让用户选中后得到「没有发现差异」。
 * 「相同」按 diff 引擎的标准（忽略行尾风格与末尾换行）。
 */
export function filterDiffering(entries: SnapshotEntry[], current: string): SnapshotEntry[] {
  return entries.filter(e => !sameContent(e.data, current));
}

/**
 * 合并自建快照库与 file-recovery 两源，按时间倒序去重相邻同内容。
 * 失败语义：file-recovery 不可用则静默降级；自建库读失败回调 onOwnStoreError 后降级；
 * 两者都拿不到数据才抛 SnapshotSourceUnavailableError。
 */
export async function getMergedSnapshots(
  app: App,
  path: string,
  store: SnapshotStoreLike | null,
  onOwnStoreError?: () => void
): Promise<SnapshotEntry[]> {
  let own: SnapshotEntry[] = [];
  let ownFailed = false;
  if (store) {
    try {
      own = await store.getEntries(path);
    } catch {
      ownFailed = true;
      onOwnStoreError?.();
    }
  }
  let fr: SnapshotEntry[] = [];
  let frFailed = false;
  try {
    fr = await getSnapshots(app, path);
  } catch {
    frFailed = true;
  }
  if (frFailed && (ownFailed || !store)) throw new SnapshotSourceUnavailableError();
  return dedupeAdjacent([...own, ...fr].sort((a, b) => b.ts - a.ts));
}
