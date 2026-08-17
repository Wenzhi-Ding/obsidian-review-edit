import type { Text } from '@codemirror/state';
import { diffLines } from 'diff';

export type HunkStatus = 'pending' | 'kept';
export type HunkType = 'added' | 'removed' | 'changed';

export interface DiffHunk {
  id: number;
  status: HunkStatus;
  type: HunkType;
  /** 当前文档 0-based 起始行（含） */
  currentFrom: number;
  /** 当前文档 0-based 结束行（不含）；纯删除块 currentFrom === currentTo */
  currentTo: number;
  currentText: string;
  baselineText: string;
  /** 基准侧行数；空行计 1，无删除计 0（不可用 baselineText 判空） */
  baselineLines: number;
}

const countLines = (v: string): number =>
  v === '' ? 0 : v.split('\n').length - (v.endsWith('\n') ? 1 : 0);

const stripTrailingNewline = (v: string): string =>
  v.endsWith('\n') ? v.slice(0, -1) : v;

// diffLines 按“含换行符的行”切分；末行缺换行时 "5" 与 "5\n" 不匹配，
// 会生成伪差异块，故先补全末尾换行再比较。
const normalizeEnding = (v: string): string =>
  v === '' || v.endsWith('\n') ? v : v + '\n';

export function computeHunks(baseline: string, current: string): DiffHunk[] {
  const parts = diffLines(normalizeEnding(baseline), normalizeEnding(current));
  const hunks: DiffHunk[] = [];
  let line = 0;
  let id = 0;
  for (let i = 0; i < parts.length; ) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      line += countLines(part.value);
      i += 1;
      continue;
    }
    const removedPart = part.removed ? part : null;
    const addedPart = part.added ? part : parts[i + 1]?.added ? parts[i + 1] : null;
    const removedText = removedPart ? stripTrailingNewline(removedPart.value) : '';
    const addedText = addedPart ? stripTrailingNewline(addedPart.value) : '';
    const removedCount = removedPart ? countLines(removedPart.value) : 0;
    const addedCount = addedPart ? countLines(addedPart.value) : 0;
    // 只差一个尾换行时 diff 可能给出空文本段，跳过；
    // 用行数而非文本判空，否则基准侧的空行会被当成「无删除」
    if (removedCount > 0 || addedCount > 0) {
      hunks.push({
        id: id++,
        status: 'pending',
        type: removedCount && addedCount ? 'changed' : removedCount ? 'removed' : 'added',
        currentFrom: line,
        currentTo: line + addedCount,
        currentText: addedText,
        baselineText: removedText,
        baselineLines: removedCount,
      });
    }
    line += addedCount;
    i += removedPart && addedPart ? 2 : 1;
  }
  return hunks;
}

export function shiftAfterReject(hunks: DiffHunk[], rejectedId: number): DiffHunk[] {
  const rejected = hunks.find(h => h.id === rejectedId);
  if (!rejected) return hunks;
  const delta = rejected.baselineLines - (rejected.currentTo - rejected.currentFrom);
  return hunks
    .filter(h => h.id !== rejectedId)
    .map(h =>
      h.currentFrom >= rejected.currentTo
        ? { ...h, currentFrom: h.currentFrom + delta, currentTo: h.currentTo + delta }
        : h
    );
}

export function revertEditSpec(doc: Text, h: DiffHunk): { from: number; to: number; insert: string } {
  const from = h.currentFrom < doc.lines ? doc.line(h.currentFrom + 1).from : doc.length;
  const atEof = h.currentTo >= doc.lines;
  const to = atEof ? doc.length : doc.line(h.currentTo + 1).from;
  if (h.currentFrom >= doc.lines) {
    // 纯删除块落在文档末尾：把基准行追加到文件尾部
    const endsWithNewline = doc.length > 0 && doc.sliceString(doc.length - 1) === '\n';
    const lead = doc.length > 0 && !endsWithNewline && h.baselineLines > 0 ? '\n' : '';
    return { from, to, insert: lead + h.baselineText };
  }
  if (h.baselineLines === 0) return { from, to, insert: '' };
  const endsWithNewline = doc.length > 0 && doc.sliceString(doc.length - 1) === '\n';
  const insert = atEof && !endsWithNewline ? h.baselineText : h.baselineText + '\n';
  return { from, to, insert };
}
