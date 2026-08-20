import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { SnapshotStoreLike } from '../src/snapshot-store';
import {
  dedupeAdjacent,
  filterDiffering,
  getMergedSnapshots,
  getSnapshots,
  SnapshotSourceUnavailableError,
} from '../src/snapshot-source';

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

  it('按时间倒序返回且合并相邻相同内容，条目标记为 file-recovery 来源', async () => {
    const recs = [
      { path: 'a.md', ts: 300, data: 'v2' },
      { path: 'a.md', ts: 200, data: 'v2' },
      { path: 'a.md', ts: 100, data: 'v1' },
      { path: 'b.md', ts: 250, data: 'z' },
    ];
    const out = await getSnapshots(mockApp(mockDb(recs)), 'a.md');
    expect(out).toEqual([
      { ts: 300, data: 'v2', source: 'file-recovery' },
      { ts: 100, data: 'v1', source: 'file-recovery' },
    ]);
  });

  it('无 path 索引时回退到全量读取再过滤', async () => {
    const recs = [{ path: 'a.md', ts: 1, data: 'x' }];
    const out = await getSnapshots(mockApp(mockDb(recs, false)), 'a.md');
    expect(out).toEqual([{ ts: 1, data: 'x', source: 'file-recovery' }]);
  });

  it('IndexedDB 抛错时原样向上抛出', async () => {
    const db = { transaction: () => { throw new Error('boom'); } };
    await expect(getSnapshots(mockApp(db), 'a.md')).rejects.toThrow('boom');
  });
});

function mockStore(
  entries: Array<{ path: string; ts: number; data: string }>,
  fail = false
): SnapshotStoreLike {
  return {
    getLatest: async p => entries.filter(e => e.path === p).sort((a, b) => b.ts - a.ts)[0] ?? null,
    getEntries: async p =>
      fail
        ? Promise.reject(new Error('own boom'))
        : Promise.resolve(
            entries.filter(e => e.path === p).sort((a, b) => b.ts - a.ts).map(({ ts, data }) => ({ ts, data }))
          ),
    add: async () => false,
    migratePath: async () => {},
    pruneRetention: async () => 0,
    purge: async () => {},
    close: () => {},
  };
}

describe('dedupeAdjacent', () => {
  it('相邻同内容只留最新，跨源合并用同一口径（含换行风格差异）', () => {
    expect(
      dedupeAdjacent([
        { ts: 300, data: 'v2' },
        { ts: 280, data: 'v2' },
        { ts: 270, data: 'v2\r\n' },
        { ts: 100, data: 'v1' },
      ])
    ).toEqual([
      { ts: 300, data: 'v2' },
      { ts: 100, data: 'v1' },
    ]);
  });
});

describe('getMergedSnapshots', () => {
  it('两源按时间倒序合并并去重相邻同内容，条目带各自来源标记', async () => {
    const fr = mockApp(
      mockDb([
        { path: 'a.md', ts: 100, data: 'v1' },
        { path: 'a.md', ts: 400, data: 'v3' },
      ])
    );
    const own = mockStore([{ path: 'a.md', ts: 200, data: 'v2' }]);
    expect(await getMergedSnapshots(fr, 'a.md', own)).toEqual([
      { ts: 400, data: 'v3', source: 'file-recovery' },
      { ts: 200, data: 'v2', source: 'own' },
      { ts: 100, data: 'v1', source: 'file-recovery' },
    ]);
  });

  it('自建库读失败：返回 file-recovery 条目并回调 onOwnStoreError', async () => {
    const onErr = vi.fn();
    const fr = mockApp(mockDb([{ path: 'a.md', ts: 100, data: 'v1' }]));
    expect(await getMergedSnapshots(fr, 'a.md', mockStore([], true), onErr)).toEqual([
      { ts: 100, data: 'v1', source: 'file-recovery' },
    ]);
    expect(onErr).toHaveBeenCalledTimes(1);
  });

  it('file-recovery 不可用但自建库可用（含为空）：返回自建条目，不抛错', async () => {
    const noFr = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
    expect(
      await getMergedSnapshots(noFr, 'a.md', mockStore([{ path: 'a.md', ts: 1, data: 'x' }]))
    ).toEqual([{ ts: 1, data: 'x', source: 'own' }]);
    expect(await getMergedSnapshots(noFr, 'a.md', mockStore([]))).toEqual([]);
  });

  it('两源都失败抛 SnapshotSourceUnavailableError', async () => {
    const noFr = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
    await expect(getMergedSnapshots(noFr, 'a.md', mockStore([], true))).rejects.toBeInstanceOf(
      SnapshotSourceUnavailableError
    );
  });

  it('store 为 null（功能关闭）时行为与旧 getSnapshots 一致：不可用即抛错', async () => {
    const noFr = { internalPlugins: { getEnabledPluginById: () => null } } as unknown as App;
    await expect(getMergedSnapshots(noFr, 'a.md', null)).rejects.toBeInstanceOf(
      SnapshotSourceUnavailableError
    );
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
