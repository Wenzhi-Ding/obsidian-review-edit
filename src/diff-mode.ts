import type { App, MarkdownView, Plugin, TFile } from 'obsidian';
import { computeHunks, type DiffHunk } from './diff-engine';
import type { SnapshotEntry } from './snapshot-source';
import {
  READONLY_OFF,
  READONLY_ON,
  diffHunkField,
  readonlyCompartment,
  setDiffHandlers,
  setHunksEffect,
} from './cm-extension';
import type { EditorView } from '@codemirror/view';

interface Session {
  view: MarkdownView;
  file: TFile;
  baseline: SnapshotEntry;
  hunks: DiffHunk[];
}

export class DiffModeController {
  private session: Session | null = null;

  constructor(private app: App, private plugin: Plugin) {}

  isActive(): boolean {
    return this.session !== null;
  }

  async enter(view: MarkdownView, baseline: SnapshotEntry): Promise<boolean> {
    if (this.session) this.exit();
    const file = view.file;
    if (!file) return false;
    const hunks = computeHunks(baseline.data, view.editor.getValue());
    if (hunks.length === 0) return false;
    this.session = { view, file, baseline, hunks };
    setDiffHandlers({
      onHunkAction: (id, action) => (action === 'keep' ? this.keep(id) : this.reject(id)),
      onExit: () => this.exit(),
    });
    const cm = (view.editor as any).cm as EditorView;
    cm.dispatch({
      effects: [setHunksEffect.of(hunks), readonlyCompartment.reconfigure(READONLY_ON)],
    });
    return true;
  }

  keep(_id: number): void {
    // Task 6 填充
  }

  reject(_id: number): void {
    // Task 6 填充
  }

  exit(): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    setDiffHandlers(null);
    const cm = (s.view.editor as any).cm as EditorView;
    if (cm.state.field(diffHunkField, false)) {
      cm.dispatch({
        effects: [setHunksEffect.of(null), readonlyCompartment.reconfigure(READONLY_OFF)],
      });
    }
  }
}
