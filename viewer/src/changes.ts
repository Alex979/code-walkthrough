import type { SourceLink } from "../../skills/code-walkthrough/scripts/types";
import { diffLines, diffRegions, normalize, resolveFocus, type DiffRegion } from "./model";

export interface SourceState {
  exists: boolean;
  /** Undefined means this existing file has no readable text in the capture. */
  text?: string;
}

export type SourceStateReader = (path: string, at: number) => Promise<SourceState>;

export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  regions: DiffRegion[];
  notice?: string;
  failed: boolean;
}

function changeKind(previous: SourceState, current: SourceState): FileChange["kind"] {
  if (!previous.exists && current.exists) {
    return "added";
  }
  if (previous.exists && !current.exists) {
    return "deleted";
  }

  return "modified";
}

async function prepareFileChange(
  path: string,
  at: number,
  readState: SourceStateReader,
  pointers: SourceLink[],
): Promise<FileChange> {
  let previous: SourceState;
  let current: SourceState;
  try {
    [previous, current] = await Promise.all([readState(path, at - 1), readState(path, at)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path,
      kind: "modified",
      regions: [],
      notice: `Could not load this file's changes: ${message}`,
      failed: true,
    };
  }

  const kind = changeKind(previous, current);
  const change: FileChange = { path, kind, regions: [], failed: false };

  // An unreadable existing side is not an empty file. Comparing against an
  // empty string would invent textual additions or removals for binary assets.
  if (
    (previous.exists && previous.text === undefined) ||
    (current.exists && current.text === undefined)
  ) {
    let action = "Updated asset";
    if (kind === "added") {
      action = "Added asset";
    } else if (kind === "deleted") {
      action = "Deleted asset";
    }
    change.notice = `${action}. This capture does not provide a text comparison.`;
    return change;
  }

  const previousText = previous.exists ? previous.text! : "";
  const currentText = current.exists ? current.text! : "";
  try {
    const focuses: [number, number][] = [];
    if (current.exists) {
      for (const pointer of pointers) {
        if (
          pointer.path !== path ||
          pointer.view !== "changes" ||
          (pointer.version !== undefined && pointer.version !== "step")
        ) {
          continue;
        }

        // Resolve against this cumulative state, never the captured head. An
        // authored method anchor can therefore supply context above a hunk even
        // after earlier teaching steps have shifted its line number.
        const focus = resolveFocus(currentText, pointer);
        if (focus) {
          focuses.push(focus);
        }
      }
    }
    const rows = diffLines(previousText, currentText);
    const currentLines = normalize(currentText).split("\n");
    const finalLine = currentLines.length;
    if (
      currentLines.at(-1) === "" &&
      focuses.some(([first, last]) => first <= finalLine && last >= finalLine)
    ) {
      // Source locations include the empty line after a terminal LF (or the
      // sole line of an empty file). The diff omits that delimiter for exact
      // reconstruction, but an authored pointer still needs a display target.
      const previousLines = normalize(previousText).split("\n");
      const old = previous.exists && previousLines.at(-1) === "" ? previousLines.length : undefined;
      rows.push({ kind: "same", text: "", next: finalLine, old });
    }
    change.regions = diffRegions(rows, 3, focuses);
    if (!change.regions.length) {
      change.notice = "No visible line differences. File bytes or metadata may have changed.";
    }
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    change.notice = error.message;
  }

  return change;
}

/** Preserve the authored path order and every file, even when one read fails. */
export function prepareStepChanges(
  paths: string[],
  at: number,
  readState: SourceStateReader,
  pointers: SourceLink[] = [],
): Promise<FileChange[]> {
  return Promise.all(paths.map((path) => prepareFileChange(path, at, readState, pointers)));
}
