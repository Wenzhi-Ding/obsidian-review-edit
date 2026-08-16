import type { App } from 'obsidian';

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

export async function getSnapshots(app: App, path: string): Promise<SnapshotEntry[]> {
  const plugin = (app as any).internalPlugins?.getEnabledPluginById?.('file-recovery');
  if (!plugin?.db) throw new SnapshotSourceUnavailableError();

  // file-recovery 的 db 事务返回 Promise 化的 IDB 结果（与 Time Machine 插件相同处理）
  const tx = plugin.db.transaction('backups', 'readonly');
  const store = tx.objectStore('backups');
  let backups: FileRecoveryBackup[];
  if (store.indexNames.contains('path')) {
    backups = (await store.index('path').getAll(path)) as FileRecoveryBackup[];
  } else {
    const all = (await store.getAll()) as FileRecoveryBackup[];
    backups = all.filter(b => b.path === path);
  }

  backups.sort((a, b) => b.ts - a.ts);
  // 相邻内容相同只保留最新一条，减少选择器噪音
  const out: SnapshotEntry[] = [];
  for (const b of backups) {
    if (out.length === 0 || out[out.length - 1].data !== b.data) out.push({ ts: b.ts, data: b.data });
  }
  return out;
}
