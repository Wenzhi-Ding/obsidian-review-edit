import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventRef, TFile } from 'obsidian';
import { sameContent } from '../src/diff-engine';
import type { SnapshotStoreLike } from '../src/snapshot-store';
import { SnapshotRecorder, type RecorderVault } from '../src/snapshot-recorder';

/** 内存实现：记录 add 调用，真实执行去重闸门，可注入既有条目模拟「重启前的库」 */
class MemoryStore implements SnapshotStoreLike {
  entries: { path: string; ts: number; data: string }[] = [];
  addCalls: { path: string; ts: number; data: string }[] = [];
  migrateCalls: { oldPath: string; newPath: string }[] = [];
  constructor(seed: { path: string; ts: number; data: string }[] = []) {
    this.entries = [...seed];
  }
  private sorted(path: string) {
    return this.entries.filter(e => e.path === path).sort((a, b) => b.ts - a.ts);
  }
  async getLatest(path: string) {
    const top = this.sorted(path)[0];
    return top ? { ts: top.ts, data: top.data } : null;
  }
  async getEntries(path: string) {
    return this.sorted(path).map(({ ts, data }) => ({ ts, data }));
  }
  async add(path: string, ts: number, data: string) {
    this.addCalls.push({ path, ts, data });
    const latest = await this.getLatest(path);
    if (latest && sameContent(latest.data, data)) return false;
    this.entries.push({ path, ts, data });
    return true;
  }
  async migratePath(oldPath: string, newPath: string) {
    this.migrateCalls.push({ oldPath, newPath });
    for (const e of this.entries) if (e.path === oldPath) e.path = newPath;
  }
  async pruneRetention() {
    return 0;
  }
  async purge() {
    this.entries = [];
  }
  close() {}
}

function mdFile(path: string): TFile {
  return { path, extension: 'md' } as unknown as TFile;
}

/** vault 假件：read 返回 content() 的当前值；fire 手动派发事件 */
function fakeVault(content: () => string | Promise<string>) {
  const handlers = new Map<string, Array<(f: unknown, old?: string) => void>>();
  const refs: EventRef[] = [];
  return {
    vault: {
      on: (ev: string, cb: (f: unknown, old?: string) => void) => {
        const list = handlers.get(ev) ?? [];
        list.push(cb);
        handlers.set(ev, list);
        const ref = {} as EventRef;
        refs.push(ref);
        return ref;
      },
      offref: (ref: EventRef) => {
        const i = refs.indexOf(ref);
        if (i >= 0) refs.splice(i, 1);
      },
      read: async () => content(),
    } as unknown as RecorderVault,
    fire: (ev: string, ...args: unknown[]) => {
      for (const cb of handlers.get(ev) ?? []) cb(...args);
    },
    registeredRefs: () => refs.length,
  };
}

describe('SnapshotRecorder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const THRESHOLD = 60_000;
  function setup(
    content: () => string | Promise<string>,
    seed?: ConstructorParameters<typeof MemoryStore>[0]
  ) {
    const store = new MemoryStore(seed);
    const env = fakeVault(content);
    let nowMs = 1_000_000;
    const rec = new SnapshotRecorder(env.vault, store, {
      thresholdMs: () => THRESHOLD,
      now: () => nowMs,
    });
    rec.mount();
    return { store, env, rec, tick: (ms: number) => (nowMs += ms) };
  }
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('会话开始：改前内容入快照（重启后从库取），随后 lastKnown 更新为新内容', async () => {
    const { store, env } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await settle();
    expect(store.addCalls).toEqual([{ path: 'a.md', ts: 1_000_000, data: 'v1' }]);
    // 注意：advanceTimers 只推进计时器，不推进注入的 now（nowMs 不变），会话结束的 ts 仍是 1_000_000
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1); // 静默满阈值 → 会话结束
    expect(store.addCalls).toEqual([
      { path: 'a.md', ts: 1_000_000, data: 'v1' },
      { path: 'a.md', ts: 1_000_000, data: 'v2' },
    ]);
  });

  it('阈值内连续 modify 不重复写改前快照；计时器随每次修改重置', async () => {
    const { store, env, tick } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await settle();
    tick(30_000);
    env.fire('modify', mdFile('a.md'));
    await settle();
    tick(30_000);
    env.fire('modify', mdFile('a.md')); // 距上次仅 30s，仍在同一会话内
    await settle();
    expect(store.addCalls.filter(c => c.data === 'v1')).toHaveLength(1);
    // 只在最后一次 modify 后静默满阈值才写会话结束快照
    await vi.advanceTimersByTimeAsync(50_000);
    expect(store.addCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(THRESHOLD);
    expect(store.addCalls).toHaveLength(2);
    expect(store.addCalls[1].data).toBe('v2');
  });

  it('新会话再次编辑：改前内容=上次会话结束内容，去重闸门挡掉重复写入', async () => {
    const { store, env, tick } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1); // 会话结束：v2 入库
    tick(2 * 60 * 60 * 1000); // 两小时后再编辑
    env.fire('modify', mdFile('a.md'));
    await settle();
    expect(store.addCalls).toHaveLength(3); // 第三次 add 被调用……
    expect(store.entries).toHaveLength(2); // ……但内容与最新条相同，未真正写入
  });

  it('本会话内已知内容直接来自内存：改前快照取上次 modify 的内容而非库里旧值', async () => {
    let disk = 'v2';
    const { store, env, tick } = setup(() => disk, [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    env.fire('modify', mdFile('a.md'));
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1); // 会话结束：v2 入库
    disk = 'v3';
    tick(120_000);
    env.fire('modify', mdFile('a.md')); // 新会话：改前应取内存里的 v2
    await settle();
    expect(store.addCalls.at(-1)!.data).toBe('v2');
  });

  it('create：新建文件立即写初始快照', async () => {
    const { store, env } = setup(() => 'v1');
    env.fire('create', mdFile('new.md'));
    await settle();
    expect(store.entries).toEqual([{ path: 'new.md', ts: 1_000_000, data: 'v1' }]);
  });

  it('rename：迁移库记录并同步内存键', async () => {
    const { store, env, tick } = setup(() => 'v2');
    env.fire('create', mdFile('old.md'));
    await settle();
    env.fire('rename', mdFile('new.md'), 'old.md');
    await settle();
    expect(store.migrateCalls).toEqual([{ oldPath: 'old.md', newPath: 'new.md' }]);
    await expect(store.getEntries('new.md')).resolves.toHaveLength(1);
    await expect(store.getEntries('old.md')).resolves.toHaveLength(0);
    tick(120_000);
    env.fire('modify', mdFile('new.md')); // 新路径继续编辑
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1);
    // 会话结束写 v2，全部记录都应在新路径下
    expect(store.entries.every(e => e.path === 'new.md')).toBe(true);
  });

  it('非 md 文件忽略', async () => {
    const { store, env } = setup(() => 'x');
    env.fire('modify', { path: 'a.png', extension: 'png' } as unknown as TFile);
    env.fire('modify', { path: 'folder' } as unknown as TFile); // 无 extension（文件夹）
    await settle();
    expect(store.addCalls).toHaveLength(0);
  });

  it('vault.read 失败吞掉，不产生 unhandled rejection', async () => {
    const { store, env } = setup(() => {
      throw new Error('disk gone');
    });
    env.fire('modify', mdFile('a.md'));
    // recorder 若把 read 的 rejection 逃逸出去，vitest 会以 unhandled rejection 报错本用例
    await settle();
    await vi.advanceTimersByTimeAsync(THRESHOLD + 1);
    expect(store.addCalls).toHaveLength(0);
  });

  it('dispose：清计时器、尽力 flush lastKnown、注销全部事件', async () => {
    const { store, env, rec } = setup(() => 'v2', [{ path: 'a.md', ts: 900_000, data: 'v1' }]);
    const before = env.registeredRefs();
    env.fire('modify', mdFile('a.md'));
    await settle();
    rec.dispose();
    await vi.advanceTimersByTimeAsync(10 * THRESHOLD); // 计时器已清，不再有会话结束写入
    expect(store.addCalls).toHaveLength(2); // 改前 v1 + dispose flush 的 v2
    expect(env.registeredRefs()).toBe(before - 3);
  });
});
