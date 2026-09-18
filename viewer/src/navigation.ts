import type { Version } from "../../skills/code-walkthrough/scripts/types";
import type { DisplayMode } from "./model";

/** A partial selection is misleading: every requested current-source line must
 * be present before a compact comparison can claim to show the target. */
export function isFocusRendered(
  focus: [number, number] | undefined,
  renderedLines: Iterable<number>,
): boolean {
  if (!focus) {
    return true;
  }
  const lines = new Set(renderedLines);
  for (let line = focus[0]; line <= focus[1]; line++) {
    if (!lines.has(line)) {
      return false;
    }
  }
  return true;
}

/** Prefer the region the reader is viewing. If it has no rendered rows, keep
 * the requested source range instead of silently sending them to line one. */
export function fullFileFocus(
  filePath: string,
  targetVersion: Version,
  visibleLine: number | undefined,
  selection: { path: string; version: Version; focus?: [number, number] },
): [number, number] | undefined {
  if (visibleLine !== undefined) {
    return [visibleLine, visibleLine];
  }
  if (filePath === selection.path && targetVersion === selection.version && selection.focus) {
    return [...selection.focus];
  }
  return undefined;
}

export interface ReadingPosition {
  path: string;
  version: Version;
  mode: DisplayMode;
  focus?: [number, number];
  scrollTop: number;
  scrollLeft: number;
  expandDiff: boolean;
}

/** Reader exploration belongs to a teaching step; its line numbers must never
 * leak into a later cumulative version of the same file. */
export class ReadingMemory {
  private positions = new Map<string, ReadingPosition>();

  private key(stepId: string, path: string, overview: boolean): string {
    return JSON.stringify([stepId, overview ? "changes" : "file", overview ? "" : path]);
  }

  save(stepId: string, position: ReadingPosition): void {
    const key = this.key(stepId, position.path, position.mode === "changes");
    this.positions.set(key, this.copy(position));
  }

  file(stepId: string, path: string): ReadingPosition | undefined {
    const position = this.positions.get(this.key(stepId, path, false));
    return position ? this.copy(position) : undefined;
  }

  overview(stepId: string): ReadingPosition | undefined {
    const position = this.positions.get(this.key(stepId, "", true));
    return position ? this.copy(position) : undefined;
  }

  forgetFile(path: string): void {
    for (const [key, position] of this.positions) {
      if (position.mode !== "changes" && position.path === path) {
        this.positions.delete(key);
      }
    }
  }

  private copy(position: ReadingPosition): ReadingPosition {
    return { ...position, focus: position.focus ? [...position.focus] : undefined };
  }
}
