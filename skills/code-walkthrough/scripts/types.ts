/** Shared data contract for capture, validation, lesson authoring, and the viewer. */
export type Version = "base" | "step" | "head";

/** Captured content and Git metadata; only text blobs have a readable .txt file. */
export interface BlobInfo {
  /** Git object ID; empty only when unavailable working content could not be read. */
  oid: string;
  size: number;
  kind: "text" | "binary" | "large" | "unavailable";
  /** Six-digit Git mode, such as 100644 for a regular file. */
  mode?: string;
}

export interface FileInfo {
  path: string;
  /** An absent side means the file does not exist in that repository version. */
  base?: BlobInfo;
  head?: BlobInfo;
  status: "A" | "M" | "D" | "";
}

/** The frozen source capture. Lesson authoring never changes these endpoints. */
export interface Manifest {
  schemaVersion: 1;
  repo: string;
  base: string;
  head: string;
  title?: string;
  sourceUrl?: string;
  scope?: Record<string, unknown>;
  files: FileInfo[];
}

/** A link opens a full file, optionally selecting a location within it. */
export interface SourceLink {
  label: string;
  path: string;
  /** One-based, inclusive line bounds; use these or symbol/count, not both. */
  start?: number;
  end?: number;
  /** A literal substring that must match exactly one source line. */
  symbol?: string;
  count?: number;
  /** Omission selects the cumulative state at the current teaching step. */
  version?: Version;
}

export type Part = string | SourceLink;

/**
 * A full intermediate file, the captured final file, or a deletion.
 * Omitting a path from a step's changes preserves its previous state.
 */
export type Change = { text: string } | { use: "head" } | null;

export interface Step {
  id: string;
  title: string;
  paragraphs: Part[][];
  file: string;
  /** One-based, inclusive bounds in this step's selected version. */
  focus?: [number, number];
  symbol?: string;
  count?: number;
  version?: Version;
  /** Applied before the step's default file and prose links are resolved. */
  changes?: Record<string, Change>;
}

export interface Lesson {
  schemaVersion: 1;
  title: string;
  steps: Step[];
}
