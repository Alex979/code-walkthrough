import { expect, test } from "bun:test";
import {
  fullFileFocus,
  isFocusRendered,
  ReadingMemory,
  type ReadingPosition,
} from "../viewer/src/navigation";

test("overview selections require their whole current-source range to be rendered", () => {
  expect(isFocusRendered([70, 72], [69, 70, 71, 72, 73])).toBe(true);
  expect(isFocusRendered([70, 72], [70, 72])).toBe(false);
  expect(isFocusRendered([70, 72], [])).toBe(false);
  expect(isFocusRendered([70, 72], [70, 70, 72])).toBe(false);
  expect(isFocusRendered(undefined, [])).toBe(true);
});

test("full-file navigation retains a requested range when the overview has no visible rows", () => {
  const selection = {
    path: "scene.unity",
    version: "step" as const,
    focus: [7100, 7120] as [number, number],
  };
  expect(fullFileFocus("scene.unity", "step", undefined, selection)).toEqual([7100, 7120]);
  expect(fullFileFocus("scene.unity", "step", 7000, selection)).toEqual([7000, 7000]);
  expect(fullFileFocus("other.unity", "step", undefined, selection)).toBeUndefined();
  expect(fullFileFocus("scene.unity", "base", undefined, selection)).toBeUndefined();
  const result = fullFileFocus("scene.unity", "step", undefined, selection)!;
  result[0] = 1;
  expect(selection.focus).toEqual([7100, 7120]);
});

test("a reference tab retains its version, highlight and scroll through the change overview", () => {
  const memory = new ReadingMemory();
  const reference: ReadingPosition = {
    path: "manager.ts",
    version: "base",
    mode: "file",
    focus: [87, 93],
    scrollTop: 1520,
    scrollLeft: 12,
    expandDiff: false,
  };
  memory.save("cleanup", reference);
  memory.save("cleanup", {
    path: "die.ts",
    version: "step",
    mode: "changes",
    focus: [211, 215],
    scrollTop: 230,
    scrollLeft: 0,
    expandDiff: false,
  });
  expect(memory.file("cleanup", "manager.ts")).toEqual(reference);
  expect(memory.overview("cleanup")?.focus).toEqual([211, 215]);
  expect(memory.overview("cleanup")?.scrollTop).toBe(230);
  expect(memory.file("next-step", "manager.ts")).toBeUndefined();
});

test("closing a file forgets it without discarding the overview or other file positions", () => {
  const memory = new ReadingMemory();
  const position: ReadingPosition = {
    path: "first.ts",
    version: "head",
    mode: "diff",
    focus: [10, 20],
    scrollTop: 420,
    scrollLeft: 0,
    expandDiff: true,
  };
  memory.save("one", position);
  memory.save("two", position);
  memory.save("one", { ...position, path: "second.ts" });
  memory.save("one", { ...position, mode: "changes" });
  memory.forgetFile("first.ts");
  expect(memory.file("one", "first.ts")).toBeUndefined();
  expect(memory.file("two", "first.ts")).toBeUndefined();
  expect(memory.file("one", "second.ts")?.expandDiff).toBe(true);
  expect(memory.overview("one")?.focus).toEqual([10, 20]);
});

test("later selection mutations cannot alter the saved reading position", () => {
  const memory = new ReadingMemory();
  const position: ReadingPosition = {
    path: "file.ts",
    version: "step",
    mode: "file",
    focus: [2, 4],
    scrollTop: 100,
    scrollLeft: 0,
    expandDiff: false,
  };
  memory.save("one", position);
  position.focus![0] = 99;
  const restored = memory.file("one", "file.ts")!;
  expect(restored.focus).toEqual([2, 4]);
  restored.focus![1] = 100;
  expect(memory.file("one", "file.ts")?.focus).toEqual([2, 4]);
});
