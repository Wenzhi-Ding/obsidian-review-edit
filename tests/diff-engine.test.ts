import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { computeHunks, revertEditSpec, shiftAfterReject, type DiffHunk } from '../src/diff-engine';

describe('computeHunks', () => {
  it('内容相同返回空数组', () => {
    expect(computeHunks('a\nb', 'a\nb')).toEqual([]);
  });

  it('纯新增行', () => {
    const hunks = computeHunks('a\nb', 'a\nX\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      id: 0, status: 'pending', type: 'added',
      currentFrom: 1, currentTo: 2, currentText: 'X', baselineText: '', baselineLines: 0
    });
  });

  it('纯删除行（currentFrom === currentTo）', () => {
    const hunks = computeHunks('a\nX\nb', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'removed', currentFrom: 1, currentTo: 1, currentText: '', baselineText: 'X', baselineLines: 1
    });
  });

  it('修改行（同位置先删后增）', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nB\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'changed', currentFrom: 1, currentTo: 2, currentText: 'B', baselineText: 'b', baselineLines: 1
    });
  });

  it('多个差异块行号各自正确', () => {
    const hunks = computeHunks('1\n2\n3\n4\n5', '1\nT\n3\n4\n5\n6');
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ currentFrom: 1, currentTo: 2, type: 'changed' });
    expect(hunks[1]).toMatchObject({ type: 'added', currentFrom: 5, currentTo: 6, currentText: '6' });
  });

  it('基准为空串时全文都是新增', () => {
    const hunks = computeHunks('', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ type: 'added', currentFrom: 0, currentTo: 2 });
  });

  it('仅尾部换行差异不产生差异块', () => {
    expect(computeHunks('a\nb', 'a\nb\n')).toEqual([]);
  });

  it('CRLF 与 LF 混用不产生伪差异', () => {
    expect(computeHunks('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
    expect(computeHunks('a\r\nb\r\nc\r\n', 'a\nb\nc')).toEqual([]);
  });

  it('CRLF 基准与 LF 当前内容只有真实改动行产生差异块', () => {
    const baseline = '| 表头 |\r\n|---|\r\n| 旧行 |\r\n';
    const current = '| 表头 |\n|---|\n| 新行 |\n';
    const hunks = computeHunks(baseline, current);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'changed', currentFrom: 2, currentTo: 3,
      currentText: '| 新行 |', baselineText: '| 旧行 |',
    });
  });

  it('新增一个空行：得 added 块（baselineLines 为 0）', () => {
    const hunks = computeHunks('a\nb', 'a\n\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'added', currentFrom: 1, currentTo: 2, currentText: '', baselineText: '', baselineLines: 0,
    });
  });

  it('删除一个空行：得 removed 块且 baselineLines 为 1', () => {
    const hunks = computeHunks('a\n\nb', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'removed', currentFrom: 1, currentTo: 1, currentText: '', baselineText: '', baselineLines: 1,
    });
  });
});

// baselineLines 未显式给出时由 baselineText 推导（空串 = 无删除）；空行场景需显式传入
const hunk = (over: Partial<DiffHunk>): DiffHunk => {
  const base: DiffHunk = {
    id: 0, status: 'pending', type: 'changed',
    currentFrom: 0, currentTo: 0, currentText: '', baselineText: '', baselineLines: 0,
    ...over,
  };
  return over.baselineLines === undefined
    ? { ...base, baselineLines: base.baselineText === '' ? 0 : base.baselineText.split('\n').length }
    : base;
};

const apply = (docText: string, spec: { from: number; to: number; insert: string }): string =>
  EditorState.create({ doc: docText }).update({ changes: spec }).state.doc.toString();

describe('shiftAfterReject', () => {
  it('撤销删除块后，后续块行号下移（delta 为正）', () => {
    const hunks = [
      hunk({ id: 0, type: 'removed', currentFrom: 1, currentTo: 1, baselineText: 'X\nY' }),
      hunk({ id: 1, currentFrom: 3, currentTo: 4, currentText: 't', baselineText: 'u' }),
      hunk({ id: 2, currentFrom: 0, currentTo: 1, currentText: 'a', baselineText: 'A' }),
    ];
    const out = shiftAfterReject(hunks, 0);
    expect(out.map(h => h.id)).toEqual([1, 2]);
    expect(out.find(h => h.id === 1)).toMatchObject({ currentFrom: 5, currentTo: 6 });
    expect(out.find(h => h.id === 2)).toMatchObject({ currentFrom: 0, currentTo: 1 });
  });

  it('撤销新增块后，后续块行号上移（delta 为负）', () => {
    const hunks = [
      hunk({ id: 0, type: 'added', currentFrom: 1, currentTo: 3, currentText: 'p\nq' }),
      hunk({ id: 1, currentFrom: 3, currentTo: 4, currentText: 't', baselineText: 'u' }),
    ];
    const out = shiftAfterReject(hunks, 0);
    expect(out[0]).toMatchObject({ currentFrom: 1, currentTo: 2 });
  });

  it('id 不存在时原样返回', () => {
    const hunks = [hunk({ id: 0 })];
    expect(shiftAfterReject(hunks, 99)).toBe(hunks);
  });
});

describe('revertEditSpec', () => {
  it('文件中间的删除块：在原位插回旧行', () => {
    const doc = EditorState.create({ doc: 'a\nb' }).doc;
    const spec = revertEditSpec(doc, hunk({ type: 'removed', currentFrom: 1, currentTo: 1, baselineText: 'X' }));
    expect(apply('a\nb', spec)).toBe('a\nX\nb');
  });

  it('文件中间的修改块：替换回旧文本', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nB\nc' }).doc,
      hunk({ type: 'changed', currentFrom: 1, currentTo: 2, baselineText: 'b' })
    );
    expect(apply('a\nB\nc', spec)).toBe('a\nb\nc');
  });

  it('文件中间的新增块：整块删除', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nX\nb' }).doc,
      hunk({ type: 'added', currentFrom: 1, currentTo: 2, currentText: 'X' })
    );
    expect(apply('a\nX\nb', spec)).toBe('a\nb');
  });

  it('末尾修改块且文档无尾换行：不加多余换行', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nB' }).doc,
      hunk({ type: 'changed', currentFrom: 1, currentTo: 2, baselineText: 'b' })
    );
    expect(apply('a\nB', spec)).toBe('a\nb');
  });

  it('末尾删除块：把旧行追加到文件尾并补换行', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nb' }).doc,
      hunk({ type: 'removed', currentFrom: 2, currentTo: 2, baselineText: 'X' })
    );
    expect(apply('a\nb', spec)).toBe('a\nb\nX');
  });

  it('末尾修改块且文档有尾换行：保持尾换行', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nB\n' }).doc,
      hunk({ type: 'changed', currentFrom: 1, currentTo: 2, baselineText: 'b' })
    );
    expect(apply('a\nB\n', spec)).toBe('a\nb\n');
  });

  it('基准侧为空行的修改块：全部撤销后还原空行', () => {
    const baseline = 'a\n\nb';
    const current = 'a\nX\nb';
    const hunks = computeHunks(baseline, current);
    expect(hunks).toHaveLength(1);
    let doc = EditorState.create({ doc: current }).doc;
    for (const h of hunks) {
      doc = EditorState.create({ doc }).update({ changes: revertEditSpec(doc, h) }).state.doc;
    }
    expect(doc.toString()).toBe(baseline);
  });

  it('末尾新增块撤销（文档有尾换行）', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nb\nc\n' }).doc,
      hunk({ type: 'added', currentFrom: 2, currentTo: 3, currentText: 'c' })
    );
    expect(apply('a\nb\nc\n', spec)).toBe('a\nb\n');
  });

  it('CRLF 基准撤销时插入 LF 文本（与编辑器一致）', () => {
    const hunks = computeHunks('a\r\nX\r\nb\r\n', 'a\nb\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].baselineText).not.toContain('\r');
    const spec = revertEditSpec(EditorState.create({ doc: 'a\nb\n' }).doc, hunks[0]);
    expect(apply('a\nb\n', spec)).toBe('a\nX\nb\n');
  });
});
