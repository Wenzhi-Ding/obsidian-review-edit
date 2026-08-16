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
      currentFrom: 1, currentTo: 2, currentText: 'X', baselineText: ''
    });
  });

  it('纯删除行（currentFrom === currentTo）', () => {
    const hunks = computeHunks('a\nX\nb', 'a\nb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'removed', currentFrom: 1, currentTo: 1, currentText: '', baselineText: 'X'
    });
  });

  it('修改行（同位置先删后增）', () => {
    const hunks = computeHunks('a\nb\nc', 'a\nB\nc');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      type: 'changed', currentFrom: 1, currentTo: 2, currentText: 'B', baselineText: 'b'
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
});

const hunk = (over: Partial<DiffHunk>): DiffHunk => ({
  id: 0, status: 'pending', type: 'changed',
  currentFrom: 0, currentTo: 0, currentText: '', baselineText: '',
  ...over,
});

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

  it('末尾新增块撤销（文档有尾换行）', () => {
    const spec = revertEditSpec(
      EditorState.create({ doc: 'a\nb\nc\n' }).doc,
      hunk({ type: 'added', currentFrom: 2, currentTo: 3, currentText: 'c' })
    );
    expect(apply('a\nb\nc\n', spec)).toBe('a\nb\n');
  });
});
