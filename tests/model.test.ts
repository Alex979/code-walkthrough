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
  defaultSelection,
  diffRegions,
  focusScrollTop,
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
  expect(resolveFocus("one\ntwo", { symbol: "missing", focus: [2, 2] })).toBeUndefined();
});

test("construction steps default to every change and context steps may start without a file", () => {
  expect(defaultSelection(steps[1])).toEqual({ path: "", version: "step", mode: "changes" });
  expect(defaultSelection({ ...steps[2], file: removed.path, version: "base" })).toEqual({
    path: "",
    version: "step",
    mode: "changes",
  });
  expect(defaultSelection({ ...steps[0], version: "base" })).toEqual({
    path: removed.path,
    version: "base",
    mode: "file",
  });
  expect(
    defaultSelection({
      id: "intro",
      title: "Overview",
      paragraphs: [["Start here."]],
      changes: {},
    }),
  ).toEqual({ path: "", version: "step", mode: "file" });
});

test("locations distinguish default selection from explicitly empty source panes", () => {
  expect(parseLocation("#step=shape")).toEqual({
    step: 1,
    path: undefined,
    version: undefined,
    focus: undefined,
    mode: undefined,
  });
  expect(parseLocation(makeLocation(1, "", "step", undefined, "changes"))).toEqual({
    step: 1,
    path: "",
    version: "step",
    focus: undefined,
    mode: "changes",
  });
  expect(parseLocation(makeLocation(0, "", "base", undefined, "file"))).toEqual({
    step: 0,
    path: "",
    version: "base",
    focus: undefined,
    mode: "file",
  });
  expect(parseLocation("#step=missing&view=invalid&mode=invalid")).toMatchObject({
    step: 0,
    version: undefined,
    mode: undefined,
  });
});

test("change overview deep links retain the pointer file and current-source range", () => {
  expect(parseLocation(makeLocation(1, added.path, "step", [12, 15], "changes"))).toEqual({
    step: 1,
    path: added.path,
    version: "step",
    focus: [12, 15],
    mode: "changes",
  });
});

test("native source links preserve unresolved symbols and counts in the selected version", () => {
  const state = parseLocation(
    makeLocation(1, added.path, "step", undefined, "changes", {
      symbol: 'function initialize(value: string = "a & b")',
      count: 4,
    }),
  );
  expect(state).toEqual({
    step: 1,
    path: added.path,
    version: "step",
    focus: undefined,
    mode: "changes",
    symbol: 'function initialize(value: string = "a & b")',
    count: 4,
  });
  expect(
    parseLocation(makeLocation(0, removed.path, "base", undefined, "file", { symbol: "old" })),
  ).toMatchObject({ path: removed.path, version: "base", symbol: "old" });
});

test("numeric deep-link selections win over symbols and invalid counts use their default", () => {
  const numeric = parseLocation(
    makeLocation(1, added.path, "head", [3, 5], "file", { symbol: "ignored", count: 7 }),
  );
  expect(numeric.focus).toEqual([3, 5]);
  expect(numeric.symbol).toBeUndefined();
  expect(numeric.count).toBeUndefined();
  expect(parseLocation("#step=shape&line=3&end=5&symbol=ignored&count=7").symbol).toBeUndefined();
  for (const count of ["", "0", "-1", "1.5", "invalid", "9007199254740992"]) {
    const state = parseLocation(`#step=shape&symbol=target&count=${count}`);
    expect(state.symbol).toBe("target");
    expect(state.count).toBeUndefined();
  }
  expect(parseLocation("#step=shape&symbol=&count=3").symbol).toBeUndefined();
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

test("diff keeps original line numbers around a trimmed replacement and prefers removals on ties", () => {
  expect(diffLines("first\nold\nlast\n", "first\nnew\nlast\n")).toEqual([
    { kind: "same", text: "first", old: 1, next: 1 },
    { kind: "remove", text: "old", old: 2 },
    { kind: "add", text: "new", next: 2 },
    { kind: "same", text: "last", old: 3, next: 3 },
  ]);
  expect(diffLines("first\nlast", "first\nnew\nlast")).toEqual([
    { kind: "same", text: "first", old: 1, next: 1 },
    { kind: "add", text: "new", next: 2 },
    { kind: "same", text: "last", old: 2, next: 3 },
  ]);
  expect(diffLines("first\nold\nlast", "first\nlast")).toEqual([
    { kind: "same", text: "first", old: 1, next: 1 },
    { kind: "remove", text: "old", old: 2 },
    { kind: "same", text: "last", old: 3, next: 2 },
  ]);
});

test("diff handles empty files, CRLF display normalization, and trailing blank lines", () => {
  expect(diffLines("", "")).toEqual([]);
  expect(diffLines("", "a\r\nb\r\n")).toEqual([
    { kind: "add", text: "a", next: 1 },
    { kind: "add", text: "b", next: 2 },
  ]);
  expect(diffLines("a\nb\n", "")).toEqual([
    { kind: "remove", text: "a", old: 1 },
    { kind: "remove", text: "b", old: 2 },
  ]);
  expect(diffLines("a\r\n\r\n", "a\n\n")).toEqual([
    { kind: "same", text: "a", old: 1, next: 1 },
    { kind: "same", text: "", old: 2, next: 2 },
  ]);
});

test("small changes in large files stay within the diff budget", () => {
  const beforeLines = Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`);
  const afterLines = [...beforeLines];
  afterLines[2_499] = "changed line";
  const rows = diffLines(beforeLines.join("\n"), afterLines.join("\n"));

  expect(rows).toHaveLength(5_001);
  expect(rows.filter((row) => row.kind !== "same")).toEqual([
    { kind: "remove", text: "line 2500", old: 2_500 },
    { kind: "add", text: "changed line", next: 2_500 },
  ]);
  expect(diffRegions(rows)[0].rows).toHaveLength(8);
  expect(diffLines(beforeLines.join("\n"), beforeLines.join("\n"))).toHaveLength(5_000);
});

test("diff reconstruction retains content and numbering through repeated lines", () => {
  const sources = ["", "a", "b", "a\na", "a\nb", "b\na", "a\nb\na", "b\na\nb", "\na\n"];

  for (const before of sources) {
    for (const after of sources) {
      const rows = diffLines(before, after);
      const previousRows = rows.filter((row) => row.kind !== "add");
      const nextRows = rows.filter((row) => row.kind !== "remove");
      expect(previousRows.map((row) => row.text).join("\n")).toBe(before.replace(/\n$/, ""));
      expect(nextRows.map((row) => row.text).join("\n")).toBe(after.replace(/\n$/, ""));
      expect(previousRows.map((row) => row.old)).toEqual(
        Array.from({ length: previousRows.length }, (_, index) => index + 1),
      );
      expect(nextRows.map((row) => row.next)).toEqual(
        Array.from({ length: nextRows.length }, (_, index) => index + 1),
      );
    }
  }
});

test("change regions include every separated edit with context and exact diff indices", () => {
  const beforeLines = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
  const afterLines = [...beforeLines];
  afterLines[5] = "first edit";
  afterLines[70] = "second edit";
  const rows = diffLines(beforeLines.join("\n"), afterLines.join("\n"));
  const regions = diffRegions(rows);

  expect(regions.map(({ start, end }) => ({ start, end }))).toEqual([
    { start: 2, end: 9 },
    { start: 68, end: 75 },
  ]);
  expect(regions.flatMap((region) => region.rows.filter((row) => row.kind !== "same"))).toEqual(
    rows.filter((row) => row.kind !== "same"),
  );
  for (const region of regions) {
    expect(region.rows).toEqual(rows.slice(region.start, region.end + 1));
  }
});

test("change regions merge adjacent context and bound context at file edges", () => {
  const rows = diffLines("a\nb\nc\nd\ne\nf\ng\nh", "first\nb\nc\nd\ne\nf\ng\nlast");
  expect(diffRegions(rows, 3)).toEqual([{ start: 0, end: rows.length - 1, rows }]);
  expect(diffRegions(rows, 0).map(({ start, end }) => ({ start, end }))).toEqual([
    { start: 0, end: 1 },
    { start: 8, end: 9 },
  ]);
  expect(diffRegions(diffLines("same\n", "same\n"))).toEqual([]);
  expect(diffRegions([])).toEqual([]);
  expect(diffRegions(diffLines("", "new\n"))).toEqual([
    { start: 0, end: 0, rows: [{ kind: "add", text: "new", next: 1 }] },
  ]);
  expect(diffRegions(diffLines("old\n", ""))).toEqual([
    { start: 0, end: 0, rows: [{ kind: "remove", text: "old", old: 1 }] },
  ]);
});

test("change regions include distant pointers while preserving every real edit", () => {
  const before = Array.from({ length: 90 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[50] = "first edit";
  after[80] = "second edit";
  const rows = diffLines(before.join("\n"), after.join("\n"));
  const regions = diffRegions(rows, 3, [[12, 14]]);

  expect(regions).toHaveLength(3);
  expect(regions[0].rows.map((row) => row.next)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  expect(regions.flatMap((region) => region.rows.filter((row) => row.kind !== "same"))).toEqual(
    rows.filter((row) => row.kind !== "same"),
  );
  for (const region of regions) {
    expect(region.rows).toEqual(rows.slice(region.start, region.end + 1));
  }
});

test("pointer context merges with edits and uses next-side coordinates after deletion", () => {
  const before = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  const after = before.slice(5);
  after[16] = "changed";
  const rows = diffLines(before.join("\n"), after.join("\n"));
  const regions = diffRegions(rows, 3, [
    [6, 6],
    [10, 10],
    [12, 13],
  ]);

  expect(regions).toHaveLength(1);
  const focusRow = regions[0].rows.find((row) => row.next === 10);
  expect(focusRow).toEqual({ kind: "same", text: "line 15", old: 15, next: 10 });
  expect(regions[0].rows.at(-1)?.next).toBe(20);
  expect(regions[0].rows.filter((row) => row.kind !== "same")).toEqual(
    rows.filter((row) => row.kind !== "same"),
  );
});

test("pointers include readable context even when the changed file has no line differences", () => {
  const rows = diffLines("same\n", "same\n");
  expect(diffRegions(rows, 3, [[1, 1]])).toEqual([{ start: 0, end: 0, rows }]);
  expect(diffRegions(rows)).toEqual([]);
  expect(diffRegions(rows, 3, [[100, 101]])).toEqual([]);
  expect(diffRegions([], 3, [[1, 5]])).toEqual([]);
});

test("following a fully visible focus preserves the exact scroll position", () => {
  expect(focusScrollTop(100, 400, 110, 480)).toBe(100);
  expect(focusScrollTop(100, 400, 100, 500)).toBe(100);
  expect(focusScrollTop(100.5, 400, 110.25, 400.75)).toBe(100.5);
});

test("partially visible focus scrolls only toward the clipped edge with bounded context", () => {
  expect(focusScrollTop(100, 400, 80, 140)).toBe(32);
  expect(focusScrollTop(100, 400, 450, 540)).toBe(188);
  expect(focusScrollTop(100, 400, 90, 480)).toBe(85);
  expect(focusScrollTop(100, 400, 130, 520)).toBe(125);
  expect(focusScrollTop(100, 400, 10, 40)).toBe(0);
});

test("focus uses measured heights for wrapped rows and keeps oversized starts stable", () => {
  expect(focusScrollTop(200, 300, 420, 640)).toBe(380);
  expect(focusScrollTop(200, 300, 420, 900)).toBe(372);
  expect(focusScrollTop(372, 300, 420, 900)).toBe(372);
  expect(focusScrollTop(400, 300, 420, 900)).toBe(400);
  expect(focusScrollTop(500, 300, 420, 900)).toBe(372);
  expect(focusScrollTop(0, 300, 0, 900)).toBe(0);
  expect(focusScrollTop(100, 0, 200, 300)).toBe(100);
});
