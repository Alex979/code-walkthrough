import { expect, test } from "bun:test";
import {
  prepareStepChanges,
  type SourceState,
  type SourceStateReader,
} from "../viewer/src/changes";

test("all changed files and separated regions are prepared in authored order", async () => {
  const original = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`);
  const changed = [...original];
  changed[5] = "first change";
  changed[70] = "second change";
  const reads: string[] = [];
  const reader: SourceStateReader = async (path, at) => {
    reads.push(`${path}:${at}`);
    if (path === "existing.ts") {
      return { exists: true, text: (at === 3 ? original : changed).join("\n") };
    }
    return at === 3 ? { exists: false } : { exists: true, text: "new file\n" };
  };

  const changes = await prepareStepChanges(["existing.ts", "added.ts"], 4, reader);
  expect(changes.map(({ path, kind, failed }) => ({ path, kind, failed }))).toEqual([
    { path: "existing.ts", kind: "modified", failed: false },
    { path: "added.ts", kind: "added", failed: false },
  ]);
  expect(changes[0].regions).toHaveLength(2);
  expect(
    changes[0].regions.flatMap((region) =>
      region.rows.filter((row) => row.kind === "add").map((row) => row.text),
    ),
  ).toEqual(["first change", "second change"]);
  expect(changes[1].regions[0].rows).toEqual([{ kind: "add", text: "new file", next: 1 }]);
  expect(reads.sort()).toEqual(["added.ts:3", "added.ts:4", "existing.ts:3", "existing.ts:4"]);
});

test("deletions show the complete preceding intermediate source", async () => {
  const reads: number[] = [];
  const reader: SourceStateReader = async (_path, at) => {
    reads.push(at);
    if (at === -1) {
      return { exists: true, text: "original baseline\n" };
    }
    if (at === 2) {
      return { exists: true, text: "earlier lesson edit\nadditional intermediate line\n" };
    }
    return { exists: false };
  };

  const [change] = await prepareStepChanges(["removed.ts"], 3, reader);
  expect(change.kind).toBe("deleted");
  expect(change.failed).toBe(false);
  expect(change.regions[0].rows).toEqual([
    { kind: "remove", text: "earlier lesson edit", old: 1 },
    { kind: "remove", text: "additional intermediate line", old: 2 },
  ]);
  expect(reads).toEqual([2, 3]);
});

test("the first construction step compares against the captured baseline", async () => {
  const reads: number[] = [];
  const [change] = await prepareStepChanges(["first.ts"], 0, async (_path, at) => {
    reads.push(at);
    return at === -1 ? { exists: false } : { exists: true, text: "first line\n" };
  });

  expect(reads).toEqual([-1, 0]);
  expect(change.kind).toBe("added");
  expect(change.regions[0].rows).toEqual([{ kind: "add", text: "first line", next: 1 }]);
});

test("binary and unavailable transitions never fabricate textual changes", async () => {
  const cases: {
    previous: SourceState;
    current: SourceState;
    kind: "added" | "modified" | "deleted";
    action: string;
  }[] = [
    {
      previous: { exists: true },
      current: { exists: true, text: "now readable" },
      kind: "modified",
      action: "Updated asset",
    },
    {
      previous: { exists: true, text: "formerly readable" },
      current: { exists: true },
      kind: "modified",
      action: "Updated asset",
    },
    {
      previous: { exists: false },
      current: { exists: true },
      kind: "added",
      action: "Added asset",
    },
    {
      previous: { exists: true },
      current: { exists: false },
      kind: "deleted",
      action: "Deleted asset",
    },
  ];

  for (const item of cases) {
    const [change] = await prepareStepChanges(["asset.bin"], 1, async (_path, at) =>
      at === 0 ? item.previous : item.current,
    );
    expect(change.kind).toBe(item.kind);
    expect(change.regions).toEqual([]);
    expect(change.failed).toBe(false);
    expect(change.notice).toBe(`${item.action}. This capture does not provide a text comparison.`);
  }
});

test("one failed file remains explicit while healthy files still show every change", async () => {
  const changes = await prepareStepChanges(["broken.ts", "healthy.ts"], 2, async (path, at) => {
    if (path === "broken.ts") {
      throw new Error("Captured blob returned 404.");
    }
    return { exists: true, text: at === 1 ? "old\n" : "new\n" };
  });

  expect(changes).toHaveLength(2);
  expect(changes[0]).toEqual({
    path: "broken.ts",
    kind: "modified",
    regions: [],
    notice: "Could not load this file's changes: Captured blob returned 404.",
    failed: true,
  });
  expect(changes[1].failed).toBe(false);
  expect(changes[1].regions[0].rows).toEqual([
    { kind: "remove", text: "old", old: 1 },
    { kind: "add", text: "new", next: 1 },
  ]);
});

test("a fresh preparation retries a previously failed file", async () => {
  let shouldFail = true;
  const reader: SourceStateReader = async (_path, at) => {
    if (shouldFail) {
      throw new Error("Temporary read failure.");
    }
    return at === 0 ? { exists: false } : { exists: true, text: "recovered\n" };
  };

  const failed = await prepareStepChanges(["retry.ts"], 1, reader);
  expect(failed[0].failed).toBe(true);
  shouldFail = false;
  const recovered = await prepareStepChanges(["retry.ts"], 1, reader);
  expect(recovered[0].failed).toBe(false);
  expect(recovered[0].kind).toBe("added");
  expect(recovered[0].notice).toBeUndefined();
  expect(recovered[0].regions[0].rows).toEqual([{ kind: "add", text: "recovered", next: 1 }]);
});

test("bounded diff failures preserve the file entry and other file changes", async () => {
  const before = Array.from({ length: 2_000 }, (_, index) => `before ${index}`).join("\n");
  const after = Array.from({ length: 2_000 }, (_, index) => `after ${index}`).join("\n");
  const changes = await prepareStepChanges(["large.ts", "small.ts"], 1, async (path, at) => {
    if (path === "large.ts") {
      return { exists: true, text: at === 0 ? before : after };
    }
    return { exists: true, text: at === 0 ? "old" : "new" };
  });

  expect(changes.map((change) => change.path)).toEqual(["large.ts", "small.ts"]);
  expect(changes[0].regions).toEqual([]);
  expect(changes[0].failed).toBe(false);
  expect(changes[0].notice).toContain("too large for an inline comparison");
  expect(changes[1].regions).toHaveLength(1);
});

test("empty files and non-visible byte changes remain represented", async () => {
  const changes = await prepareStepChanges(["empty.ts", "line-endings.ts"], 1, async (path, at) => {
    if (path === "empty.ts") {
      return at === 0 ? { exists: false } : { exists: true, text: "" };
    }
    return { exists: true, text: at === 0 ? "same\r\n" : "same\n" };
  });

  expect(changes).toHaveLength(2);
  expect(changes[0].kind).toBe("added");
  expect(changes[1].kind).toBe("modified");
  for (const change of changes) {
    expect(change.regions).toEqual([]);
    expect(change.failed).toBe(false);
    expect(change.notice).toBe(
      "No visible line differences. File bytes or metadata may have changed.",
    );
  }
});

test("authored pointers bring declarations into compact changes without hiding other edits", async () => {
  const before = Array.from({ length: 90 }, (_, index) => `line ${index + 1}`);
  before[19] = "function initialize() {";
  const after = [...before];
  after[27] = "configureRenderer();";
  after[75] = "releaseRenderer();";
  const reader: SourceStateReader = async (_path, at) => ({
    exists: true,
    text: (at === 2 ? before : after).join("\n"),
  });

  const [guided, ordinary] = await prepareStepChanges(["guided.ts", "ordinary.ts"], 3, reader, [
    { label: "initialize", path: "guided.ts", symbol: "function initialize()", view: "changes" },
    { label: "reference", path: "ordinary.ts", start: 20, view: "file" },
    { label: "outside this step", path: "context.ts", start: 1, view: "changes" },
  ]);

  expect(guided.regions).toHaveLength(3);
  expect(guided.regions[0].rows.map((row) => row.next)).toEqual([17, 18, 19, 20, 21, 22, 23]);
  expect(
    guided.regions.flatMap((region) =>
      region.rows.filter((row) => row.kind === "add").map((row) => row.text),
    ),
  ).toEqual(["configureRenderer();", "releaseRenderer();"]);
  expect(ordinary.regions).toHaveLength(2);
  expect(ordinary.regions.flatMap((region) => region.rows).some((row) => row.next === 20)).toBe(
    false,
  );
});

test("symbol pointers resolve after cumulative edits shift the source", async () => {
  const baseline = Array.from({ length: 70 }, (_, index) => `line ${index + 1}`);
  baseline[8] = "function initialize() {";
  const preceding = ["earlier one", "earlier two", "earlier three", "earlier four", ...baseline];
  const current = ["new import one", "new import two", ...preceding];
  current[24] = "configureRenderer();";
  const [change] = await prepareStepChanges(
    ["source.ts"],
    4,
    async (_path, at) => ({ exists: true, text: (at === 3 ? preceding : current).join("\r\n") }),
    [
      {
        label: "initialize",
        path: "source.ts",
        symbol: "function initialize()",
        count: 2,
        view: "changes",
      },
    ],
  );

  const rows = change.regions.flatMap((region) => region.rows);
  expect(rows.find((row) => row.text === "function initialize() {")).toEqual({
    kind: "same",
    text: "function initialize() {",
    old: 13,
    next: 15,
  });
  expect(rows.some((row) => row.next === 19)).toBe(true);
  expect(rows.filter((row) => row.kind === "add").map((row) => row.text)).toEqual([
    "new import one",
    "new import two",
    "configureRenderer();",
  ]);
});

test("missing symbols and pointers for other versions do not expand a step comparison", async () => {
  const before = Array.from({ length: 70 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[60] = "changed";
  const reader: SourceStateReader = async (_path, at) => ({
    exists: true,
    text: (at === 0 ? before : after).join("\n"),
  });
  const [ordinary] = await prepareStepChanges(["source.ts"], 1, reader);
  const [withReferences] = await prepareStepChanges(["source.ts"], 1, reader, [
    { label: "missing", path: "source.ts", symbol: "does not exist", view: "changes" },
    { label: "old source", path: "source.ts", start: 10, version: "base", view: "changes" },
    { label: "final source", path: "source.ts", start: 20, version: "head", view: "changes" },
  ]);

  expect(withReferences).toEqual(ordinary);
});

test("pointers show readable metadata-only context while binary and deletion handling stay intact", async () => {
  const paths = ["binary.bin", "metadata.ts", "deleted.ts"];
  const changes = await prepareStepChanges(
    paths,
    1,
    async (path, at) => {
      if (path === "binary.bin") {
        return { exists: true };
      }
      if (path === "deleted.ts" && at === 1) {
        return { exists: false };
      }
      return { exists: true, text: "same source\n" };
    },
    paths.map((path) => ({ label: "source", path, start: 1, view: "changes" })),
  );

  expect(changes[0].regions).toEqual([]);
  expect(changes[0].notice).toContain("does not provide a text comparison");
  expect(changes[1].regions[0].rows).toEqual([
    { kind: "same", text: "same source", old: 1, next: 1 },
  ]);
  expect(changes[1].notice).toBeUndefined();
  expect(changes[2].kind).toBe("deleted");
  expect(changes[2].regions[0].rows).toEqual([{ kind: "remove", text: "same source", old: 1 }]);
});

test("overview pointer ranges retain a terminal empty line as display context", async () => {
  const [change] = await prepareStepChanges(
    ["source.ts"],
    1,
    async (_path, at) => ({ exists: true, text: at === 0 ? "old\r\n" : "new\r\n" }),
    [{ label: "whole source", path: "source.ts", view: "changes", start: 1, end: 2 }],
  );

  expect(change.regions[0].rows).toEqual([
    { kind: "remove", text: "old", old: 1 },
    { kind: "add", text: "new", next: 1 },
    { kind: "same", text: "", old: 2, next: 2 },
  ]);
});

test("a pointer to only the final empty line remains selectable without inventing a previous line", async () => {
  const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[0] = "changed";
  const [change] = await prepareStepChanges(
    ["source.ts"],
    1,
    async (_path, at) => ({
      exists: true,
      text: at === 0 ? before.join("\n") : after.join("\n") + "\n",
    }),
    [{ label: "end", path: "source.ts", view: "changes", start: 31 }],
  );

  expect(change.regions).toHaveLength(2);
  expect(change.regions[1].rows.at(-1)).toEqual({
    kind: "same",
    text: "",
    next: 31,
    old: undefined,
  });
  expect(change.regions[0].rows.filter((row) => row.kind !== "same")).toEqual([
    { kind: "remove", text: "line 1", old: 1 },
    { kind: "add", text: "changed", next: 1 },
  ]);
});

test("an empty text file has a single display line when an overview pointer selects it", async () => {
  const [change] = await prepareStepChanges(
    ["empty.ts"],
    1,
    async (_path, at) => (at === 0 ? { exists: false } : { exists: true, text: "" }),
    [{ label: "empty", path: "empty.ts", view: "changes", start: 1 }],
  );

  expect(change.notice).toBeUndefined();
  expect(change.regions[0].rows).toEqual([{ kind: "same", text: "", next: 1, old: undefined }]);
});
