import { expect, test } from "bun:test";
import { compareLines, type DiffLine } from "../skills/code-walkthrough/scripts/diff";

function expectReconstruction(rows: DiffLine[], before: string[], after: string[]): void {
  const previousRows = rows.filter((row) => row.kind !== "add");
  const nextRows = rows.filter((row) => row.kind !== "remove");
  expect(previousRows.map((row) => row.text)).toEqual(before);
  expect(nextRows.map((row) => row.text)).toEqual(after);
  expect(previousRows.map((row) => row.old)).toEqual(before.map((_, index) => index + 1));
  expect(nextRows.map((row) => row.next)).toEqual(after.map((_, index) => index + 1));
  for (const row of rows) {
    if (row.kind === "same") {
      expect(before[row.old! - 1]).toBe(after[row.next! - 1]);
    } else if (row.kind === "add") {
      expect(row.old).toBeUndefined();
    } else {
      expect(row.next).toBeUndefined();
    }
  }
}

test("scattered edits in an 8,000-line serialized scene retain compact precise changes", () => {
  const before = Array.from({ length: 1_000 }, (_, index) => [
    `--- !u!1 &${index + 1}`,
    "GameObject:",
    "  serializedVersion: 6",
    `  m_Name: Object ${index + 1}`,
    "  m_IsActive: 1",
    "  m_Layer: 0",
    "  m_TagString: Untagged",
    "  m_StaticEditorFlags: 0",
  ]).flat();
  const after = [...before];
  after[12] = "  m_IsActive: 0";
  after[4_005] = "  m_Layer: 5";
  after[7_988] = "  m_IsActive: 0";
  after.splice(6_402, 0, "  m_NewProperty: 1");
  after.splice(801, 1);

  const comparison = compareLines(before.join("\n"), after.join("\n"));
  expect(comparison.coarse).toBe(false);
  expect(comparison.rows.filter((row) => row.kind !== "same")).toHaveLength(8);
  expectReconstruction(comparison.rows, before, after);
});

test("dense unrelated replacements remain available with an explicit coarse result", () => {
  const before = [
    "header",
    ...Array.from({ length: 2_000 }, (_, index) => `before ${index}`),
    "footer",
  ];
  const after = [
    "header",
    ...Array.from({ length: 2_000 }, (_, index) => `after ${index}`),
    "footer",
  ];
  const comparison = compareLines(before.join("\n"), after.join("\n"));
  expect(comparison.coarse).toBe(true);
  expect(comparison.rows[0]).toEqual({ kind: "same", text: "header", old: 1, next: 1 });
  expect(comparison.rows.slice(1, 2_001).every((row) => row.kind === "remove")).toBe(true);
  expect(comparison.rows.slice(2_001, 4_001).every((row) => row.kind === "add")).toBe(true);
  expectReconstruction(comparison.rows, before, after);
});

test("small repeated-line comparisons retain removal-first LCS alignment", () => {
  const comparison = compareLines("a\nb\na", "b\na\nb");
  expect(comparison).toEqual({
    coarse: false,
    rows: [
      { kind: "remove", text: "a", old: 1 },
      { kind: "same", text: "b", old: 2, next: 1 },
      { kind: "same", text: "a", old: 3, next: 2 },
      { kind: "add", text: "b", next: 3 },
    ],
  });
});

test("large repeated unanchored spans fall back without pretending repeated lines match", () => {
  const before = Array.from({ length: 20_000 }, (_, index) => (index % 2 ? "}" : "{"));
  const after = Array.from({ length: 20_000 }, (_, index) => (index % 2 ? "{" : "}"));
  const comparison = compareLines(before.join("\n"), after.join("\n"));
  expect(comparison.coarse).toBe(true);
  expect(comparison.rows).toHaveLength(40_000);
  expectReconstruction(comparison.rows, before, after);
});

test("reverse-ordered unique lines cannot cause recursive stack or quadratic table growth", () => {
  const before = Array.from({ length: 25_000 }, (_, index) => `object ${index}`);
  const after = before.toReversed();
  const comparison = compareLines(before.join("\n"), after.join("\n"));
  expect(comparison.coarse).toBe(false);
  expect(comparison.rows.filter((row) => row.kind === "same")).toHaveLength(1);
  expectReconstruction(comparison.rows, before, after);
});

test("many distant replacements and crossing anchors preserve both source orders", () => {
  const before = Array.from({ length: 10_000 }, (_, index) => `line ${index}`);
  const after = before.map((line, index) => (index % 23 === 0 ? `${line} edited` : line));
  const block = after.splice(2_000, 120);
  after.splice(7_000, 0, ...block);
  const comparison = compareLines(before.join("\n"), after.join("\n"));
  expect(comparison.coarse).toBe(false);
  expectReconstruction(comparison.rows, before, after);
  expect(compareLines(before.join("\n"), after.join("\n"))).toEqual(comparison);
});

test("large insertions and removals need no quadratic comparison or coarse warning", () => {
  const lines = Array.from({ length: 30_000 }, (_, index) => `line ${index}`);
  const addition = compareLines("", lines.join("\n"));
  const removal = compareLines(lines.join("\n"), "");
  expect(addition.coarse).toBe(false);
  expect(removal.coarse).toBe(false);
  expectReconstruction(addition.rows, [], lines);
  expectReconstruction(removal.rows, lines, []);
});
