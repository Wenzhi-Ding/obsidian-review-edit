import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { filterDiffering, getSnapshots, SnapshotSourceUnavailableError } from '../src/snapshot-source';

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

function mockApp(db: unknown): App {
  return {
    internalPlugins: {
      getEnabledPluginById: (id: string) => (id === 'file-recovery' ? { db } : null),
    },
  } as unknown as App;
}

describe('getSnapshots', () => {
  it('file-recovery 不可用时抛 SnapshotSourceUnavailableError', async () => {
    const app = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
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

describe('filterDiffering', () => {
  it('剔除与当前内容相同的快照，保持时间倒序不变', () => {
    const entries = [
      { ts: 300, data: 'current' },
      { ts: 200, data: 'v2' },
      { ts: 100, data: 'current' },
      { ts: 50, data: 'v1' },
    ];
    expect(filterDiffering(entries, 'current')).toEqual([
      { ts: 200, data: 'v2' },
      { ts: 50, data: 'v1' },
    ]);
  });

  it('全部相同时返回空数组', () => {
    expect(filterDiffering([{ ts: 1, data: 'same' }], 'same')).toEqual([]);
  });

  it('空列表原样返回', () => {
    expect(filterDiffering([], 'x')).toEqual([]);
  });

  it('仅尾换行差异的快照视为相同内容并剔除', () => {
    const entries = [
      { ts: 300, data: 'a\nb\n' },
      { ts: 200, data: 'a\nb' },
      { ts: 100, data: 'a\nX\n' },
    ];
    expect(filterDiffering(entries, 'a\nb\n')).toEqual([{ ts: 100, data: 'a\nX\n' }]);
  });

  it('仅换行符风格（CRLF/LF）差异的快照视为相同内容并剔除', () => {
    const entries = [
      { ts: 300, data: 'a\r\nb\r\n' },
      { ts: 200, data: 'a\nX\n' },
    ];
    expect(filterDiffering(entries, 'a\nb\n')).toEqual([{ ts: 200, data: 'a\nX\n' }]);
  });
});
