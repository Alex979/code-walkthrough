import type { Lesson } from "../../skills/code-walkthrough/scripts/types";

export interface ChapterRange {
  id: string;
  title: string;
  start: number;
  end: number;
}

/** Chapters only label contiguous parts of the existing cumulative sequence. */
export function chapterRanges(lesson: Lesson): ChapterRange[] {
  const starts = (lesson.chapters ?? []).map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    start: lesson.steps.findIndex((step) => step.id === chapter.start),
  }));
  return starts.map((chapter, index) => ({
    ...chapter,
    end: (starts[index + 1]?.start ?? lesson.steps.length) - 1,
  }));
}

export function chapterAt(chapters: ChapterRange[], step: number): ChapterRange | undefined {
  return chapters.find((chapter) => chapter.start <= step && step <= chapter.end);
}
