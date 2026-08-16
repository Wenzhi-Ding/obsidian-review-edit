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
    const addedCount = addedPart ? countLines(addedPart.value) : 0;
    // 只差一个尾换行时 diff 可能给出空文本段，跳过
    if (removedText !== '' || addedText !== '') {
      hunks.push({
        id: id++,
        status: 'pending',
        type: removedText && addedText ? 'changed' : removedText ? 'removed' : 'added',
        currentFrom: line,
        currentTo: line + addedCount,
        currentText: addedText,
        baselineText: removedText,
      });
    }
    line += addedCount;
    i += removedPart && addedPart ? 2 : 1;
  }
  return hunks;
}
