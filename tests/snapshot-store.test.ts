import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, SnapshotStore } from '../src/snapshot-store';

/** 每个用例独立的库：先删库再开新连接 */
async function freshStore(): Promise<SnapshotStore> {
  await new Promise<void>(resolve => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  return SnapshotStore.open();
}

describe('SnapshotStore', () => {
  let store: SnapshotStore;
  afterEach(() => store?.close());

  it('add 写入后 getEntries 按时间倒序返回，getLatest 取最新一条', async () => {
    store = await freshStore();
    expect(await store.add('a.md', 100, 'v1')).toBe(true);
    expect(await store.add('a.md', 300, 'v3')).toBe(true);
    expect(await store.add('a.md', 200, 'v2')).toBe(true);
    expect(await store.add('b.md', 250, 'other')).toBe(true);
    expect(await store.getEntries('a.md')).toEqual([
      { ts: 300, data: 'v3' },
      { ts: 200, data: 'v2' },
      { ts: 100, data: 'v1' },
    ]);
    expect(await store.getLatest('a.md')).toEqual({ ts: 300, data: 'v3' });
    expect(await store.getLatest('nope.md')).toBeNull();
  });

  it('add 的去重闸门：内容与最新一条相同时跳过（含仅换行风格差异）', async () => {
    store = await freshStore();
    expect(await store.add('a.md', 100, 'a\nb\n')).toBe(true);
    expect(await store.add('a.md', 200, 'a\nb\n')).toBe(false);
    // 编辑器内存是 LF、磁盘/快照可能是 CRLF——sameContent 口径下不算差异
    expect(await store.add('a.md', 300, 'a\r\nb\r\n')).toBe(false);
    expect(await store.getEntries('a.md')).toEqual([{ ts: 100, data: 'a\nb\n' }]);
    expect(await store.add('a.md', 400, 'a\nX\n')).toBe(true);
  });

  it('migratePath 把旧路径的记录迁到新路径', async () => {
    store = await freshStore();
    await store.add('old/dir/x.md', 100, 'v1');
    await store.add('old/dir/x.md', 200, 'v2');
    await store.add('keep.md', 150, 'z');
    await store.migratePath('old/dir/x.md', 'new/dir/x.md');
    expect(await store.getEntries('old/dir/x.md')).toEqual([]);
    expect(await store.getEntries('new/dir/x.md')).toEqual([
      { ts: 200, data: 'v2' },
      { ts: 100, data: 'v1' },
    ]);
    expect(await store.getLatest('keep.md')).toEqual({ ts: 150, data: 'z' });
  });

  it('pruneRetention 删除过期记录并返回条数', async () => {
    store = await freshStore();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await store.add('a.md', now - 40 * day, 'old');
    await store.add('a.md', now - 10 * day, 'mid');
    await store.add('b.md', now - 1 * day, 'new');
    expect(await store.pruneRetention(30)).toBe(1);
    expect(await store.getEntries('a.md')).toEqual([{ ts: now - 10 * day, data: 'mid' }]);
    expect(await store.getLatest('b.md')).toEqual({ ts: now - 1 * day, data: 'new' });
  });

  it('purge 清空全部记录', async () => {
    store = await freshStore();
    await store.add('a.md', 100, 'v1');
    await store.add('b.md', 200, 'v2');
    await store.purge();
    expect(await store.getEntries('a.md')).toEqual([]);
    expect(await store.getLatest('b.md')).toBeNull();
  });

  it('close 后操作拒绝', async () => {
    store = await freshStore();
    store.close();
    await expect(store.add('a.md', 1, 'x')).rejects.toThrow('snapshot store closed');
  });
});
