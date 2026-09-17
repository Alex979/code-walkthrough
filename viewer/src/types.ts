export type Version = "base" | "step" | "head";
export interface BlobInfo { oid: string; size: number; kind: "text" | "binary" | "large" | "unavailable"; mode?: string }
export interface FileInfo { path: string; base?: BlobInfo; head?: BlobInfo; status: "A" | "M" | "D" | "" }
export interface Manifest {
  schemaVersion: 1; repo: string; base: string; head: string;
  title?: string; sourceUrl?: string; scope?: Record<string, unknown>; files: FileInfo[];
}
export interface SourceLink { label: string; path: string; start?: number; end?: number; symbol?: string; count?: number; version?: Version }
export type Part = string | SourceLink;
export type Change = { text: string } | { use: "head" } | null;
export interface Step {
  id: string; title: string; paragraphs: Part[][]; file: string;
  focus?: [number, number]; symbol?: string; count?: number; version?: Version;
  changes?: Record<string, Change>;
}
export interface Lesson { schemaVersion: 1; title: string; steps: Step[] }
