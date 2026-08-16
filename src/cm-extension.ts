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
    const wrap = document.createElement('div');
    wrap.className = 'review-edit-deleted';
    for (const line of this.text.split('\n')) {
      const div = document.createElement('div');
      div.textContent = line === '' ? '\u00A0' : line;
      wrap.appendChild(div);
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
    const wrap = document.createElement('div');
    wrap.className = 'review-edit-toolbar';
    const keep = document.createElement('button');
    keep.className = 'review-edit-btn keep';
    keep.textContent = '保留 ✓';
    keep.onclick = (e) => {
      e.preventDefault();
      handlers?.onHunkAction(this.hunkId, 'keep');
    };
    const reject = document.createElement('button');
    reject.className = 'review-edit-btn reject';
    reject.textContent = '撤销 ✕';
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

function buildDecorations(view: EditorView): DecorationSet {
  const hunks = view.state.field(diffHunkField);
  if (!hunks) return Decoration.none;
  const doc = view.state.doc;
  const ranges = [];
  for (const h of hunks) {
    if (h.currentFrom >= doc.lines) continue; // 行号已越界，跳过防护
    const startPos = doc.line(h.currentFrom + 1).from;
    if (h.status === 'pending') {
      for (let i = h.currentFrom; i < h.currentTo && i < doc.lines; i++) {
        ranges.push(Decoration.line({ class: 'review-edit-line-added' }).range(doc.line(i + 1).from));
      }
      ranges.push(
        Decoration.widget({ widget: new ToolbarWidget(h.id), block: true, side: -1000 }).range(startPos)
      );
      if (h.baselineText !== '') {
        ranges.push(
          Decoration.widget({ widget: new DeletedLinesWidget(h.baselineText), block: true, side: -999 }).range(startPos)
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

export const readonlyCompartment = new Compartment();
export const READONLY_ON: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
export const READONLY_OFF: Extension = [];

export const diffExtension: Extension = [
  diffHunkField,
  EditorView.decorations.of((view) => buildDecorations(view)),
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
