import type { SourceLink } from "../../skills/code-walkthrough/scripts/types";
import { compareLines, type DiffLine } from "../../skills/code-walkthrough/scripts/diff";
import { diffRegions, normalize, resolveFocus, type DiffRegion } from "./model";

export interface SourceState {
  exists: boolean;
  /** Undefined means this existing file has no readable text in the capture. */
  text?: string;
}

export type SourceStateReader = (path: string, at: number) => Promise<SourceState>;

export interface ChangeRegion extends DiffRegion {
  /** This excerpt retains context from the immediately preceding build step. */
  continued?: boolean;
}

export interface FileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
  regions: ChangeRegion[];
  notice?: string;
  coarse?: boolean;
  failed: boolean;
}

interface LineSpan {
  first: number;
  last: number;
}

// A created file initially has no smaller edit boundary. Retain a useful source
// window on its next edit without inheriting hundreds of unrelated lines.
const CREATED_FILE_CONTEXT_LINES = 80;

/** Locate edits in either source, treating absent-side runs as insertion boundaries. */
function editedSpans(rows: DiffLine[], side: "old" | "next"): LineSpan[] {
  const spans: LineSpan[] = [];
  let precedingLine = 0;
  let active: LineSpan | undefined;
  for (const row of rows) {
    const line = row[side];
    if (row.kind === "same") {
      active = undefined;
    } else if (row.text.trim() !== "") {
      // Blank separators often arrive with the preceding method. They should
      // not extend its edit boundary into the next independently added method.
      const location = line ?? precedingLine + 1;
      if (active) {
        active.first = Math.min(active.first, location);
        active.last = Math.max(active.last, location);
      } else {
        active = { first: location, last: location };
        spans.push(active);
      }
    }
    if (line !== undefined) {
      precedingLine = line;
    }
  }
  return spans;
}

/**
 * Carry display context only when real edits continue near the previous edits.
 * Authored reference context alone cannot connect unrelated parts of a file.
 * Coordinates come from the exact comparison, so insertions and deletions before
 * an excerpt cannot silently attach it to the wrong lines.
 */
function continueRegions(
  rows: DiffLine[],
  regions: DiffRegion[],
  previous: FileChange,
): ChangeRegion[] {
  const currentEdits = editedSpans(rows, "old");
  const bounds: ChangeRegion[] = regions.map((region) => ({ ...region }));
  for (const region of previous.regions) {
    const previousEdits = editedSpans(region.rows, "next");
    const relatedEdits = currentEdits.filter((current) =>
      previousEdits.some(
        (earlier) => current.first <= earlier.last + 1 && current.last >= earlier.first - 1,
      ),
    );
    if (!relatedEdits.length) {
      continue;
    }

    const survivingLines = region.rows.flatMap((row) => (row.next === undefined ? [] : [row.next]));
    if (!survivingLines.length) {
      continue;
    }
    const first = survivingLines[0];
    const last = survivingLines[survivingLines.length - 1];
    let retainedSpans = [{ first, last }];
    if (previous.kind === "added" && last - first + 1 > CREATED_FILE_CONTEXT_LINES) {
      retainedSpans = relatedEdits.map((edit) => {
        // Center around the insertion/replacement boundary when possible. Near
        // either file edge, spend the remaining context budget on the other side.
        const start = Math.max(
          first,
          Math.min(
            edit.first - CREATED_FILE_CONTEXT_LINES / 2,
            last - CREATED_FILE_CONTEXT_LINES + 1,
          ),
        );
        return { first: start, last: start + CREATED_FILE_CONTEXT_LINES - 1 };
      });
    }
    for (const span of retainedSpans) {
      let start = -1;
      let end = -1;
      for (let index = 0; index < rows.length; index++) {
        const oldLine = rows[index].old;
        if (oldLine !== undefined && oldLine >= span.first && oldLine <= span.last) {
          if (start < 0) {
            start = index;
          }
          end = index;
        }
      }
      if (start >= 0) {
        bounds.push({ start, end, rows: [], continued: true });
      }
    }
  }

  bounds.sort((left, right) => left.start - right.start);
  const merged: ChangeRegion[] = [];
  for (const bound of bounds) {
    const preceding = merged[merged.length - 1];
    if (preceding && bound.start <= preceding.end + 1) {
      preceding.end = Math.max(preceding.end, bound.end);
      if (bound.continued) {
        preceding.continued = true;
      }
    } else {
      merged.push({ ...bound });
    }
  }
  return merged.map((region) => ({ ...region, rows: rows.slice(region.start, region.end + 1) }));
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
  preceding?: FileChange,
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
    const comparison = compareLines(previousText, currentText);
    const rows = comparison.rows;
    if (comparison.coarse) {
      change.coarse = true;
    }
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
    if (preceding && !preceding.failed && !preceding.coarse && !comparison.coarse) {
      change.regions = continueRegions(rows, change.regions, preceding);
    }
    if (!change.regions.length) {
      change.notice = "No visible line differences. File bytes or metadata may have changed.";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    change.notice = `Could not compare this file's changes: ${message}`;
    change.failed = true;
  }

  return change;
}

/** Preserve the authored path order and every file, even when one read fails. */
export function prepareStepChanges(
  paths: string[],
  at: number,
  readState: SourceStateReader,
  pointers: SourceLink[] = [],
  previousChanges: FileChange[] = [],
): Promise<FileChange[]> {
  return Promise.all(
    paths.map((path) =>
      prepareFileChange(
        path,
        at,
        readState,
        pointers,
        previousChanges.find((change) => change.path === path),
      ),
    ),
  );
}
