import type { Lesson, Manifest } from "../../skills/code-walkthrough/scripts/types";
import type { ReadingPosition } from "./navigation";

export interface ResumeState {
  stepId: string;
  position: ReadingPosition;
  guideScrollTop: number;
  tabs: string[];
  positions: ReadingPosition[];
  showFiles: boolean;
  showGuide: boolean;
}

/** A URL is an explicit instruction unless this is a reload of the same saved
 * location. Reloading should retain scroll; opening a source link should reveal it. */
export function shouldResume(hash: string, savedHash: string, navigationType?: string): boolean {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const explicit = ["step", "file", "view", "mode", "line", "symbol"].some((key) =>
    parameters.has(key),
  );
  return !explicit || (navigationType === "reload" && hash === savedHash);
}

/** Source coordinates belong to this exact capture and authored lesson. A new
 * lesson revision must not inherit stale highlights from an older version. */
export async function resumeStorageKey(manifest: Manifest, lesson: Lesson): Promise<string> {
  const content = new TextEncoder().encode(JSON.stringify([manifest, lesson]));
  const digest = await crypto.subtle.digest("SHA-256", content);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `code-walkthrough:resume:v1:${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isScroll(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPosition(value: unknown, paths: ReadonlySet<string>): value is ReadingPosition {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "path",
      "version",
      "mode",
      "focus",
      "scrollTop",
      "scrollLeft",
      "expandDiff",
    ])
  ) {
    return false;
  }
  if (typeof value.path !== "string" || (value.path !== "" && !paths.has(value.path))) {
    return false;
  }
  if (!["base", "step", "head"].includes(value.version as string)) {
    return false;
  }
  if (!["file", "changes", "diff"].includes(value.mode as string)) {
    return false;
  }
  if (value.mode === "changes" && value.version !== "step") {
    return false;
  }
  if (value.path === "" && (value.mode === "diff" || value.focus !== undefined)) {
    return false;
  }
  if (
    !isScroll(value.scrollTop) ||
    !isScroll(value.scrollLeft) ||
    typeof value.expandDiff !== "boolean"
  ) {
    return false;
  }
  if (value.focus !== undefined) {
    if (
      !Array.isArray(value.focus) ||
      value.focus.length !== 2 ||
      !value.focus.every((line) => Number.isSafeInteger(line) && line >= 1) ||
      value.focus[1] < value.focus[0]
    ) {
      return false;
    }
  }
  return true;
}

function isResumeState(
  value: unknown,
  lesson: Lesson,
  paths: ReadonlySet<string>,
): value is ResumeState {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "stepId",
      "position",
      "guideScrollTop",
      "tabs",
      "positions",
      "showFiles",
      "showGuide",
    ])
  ) {
    return false;
  }
  if (typeof value.stepId !== "string" || !lesson.steps.some((step) => step.id === value.stepId)) {
    return false;
  }
  if (
    !isPosition(value.position, paths) ||
    !isScroll(value.guideScrollTop) ||
    typeof value.showFiles !== "boolean" ||
    typeof value.showGuide !== "boolean"
  ) {
    return false;
  }
  if (
    !Array.isArray(value.tabs) ||
    value.tabs.length > paths.size ||
    !value.tabs.every((path) => typeof path === "string" && path !== "" && paths.has(path)) ||
    new Set(value.tabs).size !== value.tabs.length
  ) {
    return false;
  }
  if (
    !Array.isArray(value.positions) ||
    value.positions.length > paths.size + 1 ||
    !value.positions.every((position) => isPosition(position, paths))
  ) {
    return false;
  }
  // One overview memory and one memory per open source tab match ReadingMemory.
  const memories = new Set<string>();
  for (const position of value.positions) {
    const key = position.mode === "changes" ? "changes" : `file:${position.path}`;
    if (memories.has(key) || (position.mode !== "changes" && !value.tabs.includes(position.path))) {
      return false;
    }
    memories.add(key);
  }
  return true;
}

/** Storage may be disabled or edited independently of the lesson. Treat the
 * entire snapshot as optional; malformed state must never prevent opening it. */
export function loadResume(
  storage: Pick<Storage, "getItem">,
  key: string,
  lesson: Lesson,
  paths: ReadonlySet<string>,
): ResumeState | undefined {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return undefined;
    }
    const envelope: unknown = JSON.parse(raw);
    if (
      !isRecord(envelope) ||
      !hasOnlyKeys(envelope, ["version", "state"]) ||
      envelope.version !== 1 ||
      !isResumeState(envelope.state, lesson, paths)
    ) {
      return undefined;
    }
    return envelope.state;
  } catch {
    return undefined;
  }
}

export function saveResume(
  storage: Pick<Storage, "setItem">,
  key: string,
  state: ResumeState,
): boolean {
  try {
    storage.setItem(key, JSON.stringify({ version: 1, state }));
    return true;
  } catch {
    return false;
  }
}

export function clearResume(storage: Pick<Storage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Starting over should still work when browser storage is unavailable.
  }
}
