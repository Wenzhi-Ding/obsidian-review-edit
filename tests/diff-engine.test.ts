import { describe, expect, it } from 'vitest';
import { computeHunks } from '../src/diff-engine';

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
});
