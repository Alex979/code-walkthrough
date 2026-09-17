import type {
  Change,
  FileInfo,
  SourceLink,
  Step,
  Version,
} from "../../skills/code-walkthrough/scripts/types";

let steps: Step[] = [];

export type DisplayMode = "file" | "diff" | "changes";

export function configureLesson(value: Step[]): void {
  steps = value;
}

// Changes are cumulative full-file replacements. The latest entry wins, even
// when navigating backward. Undefined means use the baseline; null deletes it.
export function changeAt(path: string, index: number): Change | undefined {
  for (let stepIndex = Math.min(index, steps.length - 1); stepIndex >= 0; stepIndex--) {
    const changes = steps[stepIndex].changes;
    if (Object.hasOwn(changes ?? {}, path)) {
      return changes![path];
    }
  }

  return undefined;
}

export function fileExists(file: FileInfo, index: number, version: Version): boolean {
  if (version !== "step") {
    return Boolean(file[version]);
  }

  const change = changeAt(file.path, index);
  if (change === null) {
    return false;
  }
  if (change === undefined) {
    return Boolean(file.base);
  }
  if ("text" in change) {
    return true;
  }

  return Boolean(file.head);
}

export function fileStatus(file: FileInfo, index: number, version: Version): FileInfo["status"] {
  if (!fileExists(file, index, version) || version === "base") {
    return "";
  }
  if (version === "head") {
    return file.status;
  }

  const change = changeAt(file.path, index);
  if (change === undefined) {
    return "";
  }
  if (change && "use" in change) {
    return file.status;
  }

  return file.base ? "M" : "A";
}

export function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export function sourceAtStep(
  path: string,
  index: number,
  before?: string,
  after?: string,
): string | undefined {
  const change = changeAt(path, index);
  let source: string | undefined;

  if (change === null) {
    return undefined;
  }
  if (change === undefined) {
    source = before;
  } else if ("text" in change) {
    source = change.text;
  } else {
    source = after;
  }

  return source === undefined ? undefined : normalize(source);
}

type FocusTarget = Pick<SourceLink, "start" | "end" | "symbol" | "count"> & {
  focus?: [number, number];
};

export function resolveFocus(text: string, target: FocusTarget): [number, number] | undefined {
  const lines = normalize(text).split("\n");

  // Resolve symbols against the selected version, before explicit line ranges.
  // A missing symbol intentionally does not fall back to a potentially stale range.
  if (target.symbol) {
    const matchIndex = lines.findIndex((line) => line.includes(target.symbol!));
    if (matchIndex < 0) {
      return undefined;
    }

    const firstLine = matchIndex + 1;
    const lastLine = Math.min(lines.length, matchIndex + (target.count ?? 1));
    return [firstLine, lastLine];
  }
  if (target.focus) {
    return target.focus;
  }
  if (target.start) {
    return [target.start, target.end ?? target.start];
  }

  return undefined;
}

interface LocationState {
  step: number;
  path?: string;
  version?: Version;
  focus?: [number, number];
  symbol?: string;
  count?: number;
  mode?: DisplayMode;
}

export function parseLocation(hash: string): LocationState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const stepId = params.get("step");
  const stepIndex = Math.max(
    0,
    steps.findIndex((item) => item.id === stepId),
  );
  const requestedVersion = params.get("view");
  const firstLine = Number(params.get("line"));
  const requestedEnd = Number(params.get("end"));
  const requestedMode = params.get("mode");

  let version: Version | undefined;
  if (["base", "step", "head"].includes(requestedVersion ?? "")) {
    version = requestedVersion as Version;
  }

  let mode: DisplayMode | undefined;
  if (["file", "diff", "changes"].includes(requestedMode ?? "")) {
    mode = requestedMode as DisplayMode;
  }

  let focus: [number, number] | undefined;
  if (firstLine > 0) {
    const lastLine = requestedEnd >= firstLine ? requestedEnd : firstLine;
    focus = [firstLine, lastLine];
  }

  // Step IDs survive reordering. An absent file uses the step default, while an
  // explicit empty file preserves the state where the reader closed every tab.
  const state: LocationState = {
    step: stepIndex,
    path: params.get("file") ?? undefined,
    version,
    focus,
    mode,
  };

  // Unresolved symbol links also work when opened in a new tab. Resolve them
  // only after loading the selected source; an explicit numeric range wins.
  const symbol = params.get("symbol");
  if (!focus && symbol) {
    state.symbol = symbol;
    const count = Number(params.get("count"));
    if (Number.isSafeInteger(count) && count > 0) {
      state.count = count;
    }
  }
  return state;
}

export function makeLocation(
  step: number,
  path: string,
  version: Version,
  focus?: [number, number],
  mode: DisplayMode = "file",
  target?: Pick<SourceLink, "symbol" | "count">,
): string {
  const params = new URLSearchParams({ step: steps[step].id, file: path, view: version, mode });
  if (focus) {
    params.set("line", String(focus[0]));
    params.set("end", String(focus[1]));
  } else if (target?.symbol) {
    params.set("symbol", target.symbol);
    if (target.count !== undefined) {
      params.set("count", String(target.count));
    }
  }

  return `#${params}`;
}

export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
  old?: number;
  next?: number;
}

export interface DiffRegion {
  /** Zero-based, inclusive bounds into the complete diff row list. */
  start: number;
  end: number;
  rows: DiffLine[];
}

/**
 * Keep every edit and any authored pointer in the same compact comparison.
 * Pointer ranges use current-source coordinates, so deleted rows never take on
 * the meaning of a coincidentally matching line number from the previous state.
 */
export function diffRegions(
  rows: DiffLine[],
  context = 3,
  focuses: [number, number][] = [],
): DiffRegion[] {
  const padding = Math.max(0, Math.floor(context));
  const bounds: { start: number; end: number }[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const currentLine = row.next;
    const includesPointer =
      currentLine !== undefined &&
      focuses.some(([first, last]) => currentLine >= first && currentLine <= last);
    if (row.kind === "same" && !includesPointer) {
      continue;
    }

    const start = Math.max(0, index - padding);
    const end = Math.min(rows.length - 1, index + padding);
    const previous = bounds[bounds.length - 1];

    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      bounds.push({ start, end });
    }
  }

  return bounds.map(({ start, end }) => ({ start, end, rows: rows.slice(start, end + 1) }));
}

/**
 * Keep visible targets stationary. Coordinates refer to the scroll content, so
 * callers can measure real row heights rather than assuming unwrapped lines.
 */
export function focusScrollTop(
  scrollTop: number,
  viewportHeight: number,
  targetTop: number,
  targetBottom: number,
): number {
  if (viewportHeight <= 0) {
    return scrollTop;
  }
  if (targetTop >= scrollTop && targetBottom <= scrollTop + viewportHeight) {
    return scrollTop;
  }

  const targetHeight = targetBottom - targetTop;
  if (targetHeight > viewportHeight) {
    // A tall target cannot fit. Once its start is already near the viewport's
    // top, following the same reference again should not move the reader.
    const spaceAbove = targetTop - scrollTop;
    if (spaceAbove >= 0 && spaceAbove <= 48) {
      return scrollTop;
    }

    return Math.max(0, targetTop - 48);
  }

  const context = Math.min(48, (viewportHeight - targetHeight) / 2);
  if (targetTop < scrollTop) {
    return Math.max(0, targetTop - context);
  }

  return Math.max(0, targetBottom - viewportHeight + context);
}

// A longest common subsequence (LCS) gives stable line diffs for teaching patches
// without a runtime dependency. The cell budget bounds its quadratic work; the
// caller can still show the full file when an inline comparison is too large.
export function diffLines(before: string, after: string): DiffLine[] {
  const beforeLines = normalize(before).replace(/\n$/, "").split("\n");
  const afterLines = normalize(after).replace(/\n$/, "").split("\n");
  if (!before) {
    beforeLines.length = 0;
  }
  if (!after) {
    afterLines.length = 0;
  }
  // Most edits touch a small portion of a large source file. Trim matching
  // endpoints before allocating the quadratic table, preserving line numbers
  // against the original inputs when the diff is reconstructed below.
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength++;
  }

  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (
    beforeEnd > prefixLength &&
    afterEnd > prefixLength &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd--;
    afterEnd--;
  }

  const beforeLength = beforeEnd - prefixLength;
  const afterLength = afterEnd - prefixLength;
  if (beforeLength * afterLength > 3_000_000) {
    throw new RangeError(
      "This diff is too large for an inline comparison. Use Full file to read either version.",
    );
  }

  // Each cell holds the LCS length for the two suffixes starting at its indices.
  // The extra row and column represent empty suffixes and stay zero.
  const width = afterLength + 1;
  const table = new Uint32Array((beforeLength + 1) * width);
  for (let beforeIndex = beforeLength - 1; beforeIndex >= 0; beforeIndex--) {
    for (let afterIndex = afterLength - 1; afterIndex >= 0; afterIndex--) {
      const cell = beforeIndex * width + afterIndex;
      if (beforeLines[prefixLength + beforeIndex] === afterLines[prefixLength + afterIndex]) {
        table[cell] = table[(beforeIndex + 1) * width + afterIndex + 1] + 1;
      } else {
        const skipBefore = table[(beforeIndex + 1) * width + afterIndex];
        const skipAfter = table[beforeIndex * width + afterIndex + 1];
        table[cell] = Math.max(skipBefore, skipAfter);
      }
    }
  }

  const result: DiffLine[] = [];
  for (let index = 0; index < prefixLength; index++) {
    result.push({ kind: "same", text: beforeLines[index], old: index + 1, next: index + 1 });
  }

  let beforeIndex = prefixLength;
  let afterIndex = prefixLength;

  while (beforeIndex < beforeEnd || afterIndex < afterEnd) {
    const hasBefore = beforeIndex < beforeEnd;
    const hasAfter = afterIndex < afterEnd;
    const tableBefore = beforeIndex - prefixLength;
    const tableAfter = afterIndex - prefixLength;

    if (hasBefore && hasAfter && beforeLines[beforeIndex] === afterLines[afterIndex]) {
      result.push({
        kind: "same",
        text: beforeLines[beforeIndex],
        old: beforeIndex + 1,
        next: afterIndex + 1,
      });
      beforeIndex++;
      afterIndex++;
    } else if (
      hasAfter &&
      (!hasBefore ||
        table[tableBefore * width + tableAfter + 1] > table[(tableBefore + 1) * width + tableAfter])
    ) {
      result.push({ kind: "add", text: afterLines[afterIndex], next: afterIndex + 1 });
      afterIndex++;
    } else {
      // On equal LCS lengths, remove first to keep replacement ordering stable.
      result.push({ kind: "remove", text: beforeLines[beforeIndex], old: beforeIndex + 1 });
      beforeIndex++;
    }
  }

  while (beforeIndex < beforeLines.length) {
    result.push({
      kind: "same",
      text: beforeLines[beforeIndex],
      old: beforeIndex + 1,
      next: afterIndex + 1,
    });
    beforeIndex++;
    afterIndex++;
  }

  return result;
}

export function defaultSelection(step: Step): {
  path: string;
  version: Version;
  mode: DisplayMode;
} {
  if (Object.keys(step.changes ?? {}).length > 0) {
    return { path: "", version: "step", mode: "changes" };
  }

  return { path: step.file ?? "", version: step.version ?? "step", mode: "file" };
}
