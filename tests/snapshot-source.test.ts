import { describe, expect, it } from 'vitest';
import { getSnapshots, SnapshotSourceUnavailableError } from '../src/snapshot-source';

function mockDb(records: Array<{ path: string; ts: number; data: string }>, withPathIndex = true) {
  return {
    transaction: () => ({
      objectStore: () => ({
        indexNames: { contains: (n: string) => withPathIndex && n === 'path' },
        index: () => ({ getAll: async (p: string) => records.filter(r => r.path === p) }),
        getAll: async () => records,
      }),
    }),
  };
}

function mockApp(db: unknown) {
  return {
    internalPlugins: {
      getEnabledPluginById: (id: string) => (id === 'file-recovery' ? { db } : null),
    },
  } as any;
}

describe('getSnapshots', () => {
  it('file-recovery 不可用时抛 SnapshotSourceUnavailableError', async () => {
    const app = { internalPlugins: { getEnabledPluginById: () => null } } as any;
    await expect(getSnapshots(app, 'x.md')).rejects.toBeInstanceOf(SnapshotSourceUnavailableError);
  });

  it('按时间倒序返回且合并相邻相同内容', async () => {
    const recs = [
      { path: 'a.md', ts: 300, data: 'v2' },
      { path: 'a.md', ts: 200, data: 'v2' },
      { path: 'a.md', ts: 100, data: 'v1' },
      { path: 'b.md', ts: 250, data: 'z' },
    ];
    const out = await getSnapshots(mockApp(mockDb(recs)), 'a.md');
    expect(out).toEqual([{ ts: 300, data: 'v2' }, { ts: 100, data: 'v1' }]);
  });

  it('无 path 索引时回退到全量读取再过滤', async () => {
    const recs = [{ path: 'a.md', ts: 1, data: 'x' }];
    const out = await getSnapshots(mockApp(mockDb(recs, false)), 'a.md');
    expect(out).toEqual([{ ts: 1, data: 'x' }]);
  });

  it('IndexedDB 抛错时原样向上抛出', async () => {
    const db = { transaction: () => { throw new Error('boom'); } };
    await expect(getSnapshots(mockApp(db), 'a.md')).rejects.toThrow('boom');
  });
});
