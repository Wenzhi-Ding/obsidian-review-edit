import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view';
import type { DiffHunk } from './diff-engine';

export const setHunksEffect = StateEffect.define<DiffHunk[] | null>();

export const diffHunkField = StateField.define<DiffHunks | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHunksEffect)) return e.value;
    }
    return value;
  },
});
type DiffHunks = DiffHunk[];

type DiffHandlers = {
  onHunkAction(id: number, action: 'keep' | 'reject'): void;
  onExit(): void;
};

let handlers: DiffHandlers | null = null;
export function setDiffHandlers(h: DiffHandlers | null) {
  handlers = h;
}

class DeletedLinesWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletedLinesWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const wrap = createDiv({ cls: 'review-edit-deleted' });
    for (const line of this.text.split('\n')) {
      wrap.appendChild(createDiv({ text: line === '' ? '\u00A0' : line }));
    }
    return wrap;
  }
}

class ToolbarWidget extends WidgetType {
  constructor(readonly hunkId: number) {
    super();
  }
  eq(other: ToolbarWidget) {
    return other.hunkId === this.hunkId;
  }
  toDOM() {
    const wrap = createDiv({ cls: 'review-edit-toolbar' });
    const keep = createEl('button', { cls: 'review-edit-btn keep', text: '保留 ✓' });
    keep.onclick = (e) => {
      e.preventDefault();
      handlers?.onHunkAction(this.hunkId, 'keep');
    };
    const reject = createEl('button', { cls: 'review-edit-btn reject', text: '撤销 ✕' });
    reject.onclick = (e) => {
      e.preventDefault();
      handlers?.onHunkAction(this.hunkId, 'reject');
    };
    wrap.appendChild(keep);
    wrap.appendChild(reject);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const hunks = state.field(diffHunkField);
  if (!hunks) return Decoration.none;
  const doc = state.doc;
  const ranges = [];
  for (const h of hunks) {
    // 纯删除块落在文件末尾时 currentFrom 越界：锚点必须取 doc.length（文档末尾），
    // 取 doc.line(doc.lines).from 会渲染在最后一行之前并让 CM6 多插一条幻影空行
    const atEof = h.currentFrom >= doc.lines;
    const startPos = atEof ? doc.length : doc.line(h.currentFrom + 1).from;
    if (h.status === 'pending') {
      for (let i = h.currentFrom; i < h.currentTo && i < doc.lines; i++) {
        ranges.push(Decoration.line({ class: 'review-edit-line-added' }).range(doc.line(i + 1).from));
      }
      ranges.push(
        Decoration.widget({ widget: new ToolbarWidget(h.id), block: true, side: atEof ? 999 : -1000 }).range(startPos)
      );
      if (h.baselineLines > 0) {
        ranges.push(
          Decoration.widget({
            widget: new DeletedLinesWidget(h.baselineText),
            block: true,
            side: atEof ? 1000 : -999,
          }).range(startPos)
        );
      }
    } else {
      for (let i = h.currentFrom; i < h.currentTo && i < doc.lines; i++) {
        ranges.push(Decoration.line({ class: 'review-edit-line-kept' }).range(doc.line(i + 1).from));
      }
    }
  }
  return Decoration.set(ranges, true);
}

// 块级装饰不允许由动态 decorations 输入（plugin/函数）提供，CM6 会抛
// RangeError: Block decorations may not be specified via plugins，故必须走 StateField。
const diffDecorationField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (value, tr) =>
    tr.docChanged || tr.effects.some((e) => e.is(setHunksEffect)) ? buildDecorations(tr.state) : value,
  provide: (f) => EditorView.decorations.from(f),
});

export const readonlyCompartment = new Compartment();
export const READONLY_ON: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
export const READONLY_OFF: Extension = [];

export const diffExtension: Extension = [
  // diffDecorationField 必须列在 diffHunkField 之后：update 时要读 tr.state.field(diffHunkField)
  diffHunkField,
  diffDecorationField,
  keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        if (view.state.field(diffHunkField)) {
          handlers?.onExit();
          return true;
        }
        return false;
      },
    },
  ]),
];
