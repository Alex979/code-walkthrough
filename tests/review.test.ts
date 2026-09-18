import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewArtifact } from "../skills/code-walkthrough/scripts/review";
import type { BlobInfo, Lesson, Manifest, Step } from "../skills/code-walkthrough/scripts/types";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(
  before = "const original = 1;\n",
  after = "const original = 1;\nconst result = 3;\n",
) {
  const directory = await mkdtemp(join(tmpdir(), "walkthrough-review-"));
  directories.push(directory);
  await mkdir(join(directory, "blobs"));
  async function blob(text: string): Promise<BlobInfo> {
    const bytes = Buffer.from(text);
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    await writeFile(join(directory, "blobs", `${oid}.txt`), bytes);
    return { kind: "text", oid, size: bytes.length, mode: "100644" };
  }
  const manifest: Manifest = {
    schemaVersion: 1,
    repo: "synthetic",
    base: "base",
    head: "head",
    files: [{ path: "main.ts", status: "M", base: await blob(before), head: await blob(after) }],
  };
  const step: Step = {
    id: "finish",
    title: "Calculate the result",
    paragraphs: [["Add the result."]],
    changes: { "main.ts": { use: "head" } },
  };
  const lesson: Lesson = { schemaVersion: 1, title: "Synthetic build", steps: [step] };
  async function save() {
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(directory, "lesson.json"), JSON.stringify(lesson));
  }
  return { directory, manifest, lesson, step, save, blob };
}

test("review compares actual cumulative states rather than each step with base", async () => {
  const f = await fixture();
  f.lesson.steps.unshift({
    id: "prepare",
    title: "Prepare the result",
    paragraphs: [["Prepare."]],
    changes: { "main.ts": { text: "const original = 1;\nconst result = 2;\n" } },
  });
  await f.save();
  const overview = await reviewArtifact(f.directory);
  expect(overview).toContain("1. prepare");
  expect(overview).toContain("2. finish");
  expect(overview).toContain("+1/−1 lines");
  const details = await reviewArtifact(f.directory, { step: "finish" });
  expect(details).toContain("     2        - const result = 2;");
  expect(details).toContain("            2 + const result = 3;");
  expect(details).toContain("Add the result.");
  expect(details).not.toContain("+ const original = 1;");
});

test("review resolves symbols in the pointer's selected version", async () => {
  const f = await fixture("anchor\n", "prefix\nanchor\n");
  f.lesson.steps.unshift({
    id: "context",
    title: "Locate the anchor",
    file: "main.ts",
    symbol: "anchor",
    paragraphs: [
      [
        "Compare ",
        { label: "baseline", path: "main.ts", symbol: "anchor", version: "base" },
        " with ",
        { label: "current", path: "main.ts", symbol: "anchor" },
        " and ",
        { label: "final", path: "main.ts", symbol: "anchor", version: "head" },
      ],
    ],
  });
  await f.save();
  const report = await reviewArtifact(f.directory, { step: "context" });
  expect(report).toContain("Compare baseline [1] with current [2] and final [3]");
  expect(report).toContain("main.ts · base · lines 1–1");
  expect(report).toContain("main.ts · step · lines 1–1");
  expect(report).toContain("main.ts · head · lines 2–2");
  expect(report).toContain("Default focus: main.ts · step · lines 1–1");
});

test("review separates .meta noise without hiding assets or opaque edits", async () => {
  const f = await fixture();
  f.manifest.files.push(
    { path: "main.ts.meta", status: "A", head: await f.blob("guid: abc\n") },
    { path: "scene.asset", status: "A", head: await f.blob("meaningful: true\n") },
    { path: "icon.png", status: "A", head: { kind: "binary", oid: "a".repeat(40), size: 10 } },
  );
  for (const path of ["main.ts.meta", "scene.asset", "icon.png"]) {
    f.step.changes![path] = { use: "head" };
  }
  await f.save();
  const overview = await reviewArtifact(f.directory);
  expect(overview).toContain("3 files; +2/−0 lines");
  expect(overview).toContain("1 .meta files");
  expect(overview).toContain("1 file(s) cannot be compared as text");
  const details = await reviewArtifact(f.directory, { step: "finish" });
  expect(details).toContain("guid: abc");
  expect(details).toContain("meaningful: true");
  expect(details).toContain("No textual comparison: absent → binary");
});

test("selected-step output discloses bounded excerpts and --all restores every row", async () => {
  const added =
    Array.from({ length: 300 }, (_, index) => `const value${index} = ${index};`).join("\n") + "\n";
  const f = await fixture("", added);
  await f.save();
  const bounded = await reviewArtifact(f.directory, { step: "finish" });
  expect(bounded).toContain("60 diff/context rows omitted");
  expect(bounded).not.toContain("const value299");
  const full = await reviewArtifact(f.directory, { step: "finish", all: true });
  expect(full).toContain("const value299 = 299;");
  expect(full).not.toContain("rows omitted");
});

test("coarse comparisons are labeled rather than treated as precise edit counts", async () => {
  const f = await fixture("before\n".repeat(2000), "after\n".repeat(2000));
  await f.save();
  const report = await reviewArtifact(f.directory, { step: "finish" });
  expect(report).toContain("Coarse replacement comparison");
  expect(report).toContain("counts may overstate minimal edits");
});

test("unknown IDs and invalid lessons fail with actionable errors", async () => {
  const f = await fixture();
  await f.save();
  await expect(reviewArtifact(f.directory, { step: "missing" })).rejects.toThrow(
    "Run without --step to list IDs",
  );
  f.step.changes = { "../outside.ts": { text: "unexpected" } };
  await f.save();
  await expect(reviewArtifact(f.directory)).rejects.toThrow("Artifact validation failed");
});
