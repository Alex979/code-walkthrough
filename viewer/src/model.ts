import type {
  Change,
  FileInfo,
  SourceLink,
  Step,
  Version,
} from "../../skills/code-walkthrough/scripts/types";

let steps: Step[] = [];

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
  mode?: "file" | "diff";
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

  let version: Version | undefined;
  if (["base", "step", "head"].includes(requestedVersion ?? "")) {
    version = requestedVersion as Version;
  }

  let focus: [number, number] | undefined;
  if (firstLine > 0) {
    const lastLine = requestedEnd >= firstLine ? requestedEnd : firstLine;
    focus = [firstLine, lastLine];
  }

  // Step IDs survive reordering. An absent file uses the step default, while an
  // explicit empty file preserves the state where the reader closed every tab.
  return {
    step: stepIndex,
    path: params.get("file") ?? undefined,
    version,
    focus,
    mode: params.get("mode") === "diff" ? "diff" : "file",
  };
}

export function makeLocation(
  step: number,
  path: string,
  version: Version,
  focus?: [number, number],
  mode = "file",
): string {
  const params = new URLSearchParams({ step: steps[step].id, file: path, view: version, mode });
  if (focus) {
    params.set("line", String(focus[0]));
    params.set("end", String(focus[1]));
  }

  return `#${params}`;
}

export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
  old?: number;
  next?: number;
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
  if (beforeLines.length * afterLines.length > 3_000_000) {
    throw new RangeError(
      "This diff is too large for an inline comparison. Use Full file to read either version.",
    );
  }

  // Each cell holds the LCS length for the two suffixes starting at its indices.
  // The extra row and column represent empty suffixes and stay zero.
  const width = afterLines.length + 1;
  const table = new Uint32Array((beforeLines.length + 1) * width);
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex--) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex--) {
      const cell = beforeIndex * width + afterIndex;
      if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
        table[cell] = table[(beforeIndex + 1) * width + afterIndex + 1] + 1;
      } else {
        const skipBefore = table[(beforeIndex + 1) * width + afterIndex];
        const skipAfter = table[beforeIndex * width + afterIndex + 1];
        table[cell] = Math.max(skipBefore, skipAfter);
      }
    }
  }

  const result: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const hasBefore = beforeIndex < beforeLines.length;
    const hasAfter = afterIndex < afterLines.length;

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
        table[beforeIndex * width + afterIndex + 1] > table[(beforeIndex + 1) * width + afterIndex])
    ) {
      result.push({ kind: "add", text: afterLines[afterIndex], next: afterIndex + 1 });
      afterIndex++;
    } else {
      // On equal LCS lengths, remove first to keep replacement ordering stable.
      result.push({ kind: "remove", text: beforeLines[beforeIndex], old: beforeIndex + 1 });
      beforeIndex++;
    }
  }

  return result;
}

export function defaultSelection(step: Step): { path: string; version: Version } {
  return { path: step.file, version: step.version ?? "step" };
}
