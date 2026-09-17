import type { Version } from "../../skills/code-walkthrough/scripts/types";
import type { DisplayMode } from "./model";

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
