// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  READONLY_OFF,
  READONLY_ON,
  diffExtension,
  readonlyCompartment,
  setHunksEffect,
} from '../src/cm-extension';
import type { DiffHunk } from '../src/diff-engine';

const hunk = (over: Partial<DiffHunk>): DiffHunk => ({
  id: 0, status: 'pending', type: 'changed',
  currentFrom: 0, currentTo: 0, currentText: '', baselineText: '', baselineLines: 0,
  ...over,
});

let view: EditorView | null = null;

function mount(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [diffExtension, readonlyCompartment.of([])] }),
    parent,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = '';
});

describe('diffExtension 在真实 EditorView 上的冒烟', () => {
  it('下发块级装饰（删除行 + 工具条）不抛 RangeError', () => {
    const v = mount('a\nX\nb');
    expect(() =>
      v.dispatch({
        effects: setHunksEffect.of([
          hunk({ id: 0, type: 'changed', currentFrom: 1, currentTo: 2, currentText: 'X', baselineText: 'old', baselineLines: 1 }),
        ]),
      })
    ).not.toThrow();
    expect(v.dom.querySelectorAll('.review-edit-deleted').length).toBe(1);
    expect(v.dom.querySelectorAll('.review-edit-toolbar').length).toBe(1);
  });

  it('文件末尾的纯删除块仍渲染红块与工具条', () => {
    const v = mount('a\nb');
    v.dispatch({
      effects: setHunksEffect.of([
        hunk({ id: 0, type: 'removed', currentFrom: 2, currentTo: 2, baselineText: 'X', baselineLines: 1 }),
      ]),
    });
    expect(v.dom.querySelectorAll('.review-edit-deleted').length).toBe(1);
    expect(v.dom.querySelectorAll('.review-edit-toolbar').length).toBe(1);
  });

  it('模拟撤销：changes + setHunksEffect 同事务下发不抛错', () => {
    const v = mount('a\nX\nb');
    v.dispatch({
      effects: setHunksEffect.of([
        hunk({ id: 0, type: 'added', currentFrom: 1, currentTo: 2, currentText: 'X' }),
      ]),
    });
    expect(() =>
      v.dispatch({
        changes: { from: 2, to: 4, insert: '' },
        effects: setHunksEffect.of([]),
      })
    ).not.toThrow();
    expect(v.state.doc.toString()).toBe('a\nb');
    expect(v.dom.querySelectorAll('.review-edit-toolbar').length).toBe(0);
  });

  it('退出：清空 hunks + READONLY_OFF 后可编辑性恢复', () => {
    const v = mount('a\nX\nb');
    v.dispatch({
      effects: [
        setHunksEffect.of([hunk({ id: 0, type: 'added', currentFrom: 1, currentTo: 2, currentText: 'X' })]),
        readonlyCompartment.reconfigure(READONLY_ON),
      ],
    });
    // jsdom 未实现 contentEditable IDL 属性，改查属性值
    expect(v.contentDOM.getAttribute('contenteditable')).toBe('false');
    v.dispatch({
      effects: [setHunksEffect.of(null), readonlyCompartment.reconfigure(READONLY_OFF)],
    });
    expect(v.contentDOM.getAttribute('contenteditable')).toBe('true');
    expect(v.dom.querySelectorAll('.review-edit-toolbar').length).toBe(0);
  });
});
