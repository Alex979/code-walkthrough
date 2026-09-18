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

test("large replacements keep every removed and added line alongside other file changes", async () => {
  const before = Array.from({ length: 2_000 }, (_, index) => `before ${index}`).join("\n");
  const after = Array.from({ length: 2_000 }, (_, index) => `after ${index}`).join("\n");
  const changes = await prepareStepChanges(
    ["large.ts", "small.ts"],
    1,
    async (path, at) => {
      if (path === "large.ts") {
        return { exists: true, text: at === 0 ? before : after };
      }
      return { exists: true, text: at === 0 ? "old" : "new" };
    },
    [{ label: "deep target", path: "large.ts", view: "changes", start: 1750, end: 1752 }],
  );

  expect(changes.map((change) => change.path)).toEqual(["large.ts", "small.ts"]);
  const rows = changes[0].regions.flatMap((region) => region.rows);
  expect(
    rows
      .filter((row) => row.kind !== "add")
      .map((row) => row.text)
      .join("\n"),
  ).toBe(before);
  expect(
    rows
      .filter((row) => row.kind !== "remove")
      .map((row) => row.text)
      .join("\n"),
  ).toBe(after);
  expect(rows.filter((row) => row.kind === "add").map((row) => row.next)).toEqual(
    Array.from({ length: 2000 }, (_, index) => index + 1),
  );
  expect(changes[0].failed).toBe(false);
  expect(changes[0].coarse).toBe(true);
  expect(changes[0].notice).toBeUndefined();
  expect(
    rows.filter((row) => row.next && row.next >= 1750 && row.next <= 1752).map((row) => row.text),
  ).toEqual(["after 1749", "after 1750", "after 1751"]);
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

test("consecutive construction steps retain the declaration and earlier excerpt in current coordinates", async () => {
  const prefix = Array.from({ length: 20 }, (_, index) => `existing ${index}`);
  const setup = Array.from({ length: 12 }, (_, index) => `  setup${index}();`);
  const search = Array.from({ length: 10 }, (_, index) => `  search${index}();`);
  const positions = Array.from({ length: 9 }, (_, index) => `  position${index}();`);
  const states = [
    prefix,
    [...prefix, "function layout() {", ...setup, "}"],
    [...prefix, "function layout() {", ...setup, ...search, "}"],
    [...prefix, "function layout() {", ...setup, ...search, ...positions, "}"],
  ];
  const reader: SourceStateReader = async (_path, at) => ({
    exists: true,
    text: states[at].join("\n"),
  });
  const first = await prepareStepChanges(["layout.ts"], 1, reader);
  const second = await prepareStepChanges(["layout.ts"], 2, reader, [], first);
  const third = await prepareStepChanges(["layout.ts"], 3, reader, [], second);

  for (const changes of [second, third]) {
    expect(changes[0].regions).toHaveLength(1);
    expect(changes[0].regions[0].continued).toBe(true);
    expect(changes[0].regions[0].rows[0].text).toBe(first[0].regions[0].rows[0].text);
    expect(changes[0].regions[0].rows.find((row) => row.text === "function layout() {")).toEqual({
      kind: "same",
      text: "function layout() {",
      old: 21,
      next: 21,
    });
    expect(changes[0].regions[0].rows.find((row) => row.text === setup[0])?.kind).toBe("same");
  }
  expect(
    third[0].regions[0].rows.filter((row) => row.kind === "add").map((row) => row.text),
  ).toEqual(positions);
  expect(third[0].regions[0].rows.find((row) => row.text === search[0])?.kind).toBe("same");
});

test("continuing replacements and deletions map old display lines without losing other changes", async () => {
  const initial = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  const firstState = [
    ...initial.slice(0, 25),
    ...Array.from({ length: 12 }, (_, index) => `introduced ${index}`),
    ...initial.slice(25),
  ];
  const secondState = [...firstState];
  secondState.splice(27, 4, "replacement");
  secondState[95] = "distant change";
  secondState.unshift("new preamble");
  const states = [initial, firstState, secondState];
  const reader: SourceStateReader = async (_path, at) => ({
    exists: true,
    text: states[at].join("\n"),
  });
  const first = await prepareStepChanges(["layout.ts"], 1, reader);
  const [second] = await prepareStepChanges(["layout.ts"], 2, reader, [], first);
  expect(second.regions).toHaveLength(3);
  expect(second.regions[1].continued).toBe(true);
  expect(second.regions[0].continued).toBeUndefined();
  expect(second.regions[2].continued).toBeUndefined();
  const rows = second.regions.flatMap((region) => region.rows);
  expect(rows.filter((row) => row.kind === "remove").map((row) => row.text)).toEqual([
    "introduced 2",
    "introduced 3",
    "introduced 4",
    "introduced 5",
    "line 87",
  ]);
  expect(rows.filter((row) => row.kind === "add").map((row) => row.text)).toEqual([
    "new preamble",
    "replacement",
    "distant change",
  ]);
  expect(rows.find((row) => row.text === "introduced 11")).toEqual({
    kind: "same",
    text: "introduced 11",
    old: 37,
    next: 35,
  });
});

test("unrelated methods, other files, and pointer-only context never manufacture a continuation", async () => {
  const initial = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
  const firstState = [...initial];
  firstState[12] = "first method edit";
  const secondState = [...firstState];
  secondState[80] = "other method edit";
  const states = [initial, firstState, secondState];
  const reader: SourceStateReader = async (_path, at) => ({
    exists: true,
    text: states[at].join("\n"),
  });
  const first = await prepareStepChanges(["source.ts"], 1, reader, [
    { path: "source.ts", label: "other method reference", view: "changes", start: 80, end: 84 },
  ]);
  expect(first[0].regions).toHaveLength(2);
  const [second] = await prepareStepChanges(["source.ts"], 2, reader, [], first);
  expect(second.regions).toHaveLength(1);
  expect(second.regions[0].continued).toBeUndefined();
  expect(second.regions[0].rows.some((row) => row.text === "first method edit")).toBe(false);

  const otherFile = await prepareStepChanges(["other.ts"], 2, reader, [], first);
  expect(otherFile[0].regions[0].continued).toBeUndefined();
  const contextOnly = await prepareStepChanges(
    ["source.ts"],
    2,
    async () => ({ exists: true, text: firstState.join("\n") }),
    [{ path: "source.ts", label: "same method", view: "changes", start: 13 }],
    first,
  );
  expect(contextOnly[0].regions[0].continued).toBeUndefined();
});

test("coarse or unreadable predecessors cannot claim excerpt continuity", async () => {
  const initial = Array.from({ length: 2000 }, (_, index) => `original ${index}`).join("\n");
  const replacement = Array.from({ length: 2000 }, (_, index) => `replacement ${index}`).join("\n");
  const states = [initial, replacement, replacement + "\nappended"];
  const reader: SourceStateReader = async (_path, at) => ({ exists: true, text: states[at] });
  const coarse = await prepareStepChanges(["source.ts"], 1, reader);
  expect(coarse[0].coarse).toBe(true);
  const [following] = await prepareStepChanges(["source.ts"], 2, reader, [], coarse);
  expect(following.regions[0].continued).toBeUndefined();
  expect(following.regions[0].rows).toHaveLength(4);
  const [nextCoarse] = await prepareStepChanges(["source.ts"], 1, reader, [], [following]);
  expect(nextCoarse.coarse).toBe(true);
  expect(nextCoarse.regions.every((region) => !region.continued)).toBe(true);
  const unreadable = await prepareStepChanges(
    ["source.ts"],
    2,
    async () => ({ exists: true }),
    [],
    coarse,
  );
  expect(unreadable[0].regions).toEqual([]);
});

test("a small newly created file retains its source when the following step appends code", async () => {
  const firstSource = Array.from({ length: 55 }, (_, index) => `introduced ${index}`);
  const appended = Array.from({ length: 50 }, (_, index) => `appended ${index}`);
  const states = [firstSource, [...firstSource, ...appended]];
  const reader: SourceStateReader = async (_path, at) => {
    if (at === -1) {
      return { exists: false };
    }
    return { exists: true, text: states[at].join("\n") };
  };
  // Another file in the creation step must not prevent same-source continuity.
  const first = await prepareStepChanges(["source.ts", "other.ts"], 0, reader);
  const [second] = await prepareStepChanges(["source.ts"], 1, reader, [], first);
  expect(second.regions).toHaveLength(1);
  expect(second.regions[0].continued).toBe(true);
  expect(
    second.regions[0].rows.filter((row) => row.kind === "same").map((row) => row.text),
  ).toEqual(firstSource);
  expect(second.regions[0].rows.filter((row) => row.kind === "add").map((row) => row.text)).toEqual(
    appended,
  );
});

test("a new method after a large freshly introduced file retains only nearby context", async () => {
  const firstSource = [
    "import { helper } from 'helper';",
    ...Array.from({ length: 200 }, (_, index) => `existing ${index}`),
    "function first() {",
    "  helper();",
    "}",
  ];
  const secondSource = [...firstSource, "", "function second() {", "  prepare();", "}"];
  const reader: SourceStateReader = async (_path, at) => {
    if (at === 0) {
      return { exists: false };
    }
    return { exists: true, text: (at === 1 ? firstSource : secondSource).join("\n") };
  };
  const first = await prepareStepChanges(["source.ts"], 1, reader);
  expect(first[0].kind).toBe("added");
  const [second] = await prepareStepChanges(["source.ts"], 2, reader, [], first);
  expect(second.regions).toHaveLength(1);
  expect(second.regions[0].continued).toBe(true);
  expect(second.regions[0].rows.some((row) => row.text.includes("import"))).toBe(false);
  expect(second.regions[0].rows.filter((row) => row.kind === "same")).toHaveLength(80);
  expect(second.regions[0].rows.at(-1)?.text).toBe("}");
});

test("edits inside a large created file retain separate bounded windows in exact coordinates", async () => {
  const firstSource = Array.from({ length: 500 }, (_, index) => `introduced ${index + 1}`);
  const secondSource = [...firstSource];
  secondSource[150] = "replacement near start";
  secondSource[400] = "replacement near end";
  secondSource.unshift("new preamble");
  const thirdSource = [...secondSource];
  thirdSource[250] = "unrelated later edit";
  const states = [firstSource, secondSource, thirdSource];
  const reader: SourceStateReader = async (_path, at) => {
    if (at === -1) {
      return { exists: false };
    }
    return { exists: true, text: states[at].join("\n") };
  };
  const first = await prepareStepChanges(["source.ts"], 0, reader);
  const second = await prepareStepChanges(["source.ts"], 1, reader, [], first);
  expect(second[0].regions).toHaveLength(3);
  for (const region of second[0].regions) {
    expect(region.continued).toBe(true);
    expect(region.rows.filter((row) => row.old !== undefined)).toHaveLength(80);
  }
  const rows = second[0].regions.flatMap((region) => region.rows);
  expect(rows.filter((row) => row.kind === "add").map((row) => row.text)).toEqual([
    "new preamble",
    "replacement near start",
    "replacement near end",
  ]);
  expect(rows.find((row) => row.text === "introduced 400")).toEqual({
    kind: "same",
    text: "introduced 400",
    old: 400,
    next: 401,
  });
  expect(rows.some((row) => row.text === "introduced 250")).toBe(false);

  const [third] = await prepareStepChanges(["source.ts"], 2, reader, [], second);
  expect(third.regions).toHaveLength(1);
  expect(third.regions[0].continued).toBeUndefined();
  expect(third.regions[0].rows).toHaveLength(8);
});

test("a separate method after a blank line does not inherit the previous method excerpt", async () => {
  const baseline = ["class Layout {", "}"];
  const firstSource = [
    baseline[0],
    "function first() {",
    ...Array.from({ length: 20 }, (_, index) => `  prepare${index}();`),
    "}",
    "",
    "}",
  ];
  const secondSource = [...firstSource.slice(0, -1), "function second() {", "  next();", "}", "}"];
  const states = [baseline, firstSource, secondSource];
  const reader: SourceStateReader = async (_path, at) => ({
    exists: true,
    text: states[at].join("\n"),
  });
  const first = await prepareStepChanges(["source.ts"], 1, reader);
  const [second] = await prepareStepChanges(["source.ts"], 2, reader, [], first);
  expect(second.regions).toHaveLength(1);
  expect(second.regions[0].continued).toBeUndefined();
  expect(second.regions[0].rows.some((row) => row.text === "function first() {")).toBe(false);
});
