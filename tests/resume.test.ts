import { expect, test } from "bun:test";
import type { Lesson, Manifest } from "../skills/code-walkthrough/scripts/types";
import {
  clearResume,
  loadResume,
  resumeStorageKey,
  saveResume,
  type ResumeState,
} from "../viewer/src/resume";

const manifest: Manifest = {
  schemaVersion: 1,
  repo: "synthetic",
  base: "old",
  head: "new",
  files: [
    { path: "first.ts", status: "M" },
    { path: "second.ts", status: "A" },
  ],
};
const lesson: Lesson = {
  schemaVersion: 1,
  title: "Build a feature",
  steps: [
    { id: "one", title: "Start", paragraphs: [] },
    { id: "two", title: "Finish", paragraphs: [] },
  ],
};
const paths = new Set(manifest.files.map((file) => file.path));

function snapshot(): ResumeState {
  const position: ResumeState["position"] = {
    path: "first.ts",
    version: "base",
    mode: "file",
    focus: [5, 8],
    scrollTop: 320.5,
    scrollLeft: 17,
    expandDiff: false,
  };
  return {
    stepId: "two",
    position,
    guideScrollTop: 120,
    tabs: ["first.ts", "second.ts"],
    positions: [
      position,
      { ...position, path: "", version: "step", mode: "changes", focus: undefined },
    ],
    showFiles: true,
    showGuide: false,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("resume round-trips source exploration, panel visibility, and overview memory", async () => {
  const storage = memoryStorage();
  const key = await resumeStorageKey(manifest, lesson);
  const state = snapshot();
  expect(loadResume(storage, key, lesson, paths)).toBeUndefined();
  expect(saveResume(storage, key, state)).toBe(true);
  expect(loadResume(storage, key, lesson, paths)).toEqual(state);
  state.position.focus![0] = 99;
  const loaded = loadResume(storage, key, lesson, paths)!;
  expect(loaded.position.focus).toEqual([5, 8]);
  loaded.tabs.pop();
  loaded.position.focus![1] = 99;
  expect(loadResume(storage, key, lesson, paths)!.tabs).toEqual(["first.ts", "second.ts"]);
  expect(loadResume(storage, key, lesson, paths)!.position.focus).toEqual([5, 8]);
  clearResume(storage, key);
  expect(loadResume(storage, key, lesson, paths)).toBeUndefined();
});

test("capture and lesson identity invalidate stale saved source coordinates", async () => {
  const key = await resumeStorageKey(manifest, lesson);
  expect(key).toMatch(/^code-walkthrough:resume:v1:[a-f0-9]{64}$/);
  expect(await resumeStorageKey(structuredClone(manifest), structuredClone(lesson))).toBe(key);
  const changedLesson = structuredClone(lesson);
  changedLesson.steps[1].changes = { "first.ts": { text: "different intermediate source" } };
  const changedKey = await resumeStorageKey(manifest, changedLesson);
  expect(changedKey).not.toBe(key);
  expect(await resumeStorageKey({ ...manifest, repo: "other repository" }, lesson)).not.toBe(key);
  expect(await resumeStorageKey({ ...manifest, head: "other endpoint" }, lesson)).not.toBe(key);
  const storage = memoryStorage();
  saveResume(storage, key, snapshot());
  expect(loadResume(storage, changedKey, changedLesson, paths)).toBeUndefined();
});

test("blocked storage and quota failures cannot break lesson loading or starting over", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(loadResume(blocked, "key", lesson, paths)).toBeUndefined();
  expect(saveResume(blocked, "key", snapshot())).toBe(false);
  expect(() => clearResume(blocked, "key")).not.toThrow();
});

test("malformed and unsupported envelopes are ignored", () => {
  const storage = memoryStorage();
  for (const raw of [
    "",
    "{",
    "null",
    "false",
    "3",
    '"text"',
    "[]",
    "{}",
    '{"version":2,"state":{}}',
    '{"version":1,"state":null}',
  ]) {
    storage.setItem("key", raw);
    expect(loadResume(storage, "key", lesson, paths)).toBeUndefined();
  }
  storage.setItem("key", JSON.stringify({ version: 1, state: snapshot(), unexpected: true }));
  expect(loadResume(storage, "key", lesson, paths)).toBeUndefined();
});

test("invalid references, shapes, ranges, and scroll coordinates reject the entire snapshot", () => {
  const invalid: Array<(state: any) => void> = [
    (state) => {
      state.stepId = "missing";
    },
    (state) => {
      state.stepId = 2;
    },
    (state) => {
      state.position.path = "outside.ts";
    },
    (state) => {
      state.position.path = "";
    },
    (state) => {
      state.position.version = "latest";
    },
    (state) => {
      state.position.mode = "unknown";
    },
    (state) => {
      state.position.mode = "changes";
    },
    (state) => {
      state.position.focus = [8, 5];
    },
    (state) => {
      state.position.focus = [0, 5];
    },
    (state) => {
      state.position.focus = [1.5, 5];
    },
    (state) => {
      state.position.focus = [1, Number.MAX_SAFE_INTEGER + 1];
    },
    (state) => {
      state.position.focus = [1, 2, 3];
    },
    (state) => {
      state.position.focus = null;
    },
    (state) => {
      state.position.scrollTop = -1;
    },
    (state) => {
      state.position.scrollLeft = "10";
    },
    (state) => {
      state.position.expandDiff = 1;
    },
    (state) => {
      delete state.position.scrollTop;
    },
    (state) => {
      state.guideScrollTop = -1;
    },
    (state) => {
      state.showGuide = "false";
    },
    (state) => {
      delete state.showFiles;
    },
    (state) => {
      state.tabs = ["outside.ts"];
    },
    (state) => {
      state.tabs = ["first.ts", "first.ts"];
    },
    (state) => {
      state.tabs = [""];
    },
    (state) => {
      state.tabs = null;
    },
    (state) => {
      state.tabs = [];
    },
    (state) => {
      state.positions = [state.position, state.position];
    },
    (state) => {
      state.positions = [...state.positions, ...state.positions];
    },
    (state) => {
      state.positions = [null];
    },
    (state) => {
      state.positions = {};
    },
    (state) => {
      state.unexpected = "value";
    },
    (state) => {
      state.position.unexpected = "value";
    },
  ];
  const storage = memoryStorage();
  for (const corrupt of invalid) {
    const state = snapshot();
    corrupt(state);
    saveResume(storage, "key", state);
    expect(loadResume(storage, "key", lesson, paths)).toBeUndefined();
  }
  // JSON can parse a finite-looking exponent into Infinity.
  storage.setItem(
    "key",
    JSON.stringify({ version: 1, state: snapshot() }).replace(
      '"guideScrollTop":120',
      '"guideScrollTop":1e400',
    ),
  );
  expect(loadResume(storage, "key", lesson, paths)).toBeUndefined();
});

test("empty context steps and unselected change overviews can resume without a source file", () => {
  const storage = memoryStorage();
  const state = snapshot();
  state.position = { ...state.position, path: "", focus: undefined };
  state.tabs = [];
  state.positions = [];
  saveResume(storage, "key", state);
  expect(loadResume(storage, "key", lesson, paths)).toEqual(state);
  state.position.mode = "changes";
  state.position.version = "step";
  saveResume(storage, "key", state);
  expect(loadResume(storage, "key", lesson, paths)).toEqual(state);
  state.position.mode = "diff";
  saveResume(storage, "key", state);
  expect(loadResume(storage, "key", lesson, paths)).toBeUndefined();
});
