import { expect, test } from "bun:test";
import { chapterAt, chapterRanges } from "../viewer/src/chapters";
import { shouldResume } from "../viewer/src/resume";
import type { Lesson } from "../skills/code-walkthrough/scripts/types";

const lesson: Lesson = {
  schemaVersion: 1,
  title: "Build a greeting",
  steps: ["context", "model", "call", "check"].map((id) => ({ id, title: id, paragraphs: [] })),
  chapters: [
    { id: "foundation", title: "Prepare the greeting", start: "context" },
    { id: "integration", title: "Use it", start: "call" },
  ],
};

test("chapters partition the existing sequence without adding or resetting steps", () => {
  const chapters = chapterRanges(lesson);
  expect(chapters.map(({ start, end }) => [start, end])).toEqual([
    [0, 1],
    [2, 3],
  ]);
  expect(chapterAt(chapters, 1)?.id).toBe("foundation");
  expect(chapterAt(chapters, 2)?.id).toBe("integration");
  expect(chapterAt(chapters, 3)?.end).toBe(3);
  expect(chapterRanges({ ...lesson, chapters: undefined })).toEqual([]);
});

test("explicit links win over resume, while a reload retains the exact saved position", () => {
  const saved = "#step=call&file=main.ts&view=step&mode=file&line=4&end=4";
  expect(shouldResume("", saved, "navigate")).toBe(true);
  expect(shouldResume(saved, saved, "navigate")).toBe(false);
  expect(shouldResume(saved, saved, "reload")).toBe(true);
  expect(shouldResume("#step=check", saved, "reload")).toBe(false);
  expect(shouldResume("#file=other.ts", saved)).toBe(false);
  expect(shouldResume("#step=context", saved, "back_forward")).toBe(false);
});
