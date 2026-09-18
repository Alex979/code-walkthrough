export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
  old?: number;
  next?: number;
}

export interface LineComparison {
  rows: DiffLine[];
  /** Some spans use an exact remove/add replacement instead of a minimal diff. */
  coarse: boolean;
}

interface Span {
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
}

interface Anchor {
  before: number;
  after: number;
}

const LCS_CELL_BUDGET = 3_000_000;

function sourceLines(source: string): string[] {
  if (!source) {
    return [];
  }
  return source.replaceAll("\r\n", "\n").replace(/\n$/, "").split("\n");
}

function uniquePositions(lines: string[], start: number, end: number): Map<string, number> {
  const positions = new Map<string, number>();
  for (let index = start; index < end; index++) {
    const text = lines[index];
    positions.set(text, positions.has(text) ? -1 : index);
  }
  return positions;
}

// Unique lines identify stable landmarks in structured files. An increasing
// subsequence preserves source order when blocks have moved past one another.
function patienceAnchors(before: string[], after: string[], span: Span): Anchor[] {
  const beforePositions = uniquePositions(before, span.beforeStart, span.beforeEnd);
  const afterPositions = uniquePositions(after, span.afterStart, span.afterEnd);
  const candidates: Anchor[] = [];
  for (const [text, beforeIndex] of beforePositions) {
    const afterIndex = afterPositions.get(text);
    if (beforeIndex >= 0 && afterIndex !== undefined && afterIndex >= 0) {
      candidates.push({ before: beforeIndex, after: afterIndex });
    }
  }

  const tails: number[] = [];
  const predecessors = new Int32Array(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]].after < candidates[index].after) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      predecessors[index] = tails[low - 1];
    }
    tails[low] = index;
  }

  const anchors: Anchor[] = [];
  let index = tails.at(-1) ?? -1;
  while (index >= 0) {
    anchors.push(candidates[index]);
    index = predecessors[index];
  }
  return anchors.reverse();
}

function appendExactDiff(before: string[], after: string[], span: Span, rows: DiffLine[]): void {
  const beforeLength = span.beforeEnd - span.beforeStart;
  const afterLength = span.afterEnd - span.afterStart;
  const width = afterLength + 1;
  const table = new Uint32Array((beforeLength + 1) * width);

  for (let old = beforeLength - 1; old >= 0; old--) {
    for (let next = afterLength - 1; next >= 0; next--) {
      const cell = old * width + next;
      if (before[span.beforeStart + old] === after[span.afterStart + next]) {
        table[cell] = table[(old + 1) * width + next + 1] + 1;
      } else {
        table[cell] = Math.max(table[(old + 1) * width + next], table[cell + 1]);
      }
    }
  }

  let old = span.beforeStart;
  let next = span.afterStart;
  while (old < span.beforeEnd || next < span.afterEnd) {
    const hasBefore = old < span.beforeEnd;
    const hasAfter = next < span.afterEnd;
    const cell = (old - span.beforeStart) * width + next - span.afterStart;
    if (hasBefore && hasAfter && before[old] === after[next]) {
      rows.push({ kind: "same", text: before[old], old: old + 1, next: next + 1 });
      old++;
      next++;
    } else if (hasAfter && (!hasBefore || table[cell + 1] > table[cell + width])) {
      rows.push({ kind: "add", text: after[next], next: next + 1 });
      next++;
    } else {
      // Keep replacements deterministic: equal LCS lengths remove before adding.
      rows.push({ kind: "remove", text: before[old], old: old + 1 });
      old++;
    }
  }
}

/**
 * Compare complete sources with bounded quadratic work. Large spans are split
 * at ordered unique lines; small spans retain the original LCS tie-breaking.
 * If no affordable alignment remains, emit both spans verbatim as a replacement.
 * That fallback is deliberately coarse, but never loses source or line numbers.
 */
export function compareLines(before: string, after: string): LineComparison {
  const beforeLines = sourceLines(before);
  const afterLines = sourceLines(after);
  const rows: DiffLine[] = [];
  const pending: Span[] = [
    {
      beforeStart: 0,
      beforeEnd: beforeLines.length,
      afterStart: 0,
      afterEnd: afterLines.length,
    },
  ];
  let remainingCells = LCS_CELL_BUDGET;
  // Nested partitions must not repeatedly rescan almost the entire input.
  // The explicit stack also avoids call-stack limits for adversarial orderings.
  let remainingScans = (beforeLines.length + afterLines.length) * 8;
  let coarse = false;

  while (pending.length > 0) {
    const span = pending.pop()!;
    while (
      span.beforeStart < span.beforeEnd &&
      span.afterStart < span.afterEnd &&
      beforeLines[span.beforeStart] === afterLines[span.afterStart]
    ) {
      rows.push({
        kind: "same",
        text: beforeLines[span.beforeStart],
        old: span.beforeStart + 1,
        next: span.afterStart + 1,
      });
      span.beforeStart++;
      span.afterStart++;
    }

    const beforeEnd = span.beforeEnd;
    const afterEnd = span.afterEnd;
    while (
      span.beforeEnd > span.beforeStart &&
      span.afterEnd > span.afterStart &&
      beforeLines[span.beforeEnd - 1] === afterLines[span.afterEnd - 1]
    ) {
      span.beforeEnd--;
      span.afterEnd--;
    }
    if (span.beforeEnd < beforeEnd) {
      pending.push({
        beforeStart: span.beforeEnd,
        beforeEnd,
        afterStart: span.afterEnd,
        afterEnd,
      });
    }

    const beforeLength = span.beforeEnd - span.beforeStart;
    const afterLength = span.afterEnd - span.afterStart;
    const cells = (beforeLength + 1) * (afterLength + 1);
    if (beforeLength > 0 && afterLength > 0 && cells <= remainingCells) {
      remainingCells -= cells;
      appendExactDiff(beforeLines, afterLines, span, rows);
      continue;
    }

    if (beforeLength > 0 && afterLength > 0) {
      const scanSize = beforeLength + afterLength;
      if (scanSize <= remainingScans) {
        remainingScans -= scanSize;
        const anchors = patienceAnchors(beforeLines, afterLines, span);
        if (anchors.length > 0) {
          let oldEnd = span.beforeEnd;
          let nextEnd = span.afterEnd;
          for (let index = anchors.length - 1; index >= 0; index--) {
            const anchor = anchors[index];
            pending.push({
              beforeStart: anchor.before + 1,
              beforeEnd: oldEnd,
              afterStart: anchor.after + 1,
              afterEnd: nextEnd,
            });
            pending.push({
              beforeStart: anchor.before,
              beforeEnd: anchor.before + 1,
              afterStart: anchor.after,
              afterEnd: anchor.after + 1,
            });
            oldEnd = anchor.before;
            nextEnd = anchor.after;
          }
          pending.push({ ...span, beforeEnd: oldEnd, afterEnd: nextEnd });
          continue;
        }
      }
      coarse = true;
    }

    for (let index = span.beforeStart; index < span.beforeEnd; index++) {
      rows.push({ kind: "remove", text: beforeLines[index], old: index + 1 });
    }
    for (let index = span.afterStart; index < span.afterEnd; index++) {
      rows.push({ kind: "add", text: afterLines[index], next: index + 1 });
    }
  }

  return { rows, coarse };
}

export function diffLines(before: string, after: string): DiffLine[] {
  return compareLines(before, after).rows;
}
