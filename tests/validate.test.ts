import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, ValidationError } from "../skills/code-walkthrough/scripts/validate";
import type {
  BlobInfo,
  FileInfo,
  Lesson,
  Manifest,
  Step,
} from "../skills/code-walkthrough/scripts/types";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: "finish",
    title: "Finish the change",
    file: "main.ts",
    paragraphs: [["Explanation."]],
    changes: { "main.ts": { use: "head" } },
    ...overrides,
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "walkthrough-validator-"));
  directories.push(dir);
  await mkdir(join(dir, "blobs"));
  const manifest: Manifest = {
    schemaVersion: 1,
    repo: "fixture",
    base: "base-ref",
    head: "head-ref",
    files: [],
  };
  const lesson: Lesson = { schemaVersion: 1, title: "A walkthrough", steps: [step()] };
  async function blob(
    source: string | Buffer,
    algorithm: "sha1" | "sha256" = "sha1",
    mode: string | undefined = "100644",
  ): Promise<BlobInfo> {
    const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
    const oid = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    await writeFile(join(dir, "blobs", `${oid}.txt`), bytes);
    return { oid, size: bytes.length, kind: "text", ...(mode === undefined ? {} : { mode }) };
  }
  async function file(
    path: string,
    base?: string | BlobInfo,
    head?: string | BlobInfo,
  ): Promise<FileInfo> {
    let status: FileInfo["status"] = "M";
    if (base === undefined) {
      status = "A";
    } else if (head === undefined) {
      status = "D";
    }

    const info: FileInfo = { path, status };
    if (base !== undefined) {
      info.base = typeof base === "string" ? await blob(base) : base;
    }
    if (head !== undefined) {
      info.head = typeof head === "string" ? await blob(head) : head;
    }
    manifest.files.push(info);
    return info;
  }
  async function save(): Promise<void> {
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(dir, "lesson.json"), JSON.stringify(lesson));
  }
  async function run() {
    await save();
    return validate(dir);
  }
  await file("main.ts", "const answer = 1;\n", "const answer = 2;\n");
  return { dir, manifest, lesson, blob, file, save, run };
}

function opaque(kind: "binary" | "large" | "unavailable", digit = "a", mode = "100644"): BlobInfo {
  return { oid: digit.repeat(40), size: 42, kind, mode };
}

async function problems(
  run: () => Promise<unknown>,
  ...messages: string[]
): Promise<ValidationError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    const failure = error as ValidationError;
    for (const message of messages) {
      expect(failure.message).toContain(message);
    }
    expect(failure.problems.length).toBeGreaterThan(0);
    return failure;
  }
  throw new Error(`Expected validation failure containing: ${messages.join(", ")}`);
}

describe("validator API and cumulative identity", () => {
  test("external source links allow only absolute web URLs", async () => {
    const f = await fixture();
    f.manifest.sourceUrl = "javascript:alert(1)";
    await problems(f.run, "expected an absolute HTTP or HTTPS URL");
    f.manifest.sourceUrl = "https://example.com/project/pull/1";
    expect((await f.run()).ok).toBe(true);
  });
  test("returns counts and validates captured SHA-1 and SHA-256 blobs", async () => {
    const f = await fixture();
    const empty = await f.blob("");
    expect(empty.oid).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    const hello = await f.blob("hello\n");
    expect(hello.oid).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    await f.file("unicode.ts", empty, await f.blob("\uFEFFconst café = '🌈';\r\n", "sha256"));
    f.lesson.steps[0].changes!["unicode.ts"] = { use: "head" };
    expect(await f.run()).toEqual({ ok: true, files: 2, steps: 1, textBlobs: 4 });
  });

  test("starts at base, folds changes, and introduces files before their final form", async () => {
    const f = await fixture();
    await f.file("new.ts", undefined, "export const added = 2;\n");
    f.lesson.steps = [
      step({ id: "base", changes: {}, symbol: "answer = 1" }),
      step({
        id: "partial",
        file: "new.ts",
        changes: { "new.ts": { text: "export const added = (" } },
        symbol: "added",
      }),
      step({
        id: "persists",
        file: "new.ts",
        changes: {},
        paragraphs: [[{ label: "Earlier partial file", path: "new.ts", start: 1 }]],
      }),
      step({
        changes: { "main.ts": { use: "head" }, "new.ts": { text: "export const added = 2;\n" } },
      }),
    ];
    expect((await f.run()).steps).toBe(4); // Invalid language syntax in intermediate steps is intentional.
  });

  test("checks files outside every declared change and selection", async () => {
    const f = await fixture();
    await f.file("forgotten.ts", "old", "new");
    await problems(f.run, 'final "forgotten.ts"', "text differs from head bytes");
  });

  test("rejects text with the right length but different content", async () => {
    const f = await fixture();
    f.lesson.steps[0].changes!["main.ts"] = { text: "const answer = 3;\n" };
    await problems(f.run, "text differs from head bytes");
  });

  for (const [name, actual] of [
    ["CRLF normalization", "\uFEFFhello\n"],
    ["BOM removal", "hello\r\n"],
    ["trailing newline removal", "\uFEFFhello"],
  ]) {
    test(`rejects ${name} in final source`, async () => {
      const f = await fixture();
      f.manifest.files[0].head = await f.blob("\uFEFFhello\r\n");
      f.lesson.steps[0].changes!["main.ts"] = { text: actual };
      await problems(f.run, "text differs from head bytes", "CRLF, BOM and trailing newlines");
    });
  }

  test("accepts exact BOM, CRLF and multibyte source", async () => {
    const f = await fixture();
    const source = "\uFEFFconst 猫 = '🐈';\r\n";
    f.manifest.files[0].head = await f.blob(source);
    f.lesson.steps[0].changes!["main.ts"] = { text: source };
    expect((await f.run()).ok).toBe(true);
  });

  test("requires additions and deletions across the union", async () => {
    const f = await fixture();
    await f.file("added.ts", undefined, "added");
    await f.file("deleted.ts", "deleted", undefined);
    await problems(
      f.run,
      'final "added.ts": missing head file',
      'final "deleted.ts": must be deleted',
    );
    Object.assign(f.lesson.steps[0].changes!, { "added.ts": { use: "head" }, "deleted.ts": null });
    expect((await f.run()).ok).toBe(true);
  });

  test("head references require a known head and null may delete an absent known file", async () => {
    const f = await fixture();
    await f.file("gone.ts", "old", undefined);
    f.lesson.steps[0].changes!["gone.ts"] = { use: "head" };
    await problems(f.run, 'use:"head" requires a captured head');
    f.lesson.steps = [
      step({ id: "delete", changes: { "gone.ts": null } }),
      step({ changes: { "main.ts": { use: "head" }, "gone.ts": null } }),
    ];
    expect((await f.run()).ok).toBe(true);
  });

  test("rejects unknown paths including null changes", async () => {
    const f = await fixture();
    f.lesson.steps[0].changes!["typo.ts"] = null;
    f.lesson.steps[0].file = "not-in-manifest.ts";
    await problems(
      f.run,
      'changes["typo.ts"]: unknown manifest path',
      'unknown manifest path "not-in-manifest.ts"',
    );
  });

  test("handles prototype-like repository paths without inherited properties", async () => {
    const f = await fixture();
    await f.file("__proto__", undefined, "safe");
    f.lesson.steps[0].changes = JSON.parse(
      '{"main.ts":{"use":"head"},"__proto__":{"text":"safe"}}',
    );
    f.lesson.steps[0].file = "__proto__";
    expect((await f.run()).ok).toBe(true);
  });
});

describe("binary and mode metadata", () => {
  test("unread working content has no invented blob identity", async () => {
    const f = await fixture();
    await f.file("locked.ts", undefined, { oid: "", size: 0, kind: "unavailable", mode: "100644" });
    f.lesson.steps[0].changes!["locked.ts"] = { use: "head" };
    expect((await f.run()).ok).toBe(true);
  });
  for (const kind of ["binary", "large", "unavailable"] as const) {
    test(`${kind}: requires head adoption, allows placeholders, rejects source bounds`, async () => {
      const f = await fixture();
      await f.file("asset.bin", opaque(kind), opaque(kind, "b"));
      f.lesson.steps[0].file = "asset.bin";
      await problems(f.run, "snapshot kind/content differs");
      f.lesson.steps[0].changes!["asset.bin"] = { use: "head" };
      f.lesson.steps[0].paragraphs = [[{ label: "Asset", path: "asset.bin", version: "head" }]];
      expect((await f.run()).ok).toBe(true);
      f.lesson.steps[0].focus = [1, 1];
      await problems(f.run, "placeholder has no source lines or symbols");
      delete f.lesson.steps[0].focus;
      f.lesson.steps[0].paragraphs = [
        [{ label: "Bad asset anchor", path: "asset.bin", symbol: "magic" }],
      ];
      await problems(f.run, "placeholder has no source lines or symbols");
    });
  }

  test("rejects text overrides of paths with no textual side", async () => {
    const f = await fixture();
    await f.file("asset.bin", undefined, opaque("binary"));
    f.lesson.steps[0].changes!["asset.bin"] = { text: "not binary" };
    await problems(f.run, "text overrides require a captured text base or head");
  });

  test("textual sides permit intermediate text but cannot substitute for a binary head", async () => {
    const f = await fixture();
    await f.file("converted", "text before", opaque("binary"));
    f.lesson.steps = [
      step({ id: "partial", changes: { converted: { text: "intermediate" } } }),
      step(),
    ];
    await problems(f.run, 'final "converted": snapshot kind/content differs');
    f.lesson.steps[1].changes!.converted = { use: "head" };
    expect((await f.run()).ok).toBe(true);
  });

  test("unchanged binary snapshots need no artificial change", async () => {
    const f = await fixture();
    const info = opaque("binary");
    await f.file("unchanged.bin", info, info);
    expect((await f.run()).ok).toBe(true);
  });

  test("binary additions and deletions participate in final equality", async () => {
    const f = await fixture();
    await f.file("new.bin", undefined, opaque("binary"));
    await f.file("gone.bin", opaque("binary"), undefined);
    await problems(f.run, 'final "new.bin": missing', 'final "gone.bin": must be deleted');
    Object.assign(f.lesson.steps[0].changes!, { "new.bin": { use: "head" }, "gone.bin": null });
    expect((await f.run()).ok).toBe(true);
  });

  test("mode-only changes require head adoption even with exact source", async () => {
    const f = await fixture();
    const source = "#!/bin/sh\n";
    await f.file("run.sh", await f.blob(source), await f.blob(source, "sha1", "100755"));
    f.lesson.steps[0].changes!["run.sh"] = { text: source };
    await problems(f.run, 'final "run.sh": mode 100644 differs from head 100755');
    f.lesson.steps[0].changes!["run.sh"] = { use: "head" };
    f.lesson.steps.push(step({ id: "keep-mode", changes: { "run.sh": { text: source } } }));
    expect((await f.run()).ok).toBe(true);
  });

  test("text does not invent a newly specified head mode", async () => {
    const f = await fixture();
    delete f.manifest.files[0].base!.mode;
    f.lesson.steps[0].changes!["main.ts"] = { text: "const answer = 2;\n" };
    await problems(f.run, "mode (unspecified) differs from head 100644");
  });
});

describe("selected versions, prose source links and focus", () => {
  test("allows base/head links independently of the current step version", async () => {
    const f = await fixture();
    await f.file("deleted.ts", "old line\n", undefined);
    f.lesson.steps[0].changes!["deleted.ts"] = null;
    f.lesson.steps[0].version = "base";
    f.lesson.steps[0].symbol = "answer = 1";
    f.lesson.steps[0].paragraphs = [
      [
        { label: "Before", path: "main.ts", version: "base", symbol: "answer = 1" },
        { label: "After", path: "main.ts", version: "head", start: 1, end: 2 },
        { label: "Deleted source", path: "deleted.ts", version: "base", start: 1 },
      ],
    ];
    expect((await f.run()).ok).toBe(true);
  });

  test("rejects links before an addition exists even when a later step adds it", async () => {
    const f = await fixture();
    await f.file("future.ts", undefined, "future");
    f.lesson.steps = [
      step({
        id: "early",
        file: "future.ts",
        paragraphs: [[{ label: "Too early", path: "future.ts" }]],
      }),
      step({ changes: { "future.ts": { use: "head" } } }),
    ];
    await problems(
      f.run,
      '.file: "future.ts" does not exist in selected version "step"',
      '"Too early"): "future.ts" does not exist',
    );
    f.lesson.steps[0].version = "head";
    f.lesson.steps[0].paragraphs = [[{ label: "Preview", path: "future.ts", version: "head" }]];
    expect((await f.run()).ok).toBe(true);
  });

  test("rejects nonexistent selected versions for binary placeholders too", async () => {
    const f = await fixture();
    await f.file("new.bin", undefined, opaque("binary"));
    f.lesson.steps[0].changes!["new.bin"] = { use: "head" };
    f.lesson.steps[0].file = "new.bin";
    f.lesson.steps[0].version = "base";
    await problems(f.run, '"new.bin" does not exist in selected version "base"');
  });

  test("reports unknown, missing and ambiguous source links without silent fallback", async () => {
    const f = await fixture();
    f.manifest.files[0].head = await f.blob("function repeated() {}\nrepeated();\nunique();");
    f.lesson.steps[0].paragraphs = [
      [
        { label: "Unknown", path: "wrong.ts" },
        { label: "Missing", path: "main.ts", symbol: "absent" },
        { label: "Ambiguous", path: "main.ts", symbol: "repeated" },
      ],
    ];
    await problems(
      f.run,
      'unknown manifest path "wrong.ts"',
      'symbol "absent" was not found',
      'symbol "repeated" is ambiguous (2 matching lines: 1, 2)',
    );
  });

  test("checks both link and step line bounds in selected versions", async () => {
    const f = await fixture();
    f.lesson.steps[0].focus = [1, 3];
    f.lesson.steps[0].paragraphs = [
      [{ label: "Out of bounds", path: "main.ts", version: "base", start: 3 }],
    ];
    await problems(f.run, "line range 1-3 exceeds", "line range 3-3 exceeds", "base, 2 lines");
    f.lesson.steps[0].focus = [1, 2];
    f.lesson.steps[0].paragraphs = [[{ label: "Final empty line", path: "main.ts", start: 2 }]];
    expect((await f.run()).ok).toBe(true);
  });

  test("resolves symbol/count for steps and links and bounds the whole span", async () => {
    const f = await fixture();
    f.lesson.steps[0].symbol = "answer";
    f.lesson.steps[0].count = 2;
    f.lesson.steps[0].paragraphs = [
      [{ label: "Answer", path: "main.ts", symbol: "answer", count: 2 }],
    ];
    expect((await f.run()).ok).toBe(true);
    f.lesson.steps[0].count = 3;
    f.lesson.steps[0].paragraphs = [
      [{ label: "Too long", path: "main.ts", symbol: "answer", count: 3 }],
    ];
    const failure = await problems(f.run, "line range 1-3 exceeds");
    expect(failure.problems).toHaveLength(2);
  });

  test("step symbols also reject missing and ambiguous matches", async () => {
    const f = await fixture();
    f.lesson.steps[0].symbol = "missing";
    await problems(f.run, 'symbol "missing" was not found');
    f.manifest.files[0].head = await f.blob("same\nsame");
    f.lesson.steps[0].symbol = "same";
    await problems(f.run, 'symbol "same" is ambiguous');
  });
});

describe("capture integrity and untrusted input", () => {
  test("hashes Git framing and raw bytes, not plain file content", async () => {
    const f = await fixture();
    const bytes = Buffer.from("content");
    const oid = createHash("sha1").update(bytes).digest("hex");
    await writeFile(join(f.dir, "blobs", `${oid}.txt`), bytes);
    f.manifest.files[0].head = { oid, size: bytes.length, kind: "text" };
    await problems(f.run, "Git blob hash mismatch");
  });

  for (const algorithm of ["sha1", "sha256"] as const) {
    test(`detects tampered ${algorithm} blobs`, async () => {
      const f = await fixture();
      const info = await f.blob("original", algorithm);
      f.manifest.files[0].head = info;
      await writeFile(join(f.dir, "blobs", `${info.oid}.txt`), "tampered");
      await problems(f.run, "Git blob hash mismatch");
    });
  }

  test("checks every metadata byte length even when OIDs are shared", async () => {
    const f = await fixture();
    f.manifest.files[0].head = { ...f.manifest.files[0].base!, size: 999 };
    await problems(f.run, ".head.size: declared 999 bytes, blob contains 18");
  });

  test("checks blobs unused by every selection and change", async () => {
    const f = await fixture();
    const info = await f.blob("unused");
    await f.file("unused.ts", info, info);
    await rm(join(f.dir, "blobs", `${info.oid}.txt`));
    await problems(f.run, "cannot read UTF-8 text snapshot");
  });

  test("rejects invalid UTF-8 captured as text and invalid Unicode overrides", async () => {
    const f = await fixture();
    f.manifest.files[0].head = await f.blob(Buffer.from([0xff, 0xfe]));
    await problems(f.run, "cannot read UTF-8 text snapshot");
    f.manifest.files[0].head = await f.blob("valid");
    f.lesson.steps[0].changes!["main.ts"] = { text: "\uD800" };
    await problems(f.run, "unpaired UTF-16 surrogate");
  });

  for (const oid of [
    "../secret",
    "a".repeat(39),
    "a".repeat(41),
    "A".repeat(40),
    "../" + "a".repeat(40),
    "a".repeat(40) + "/../secret",
  ]) {
    test(`rejects unsafe or malformed OID ${JSON.stringify(oid)}`, async () => {
      const f = await fixture();
      f.manifest.files[0].head!.oid = oid;
      await problems(
        f.run,
        ".oid: expected a lowercase 40-character SHA-1 or 64-character SHA-256",
      );
    });
  }

  test("rejects traversal paths before opening blobs", async () => {
    const f = await fixture();
    f.manifest.files[0].path = "../outside.ts";
    f.lesson.steps[0].file = "C:\\secret.txt";
    f.lesson.steps[0].changes = { "/absolute": null, "folder/../secret": null };
    const failure = await problems(f.run, "relative slash-separated path");
    expect(failure.problems.length).toBeGreaterThanOrEqual(4);
  });

  test("rejects a redirected blobs directory without reading its contents", async () => {
    const f = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "walkthrough-outside-"));
    directories.push(outside);
    await rm(join(f.dir, "blobs"), { recursive: true });
    await symlink(outside, join(f.dir, "blobs"), process.platform === "win32" ? "junction" : "dir");
    await problems(f.run, "blobs/: expected a directory, not a symlink");
  });

  test("rejects directories masquerading as blob files", async () => {
    const f = await fixture();
    const path = join(f.dir, "blobs", `${f.manifest.files[0].head!.oid}.txt`);
    await rm(path);
    await mkdir(path);
    await problems(f.run, "expected a regular file");
  });

  test("aggregates parse failures from both documents", async () => {
    const f = await fixture();
    await writeFile(join(f.dir, "manifest.json"), "{");
    await writeFile(join(f.dir, "lesson.json"), "undefined");
    const error = await problems(
      () => validate(f.dir),
      "manifest.json: cannot read valid UTF-8 JSON",
      "lesson.json: cannot read valid UTF-8 JSON",
    );
    expect(error.problems).toHaveLength(2);
  });

  test("rejects invalid root shapes and missing files", async () => {
    const f = await fixture();
    await writeFile(join(f.dir, "manifest.json"), "null");
    await writeFile(join(f.dir, "lesson.json"), "[]");
    await problems(
      () => validate(f.dir),
      "manifest.json: expected an object",
      "lesson.json: expected an object",
    );
    await rm(join(f.dir, "lesson.json"));
    await problems(() => validate(f.dir), "lesson.json: cannot read");
    await problems(() => validate(null as unknown as string), "expected a nonempty path string");
  });

  test("checks nonempty unique step IDs, titles and structured paragraphs", async () => {
    const f = await fixture();
    f.lesson.title = " ";
    f.lesson.steps = [
      step({ id: "", title: "", paragraphs: [] }),
      step({ id: "same" }),
      step({ id: "same", paragraphs: [[" "]] }),
    ];
    await problems(
      f.run,
      "lesson.title",
      ".id: expected a nonempty string",
      ".title: expected a nonempty string",
      ".paragraphs: expected",
      "duplicate step ID",
      "paragraph must contain",
    );
  });

  test("rejects duplicate manifest paths and inconsistent status", async () => {
    const f = await fixture();
    f.manifest.files.push({ ...f.manifest.files[0], status: "A" });
    await problems(f.run, "duplicate path", "inconsistent with base/head presence");
  });

  test("rejects unknown keys at each schema level", async () => {
    const f = await fixture();
    Object.assign(f.manifest, { typo: true });
    Object.assign(f.manifest.files[0], { typo: true });
    Object.assign(f.manifest.files[0].head!, { typo: true });
    Object.assign(f.lesson, { typo: true });
    Object.assign(f.lesson.steps[0], { typo: true });
    f.lesson.steps[0].paragraphs = [[{ label: "Link", path: "main.ts", typo: true } as never]];
    f.lesson.steps[0].changes!["main.ts"] = { use: "head", typo: true } as never;
    const failure = await problems(f.run, 'unknown key "typo"');
    expect(failure.problems.filter((p) => p.includes('unknown key "typo"'))).toHaveLength(7);
  });

  for (const [name, mutation, message] of [
    [
      "bad changes map",
      (s: Step) => {
        s.changes = [] as never;
      },
      "expected an object mapping",
    ],
    [
      "bad change",
      (s: Step) => {
        s.changes = { "main.ts": { text: 5 } as never };
      },
      "expected exactly",
    ],
    [
      "mixed change",
      (s: Step) => {
        s.changes = { "main.ts": { text: "x", use: "head" } };
      },
      "expected exactly",
    ],
    [
      "bad version",
      (s: Step) => {
        s.version = "latest" as never;
      },
      ".version: expected",
    ],
    [
      "fractional focus",
      (s: Step) => {
        s.focus = [1, 1.5];
      },
      ".focus: expected",
    ],
    [
      "reversed focus",
      (s: Step) => {
        s.focus = [2, 1];
      },
      ".focus: expected",
    ],
    [
      "zero count",
      (s: Step) => {
        s.symbol = "answer";
        s.count = 0;
      },
      ".count: expected",
    ],
    [
      "orphan count",
      (s: Step) => {
        s.count = 2;
      },
      ".count: requires symbol",
    ],
    [
      "mixed anchors",
      (s: Step) => {
        s.focus = [1, 1];
        s.symbol = "answer";
      },
      "choose either focus or symbol",
    ],
    [
      "orphan end",
      (s: Step) => {
        s.paragraphs = [[{ label: "Link", path: "main.ts", end: 2 }]];
      },
      ".end: requires start",
    ],
    [
      "reversed range",
      (s: Step) => {
        s.paragraphs = [[{ label: "Link", path: "main.ts", start: 2, end: 1 }]];
      },
      ".end: must be >= start",
    ],
    [
      "mixed link anchors",
      (s: Step) => {
        s.paragraphs = [[{ label: "Link", path: "main.ts", start: 1, symbol: "answer" }]];
      },
      "choose either start/end or symbol",
    ],
    [
      "bad paragraph",
      (s: Step) => {
        s.paragraphs = ["not an array"] as never;
      },
      "expected a nonempty array of strings/source links",
    ],
    [
      "bad part",
      (s: Step) => {
        s.paragraphs = [[null]] as never;
      },
      "expected a string or SourceLink",
    ],
  ] as const) {
    test(`rejects ${name}`, async () => {
      const f = await fixture();
      mutation(f.lesson.steps[0]);
      await problems(f.run, message);
    });
  }

  test("caps aggregate errors and keeps a count of omitted problems", async () => {
    const f = await fixture();
    f.lesson.steps = Array.from({ length: 80 }, (_, i) => step({ id: String(i), title: "" }));
    const failure = await problems(f.run, "30 further problem(s) omitted");
    expect(failure.problems).toHaveLength(50);
    expect(failure.omitted).toBe(30);
  });
});
