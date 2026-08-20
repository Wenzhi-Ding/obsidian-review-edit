import { sameContent } from './diff-engine';
import type { SnapshotEntry } from './snapshot-source';

export const DB_NAME = 'review-edit-snapshots';

interface SnapshotRecord {
  id?: number;
  path: string;
  ts: number;
  data: string;
}

/** recorder 与快照源合并依赖的最小接口；测试用内存实现替换 */
export interface SnapshotStoreLike {
  getLatest(path: string): Promise<SnapshotEntry | null>;
  getEntries(path: string): Promise<SnapshotEntry[]>;
  /** 去重闸门：内容与该路径最新一条相同时（sameContent 口径）不写入，返回 false */
  add(path: string, ts: number, data: string): Promise<boolean>;
  migratePath(oldPath: string, newPath: string): Promise<void>;
  /** 删除 ts 早于保留期截止时间的记录，返回删除条数 */
  pruneRetention(keepDays: number): Promise<number>;
  purge(): Promise<void>;
  close(): void;
}

export class SnapshotStore implements SnapshotStoreLike {
  private db: IDBDatabase;
  private closed = false;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(): Promise<SnapshotStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
        store.createIndex('path', 'path');
        store.createIndex('ts', 'ts');
      };
      req.onsuccess = () => resolve(new SnapshotStore(req.result));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  close(): void {
    this.closed = true;
    this.db.close();
  }

  /** 单事务包装：resolve 时机取事务 complete，结果取请求 result */
  private tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T> | void
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('snapshot store closed'));
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction('snapshots', mode);
      const req = run(tx.objectStore('snapshots')) as IDBRequest<T> | undefined;
      tx.oncomplete = () => resolve(req ? req.result : (undefined as unknown as T));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async getEntries(path: string): Promise<SnapshotEntry[]> {
    const records = await this.tx<SnapshotRecord[]>('readonly', s => s.index('path').getAll(path));
    return [...records].sort((a, b) => b.ts - a.ts).map(r => ({ ts: r.ts, data: r.data }));
  }

  async getLatest(path: string): Promise<SnapshotEntry | null> {
    const entries = await this.getEntries(path);
    return entries[0] ?? null;
  }

  async add(path: string, ts: number, data: string): Promise<boolean> {
    const latest = await this.getLatest(path);
    if (latest && sameContent(latest.data, data)) return false;
    await this.tx('readwrite', s => {
      s.add({ path, ts, data } as SnapshotRecord);
    });
    return true;
  }

  async migratePath(oldPath: string, newPath: string): Promise<void> {
    const records = await this.tx<SnapshotRecord[]>('readonly', s => s.index('path').getAll(oldPath));
    if (records.length === 0) return;
    await this.tx('readwrite', s => {
      for (const r of records) s.put({ ...r, path: newPath });
    });
  }

  async pruneRetention(keepDays: number): Promise<number> {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const expired = await this.tx<SnapshotRecord[]>('readonly', s =>
      s.index('ts').getAll(IDBKeyRange.upperBound(cutoff))
    );
    if (expired.length === 0) return 0;
    await this.tx('readwrite', s => {
      for (const r of expired) s.delete(r.id!);
    });
    return expired.length;
  }

  async purge(): Promise<void> {
    await this.tx('readwrite', s => {
      s.clear();
    });
  }
}
