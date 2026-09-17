import { expect, test } from "bun:test";
import {
  configureLesson,
  fileExists,
  fileStatus,
  sourceAtStep,
  resolveFocus,
  diffLines,
  parseLocation,
  makeLocation,
} from "../viewer/src/model";
import type { FileInfo, Step } from "../skills/code-walkthrough/scripts/types";
const info = { oid: "0".repeat(40), size: 1, kind: "text" as const };
const added: FileInfo = { path: "src/new.ts", head: info, status: "A" };
const removed: FileInfo = { path: "src/old.ts", base: info, status: "D" };
const steps: Step[] = [
  { id: "context", title: "Context", paragraphs: [["Existing behavior."]], file: removed.path },
  {
    id: "shape",
    title: "Add the shape",
    paragraphs: [["Define the new class."]],
    file: added.path,
    changes: { [added.path]: { text: "class New {}\n" } },
  },
  {
    id: "finish",
    title: "Use it",
    paragraphs: [["Replace the old implementation."]],
    file: added.path,
    changes: { [added.path]: { use: "head" }, [removed.path]: null },
  },
];
configureLesson(steps);
test("tree and content share cumulative state, including deletions and reverse navigation", () => {
  expect(fileExists(added, 0, "step")).toBe(false);
  expect(fileExists(added, 1, "step")).toBe(true);
  expect(fileExists(removed, 1, "step")).toBe(true);
  expect(fileExists(removed, 2, "step")).toBe(false);
  expect(fileExists(removed, 0, "step")).toBe(true);
  expect(sourceAtStep(added.path, 0, undefined, "final")).toBeUndefined();
  expect(sourceAtStep(added.path, 1, undefined, "final")).toBe("class New {}\n");
  expect(sourceAtStep(added.path, 2, undefined, "final")).toBe("final");
  expect(sourceAtStep(removed.path, 2, "old")).toBeUndefined();
  expect(fileStatus(added, 0, "step")).toBe("");
  expect(fileStatus(added, 1, "step")).toBe("A");
  expect(fileExists(added, 0, "head")).toBe(true);
  expect(fileExists(added, 2, "base")).toBe(false);
});
test("focus and deep links preserve an explicit selection and version", () => {
  expect(resolveFocus("one\ntwo\nthree", { symbol: "two", count: 2 })).toEqual([2, 3]);
  expect(resolveFocus("one\ntwo", { focus: [2, 2] })).toEqual([2, 2]);
  expect(parseLocation(makeLocation(1, added.path, "head", [2, 5], "diff"))).toEqual({
    step: 1,
    path: added.path,
    version: "head",
    focus: [2, 5],
    mode: "diff",
  });
});
test("diff preserves both inputs across insertions and removals", () => {
  const before = "a\nb\nc\n",
    after = "a\nx\nc\nd\n";
  const rows = diffLines(before, after);
  expect(
    rows
      .filter((row) => row.kind !== "add")
      .map((row) => row.text)
      .join("\n") + "\n",
  ).toBe(before);
  expect(
    rows
      .filter((row) => row.kind !== "remove")
      .map((row) => row.text)
      .join("\n") + "\n",
  ).toBe(after);
});
