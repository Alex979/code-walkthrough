import type { Change, FileInfo, SourceLink, Step, Version } from "./types";
let steps: Step[] = [];
export function configureLesson(value: Step[]): void { steps = value; }
export function changeAt(path: string, index: number): Change | undefined {
  for (let i = Math.min(index, steps.length - 1); i >= 0; i--) {
    if (Object.hasOwn(steps[i].changes ?? {}, path)) return steps[i].changes![path];
  }
  return undefined;
}
export function fileExists(file: FileInfo, index: number, version: Version): boolean {
  if (version !== "step") return Boolean(file[version]);
  const change = changeAt(file.path, index);
  return change === null ? false : change === undefined ? Boolean(file.base) : "text" in change ? true : Boolean(file.head);
}
export function fileStatus(file: FileInfo, index: number, version: Version): FileInfo["status"] {
  if (!fileExists(file, index, version) || version === "base") return "";
  if (version === "head") return file.status;
  const change = changeAt(file.path, index);
  if (change === undefined) return "";
  if (change && "use" in change) return file.status;
  return file.base ? "M" : "A";
}
export const normalize = (text: string): string => text.replaceAll("\r\n", "\n");
export function sourceAtStep(path: string, index: number, before?: string, after?: string): string | undefined {
  const change = changeAt(path, index);
  const value = change === null ? undefined : change === undefined ? before : "text" in change ? change.text : after;
  return value === undefined ? undefined : normalize(value);
}

export function resolveFocus(text: string, target: Pick<SourceLink, "start" | "end" | "symbol" | "count"> & { focus?: [number, number] }): [number, number] | undefined {
  const lines = normalize(text).split("\n");
  if (target.symbol) {
    const match = lines.findIndex(line => line.includes(target.symbol!));
    if (match < 0) return undefined;
    return [match + 1, Math.min(lines.length, match + (target.count ?? 1))];
  }
  if (target.focus) return target.focus;
  return target.start ? [target.start, target.end ?? target.start] : undefined;
}

export function parseLocation(hash: string): { step: number; path?: string; version?: Version; focus?: [number, number]; mode?: "file" | "diff" } {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const id = params.get("step");
  const step = Math.max(0, steps.findIndex(item => item.id === id));
  const version = params.get("view");
  const line = Number(params.get("line"));
  const end = Number(params.get("end"));
  return { step, path: params.get("file") ?? undefined,
    version: ["base", "step", "head"].includes(version ?? "") ? version as Version : undefined,
    focus: line > 0 ? [line, end >= line ? end : line] : undefined,
    mode: params.get("mode") === "diff" ? "diff" : "file" };
}

export function makeLocation(step: number, path: string, version: Version, focus?: [number, number], mode = "file"): string {
  const params = new URLSearchParams({ step: steps[step].id, file: path, view: version, mode });
  if (focus) { params.set("line", String(focus[0])); params.set("end", String(focus[1])); }
  return `#${params}`;
}

export interface DiffLine { kind: "same" | "add" | "remove"; text: string; old?: number; next?: number }
// Line LCS is sufficient for the small teaching patches and avoids an external runtime dependency.
export function diffLines(before: string, after: string): DiffLine[] {
  const a = normalize(before).replace(/\n$/, "").split("\n");
  const b = normalize(after).replace(/\n$/, "").split("\n");
  if (!before) a.length = 0;
  if (!after) b.length = 0;
  if (a.length * b.length > 3_000_000) throw new RangeError("This diff is too large for an inline comparison. Use Full file to read either version.");
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1
      : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: "same", text: a[i], old: i + 1, next: j + 1 }); i++; j++; }
    else if (j < b.length && (i === a.length || table[i * width + j + 1] > table[(i + 1) * width + j])) { result.push({ kind: "add", text: b[j], next: j + 1 }); j++; }
    else { result.push({ kind: "remove", text: a[i], old: i + 1 }); i++; }
  }
  return result;
}

export function defaultSelection(step: Step): { path: string; version: Version } {
  return { path: step.file, version: step.version ?? "step" };
}
