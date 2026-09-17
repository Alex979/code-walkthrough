import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { capture, parseArgs, type CaptureOptions } from "../scripts/capture";
import type { FileInfo, Manifest } from "../viewer/src/types";

const temporary: string[] = [];
const environment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Capture Tests",
  GIT_AUTHOR_EMAIL: "capture@example.invalid",
  GIT_COMMITTER_NAME: "Capture Tests",
  GIT_COMMITTER_EMAIL: "capture@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function run(exe: string, args: string[], cwd: string, input?: Buffer | string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(exe, args, { cwd, env: environment, encoding: "buffer", maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${exe} ${args.join(" ")}: ${stderr.toString() || error.message}`));
      else resolve(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

async function fixture(format: "sha1" | "sha256" = "sha1") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "walkthrough-capture-"));
  temporary.push(root);
  const repo = path.join(root, "repo");
  await fs.mkdir(repo);
  const git = async (...args: string[]) => (await run("git", args, repo)).toString("utf8").trim();
  await git("init", "--initial-branch=main", `--object-format=${format}`);
  await git("config", "core.autocrlf", "false");
  await git("config", "core.filemode", "false");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.hooksPath", path.join(root, "no-hooks"));
  const put = async (name: string, content: string | Buffer) => {
    const target = path.join(repo, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  };
  const commit = async (message: string) => {
    await git("add", "--all");
    await git("commit", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  let serial = 0;
  const output = () => path.join(root, `capture-${++serial}`);
  const snap = (opts: Omit<CaptureOptions, "repo" | "out">, out = output()) => capture({ repo, out, ...opts });
  return { root, repo, git, put, commit, output, snap };
}

afterEach(async () => {
  for (const root of temporary.splice(0)) {
    // Only delete a validated, known mkdtemp child of the OS temporary directory.
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("walkthrough-capture-")) throw new Error("Unsafe test cleanup path");
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
});

function file(manifest: Manifest, name: string): FileInfo {
  const result = manifest.files.find(entry => entry.path === name);
  if (!result) throw new Error(`No captured file ${JSON.stringify(name)}`);
  return result;
}

function blobOid(bytes: Buffer, algorithm = "sha1") {
  return createHash(algorithm).update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}

async function assertStored(out: string, info: FileInfo["head"], content: Buffer | string) {
  expect(info?.kind).toBe("text");
  expect(await fs.readFile(path.join(out, "blobs", `${info!.oid}.txt`))).toEqual(Buffer.from(content));
}

/** Fingerprint actual Git files, not `git status`, which can refresh the index. */
async function inventory(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (current: string, prefix: string) => {
    for (const entry of (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target, name);
      else if (entry.isSymbolicLink()) result[name] = `link:${await fs.readlink(target)}`;
      else result[name] = createHash("sha256").update(await fs.readFile(target)).digest("hex");
    }
  };
  await visit(directory, "");
  return result;
}

describe("revision scopes", () => {
  test("root commit uses an empty tree and writes a standalone schema-1 snapshot", async () => {
    const f = await fixture();
    await f.put("hello.ts", "export const hello = 'world';\n");
    const root = await f.commit("root");
    const out = f.output();
    const manifest = await f.snap({ commit: root }, out);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.head).toBe(root);
    expect(manifest.base).toBe(await f.git("hash-object", "-t", "tree", "--stdin"));
    expect(manifest.scope).toMatchObject({ kind: "commit", emptyBase: true, baseRevision: null, headRevision: root });
    expect(file(manifest, "hello.ts").status).toBe("A");
    await assertStored(out, file(manifest, "hello.ts").head, "export const hello = 'world';\n");
    expect(JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8"))).toEqual(manifest);
    await f.put("hello.ts", "later edits");
    await assertStored(out, file(manifest, "hello.ts").head, "export const hello = 'world';\n");
  });

  test("commit union retains unchanged context, additions, deletions and mode-only changes", async () => {
    const f = await fixture();
    await f.put("context.txt", "unchanged");
    await f.put("delete.txt", "deleted later");
    await f.put("change.txt", "before");
    await f.put("executable.sh", "echo hi\n");
    const base = await f.commit("base");
    await fs.unlink(path.join(f.repo, "delete.txt"));
    await f.put("change.txt", "after");
    await f.put("added.txt", "new");
    await f.git("add", "--all");
    await f.git("update-index", "--chmod=+x", "executable.sh");
    await f.git("commit", "-m", "changes");
    const head = await f.git("rev-parse", "HEAD");
    const out = f.output();
    const manifest = await f.snap({ commit: head }, out);
    expect(manifest.base).toBe(base);
    expect(manifest.files.map(entry => [entry.path, entry.status])).toEqual([
      ["added.txt", "A"], ["change.txt", "M"], ["context.txt", ""], ["delete.txt", "D"], ["executable.sh", "M"],
    ]);
    expect(file(manifest, "executable.sh").base?.oid).toBe(file(manifest, "executable.sh").head?.oid);
    expect(file(manifest, "executable.sh").head?.mode).toBe("100755");
    await assertStored(out, file(manifest, "change.txt").base, "before");
    await assertStored(out, file(manifest, "change.txt").head, "after");
    expect((await fs.readdir(path.join(out, "blobs"))).length).toBe(6);
  });

  test("branch and three-dot ranges use the merge-base; two-dot ranges use explicit endpoints", async () => {
    const f = await fixture();
    await f.put("common.txt", "common");
    const ancestor = await f.commit("common");
    await f.git("checkout", "-b", "feature");
    await f.put("feature.txt", "feature");
    const feature = await f.commit("feature");
    await f.git("checkout", "main");
    await f.put("main-only.txt", "main");
    const main = await f.commit("main advances");
    const branch = await f.snap({ branch: "feature", base: "main" });
    const threeDot = await f.snap({ range: "main...feature" });
    const twoDot = await f.snap({ range: "main..feature" });
    expect(branch.base).toBe(ancestor);
    expect(branch.head).toBe(feature);
    expect(branch.scope).toMatchObject({ baseRevision: main, headRevision: feature, mergeBase: ancestor });
    expect(threeDot.base).toBe(ancestor);
    expect(threeDot.files).toEqual(branch.files);
    expect(twoDot.base).toBe(main);
    expect(file(twoDot, "main-only.txt").status).toBe("D");
    expect(branch.files.some(entry => entry.path === "main-only.txt")).toBe(false);
  });

  test("merge commit compares to its first parent", async () => {
    const f = await fixture();
    await f.put("common", "base");
    await f.commit("root");
    await f.git("checkout", "-b", "side");
    await f.put("side", "side");
    await f.commit("side");
    await f.git("checkout", "main");
    await f.put("main", "main");
    const firstParent = await f.commit("main");
    await f.git("merge", "--no-ff", "side", "-m", "merge");
    const manifest = await f.snap({ commit: "HEAD" });
    expect(manifest.base).toBe(firstParent);
    expect(file(manifest, "side").status).toBe("A");
    expect(file(manifest, "main").status).toBe("");
    expect(manifest.scope?.parents).toHaveLength(2);
  });

  test("PR resolves through gh, uses existing OIDs and never fetches or changes refs", async () => {
    const f = await fixture();
    await f.put("common", "base");
    const ancestor = await f.commit("root");
    await f.git("checkout", "-b", "topic");
    await f.put("topic", "topic");
    const headRefOid = await f.commit("topic");
    await f.git("checkout", "main");
    await f.put("base-only", "base");
    const baseRefOid = await f.commit("base advances");
    const before = await inventory(f.repo);
    const url = "https://github.example/org/repo/pull/42";
    for (const requested of [url, 42]) {
      const manifest = await capture({ repo: f.repo, out: f.output(), pr: requested }, {
        gh: async (args, cwd) => {
          expect(cwd).toBe(await fs.realpath(f.repo));
          expect(args.slice(0, 4)).toEqual(["pr", "view", String(requested), "--json"]);
          return JSON.stringify({ number: 42, url, title: "PR title", baseRefName: "main", headRefName: "topic", baseRefOid, headRefOid });
        },
      });
      expect(manifest.base).toBe(ancestor);
      expect(manifest.head).toBe(headRefOid);
      expect(manifest.sourceUrl).toBe(url);
      expect(manifest.scope).toMatchObject({ kind: "pr", baseRevision: baseRefOid, headRevision: headRefOid, mergeBase: ancestor });
    }
    expect(await inventory(f.repo)).toEqual(before);
    await expect(capture({ repo: f.repo, out: f.output(), pr: 42 }, {
      gh: async () => JSON.stringify({ number: 42, url, baseRefName: "main", headRefName: "topic", baseRefOid, headRefOid: "f".repeat(40) }),
    })).rejects.toThrow("git fetch <verified-base-remote>");
    await expect(capture({ repo: f.repo, out: f.output(), pr: 42 }, {
      gh: async () => { throw new Error("not authenticated"); },
    })).rejects.toThrow("Authenticated PR resolution through gh failed");
    expect(await inventory(f.repo)).toEqual(before);
  });

  test("shallow boundary is not mislabeled as a root commit", async () => {
    const f = await fixture();
    await f.put("a", "first");
    await f.commit("first");
    await f.put("a", "second");
    const head = await f.commit("second");
    // Mark the tip shallow without removing its actual commit parent header.
    await fs.writeFile(path.join(f.repo, ".git", "shallow"), `${head}\n`);
    const manifest = await f.snap({ commit: "HEAD" });
    expect(manifest.scope?.emptyBase).toBe(false);
    expect(file(manifest, "a").status).toBe("M");
  });
});

describe("dirty snapshots", () => {
  test("default captures raw working bytes and nonignored untracked; staged captures index only", async () => {
    const f = await fixture();
    await f.put(".gitignore", "ignored*\n");
    for (const name of ["both.txt", "deleted.txt", "staged-deleted.txt", "context.txt"]) await f.put(name, "HEAD\n");
    await f.put("ignored-tracked.txt", "tracked despite ignore\n");
    await f.git("add", "--force", "ignored-tracked.txt");
    const head = await f.commit("base");
    await f.put("both.txt", "index\n");
    await f.put("staged-add.txt", "index addition\n");
    await f.git("add", "both.txt", "staged-add.txt");
    await f.git("rm", "staged-deleted.txt");
    await f.put("both.txt", "working\r\n");
    await f.put("staged-add.txt", "working addition\n");
    await fs.unlink(path.join(f.repo, "deleted.txt"));
    await f.put("untracked.txt", "untracked\n");
    await f.put("ignored-secret.txt", "not captured\n");
    await f.put("ignored-tracked.txt", "tracked change\n");
    const before = await inventory(f.repo);
    const out = f.output();
    const dirty = await f.snap({ uncommitted: true }, out);
    const stagedOut = f.output();
    const staged = await f.snap({ uncommitted: true, staged: true }, stagedOut);
    expect(dirty.base).toBe(head);
    expect(dirty.head).toBe("working-tree");
    expect(dirty.scope).toMatchObject({ includesUntracked: true, staged: false, headRevision: null, baseRevision: head });
    await assertStored(out, file(dirty, "both.txt").head, "working\r\n");
    await assertStored(stagedOut, file(staged, "both.txt").head, "index\n");
    await assertStored(out, file(dirty, "staged-add.txt").head, "working addition\n");
    await assertStored(stagedOut, file(staged, "staged-add.txt").head, "index addition\n");
    expect(file(dirty, "deleted.txt").status).toBe("D");
    expect(file(staged, "deleted.txt").status).toBe("");
    expect(file(dirty, "staged-deleted.txt").status).toBe("D");
    expect(file(staged, "staged-deleted.txt").status).toBe("D");
    expect(file(dirty, "untracked.txt").status).toBe("A");
    expect(file(dirty, "ignored-tracked.txt").status).toBe("M");
    expect(dirty.files.some(entry => entry.path === "ignored-secret.txt")).toBe(false);
    expect(staged.files.some(entry => entry.path === "untracked.txt")).toBe(false);
    expect(staged.scope).toMatchObject({ source: "index", staged: true, includesUntracked: false });
    expect(await inventory(f.repo)).toEqual(before);
  });

  test("-text working OIDs retain raw BOM/CRLF/Unicode bytes", async () => {
    const f = await fixture();
    await f.put(".gitattributes", "*.txt -text\n");
    await f.put("bytes.txt", "base\n");
    await f.commit("base");
    const bytes = Buffer.from("\ufeffhéllo 🌊\r\nraw\r\n", "utf8");
    await f.put("bytes.txt", bytes);
    const out = f.output();
    const manifest = await f.snap({ uncommitted: true }, out);
    const info = file(manifest, "bytes.txt").head!;
    expect(info.oid).toBe(blobOid(bytes));
    expect(info.size).toBe(bytes.length);
    expect(info.oid).toBe((await run("git", ["hash-object", "--no-filters", "--stdin"], f.repo, bytes)).toString().trim());
    await assertStored(out, info, bytes);
  });

  test.each(["true", "input"])("autocrlf=%s ignores checkout-only CRLF, captures real changes and respects -text without filters", async (setting) => {
    const f = await fixture();
    await f.git("config", "core.autocrlf", setting);
    await f.put(".gitattributes", "*.txt filter=tripwire\nraw.txt -text\n");
    await f.put("clean.txt", "clean\n");
    await f.put("changed.txt", "before\n");
    await f.put("raw.txt", "raw\r\n");
    await f.commit("base");
    await fs.unlink(path.join(f.repo, "clean.txt"));
    await f.git("checkout", "--", "clean.txt");
    expect(await fs.readFile(path.join(f.repo, "clean.txt"), "utf8")).toBe(setting === "true" ? "clean\r\n" : "clean\n");
    if (setting === "input") await f.put("clean.txt", "clean\r\n");
    await f.put("changed.txt", "actually changed\r\n");
    await f.put("raw.txt", "raw changed\r\n");
    await f.put("untracked.txt", "new\r\n");
    await f.git("config", "filter.tripwire.clean", "echo executed > filter-executed; exit 1");
    await f.git("config", "filter.tripwire.process", "echo executed > filter-executed; exit 1");
    await f.git("config", "filter.tripwire.required", "true");
    const before = await inventory(f.repo);
    const out = f.output();
    const manifest = await f.snap({ uncommitted: true }, out);
    expect(file(manifest, "clean.txt").status).toBe("");
    expect(file(manifest, "clean.txt").head?.oid).toBe(file(manifest, "clean.txt").base?.oid);
    expect(file(manifest, "changed.txt").status).toBe("M");
    expect(file(manifest, "changed.txt").head?.oid).toBe(blobOid(Buffer.from("actually changed\n")));
    expect(file(manifest, "changed.txt").head?.size).toBe(Buffer.byteLength("actually changed\n"));
    await assertStored(out, file(manifest, "changed.txt").head, "actually changed\n");
    await assertStored(out, file(manifest, "untracked.txt").head, "new\n");
    await assertStored(out, file(manifest, "raw.txt").base, "raw\r\n");
    await assertStored(out, file(manifest, "raw.txt").head, "raw changed\r\n");
    expect(file(manifest, "raw.txt").head?.oid).toBe(blobOid(Buffer.from("raw changed\r\n")));
    expect(manifest.scope?.eol).toMatchObject({ coreAutocrlf: setting, normalizedPaths: ["changed.txt", "clean.txt", "untracked.txt"], unknownIndexPaths: [] });
    const commitOut = f.output();
    const committed = await f.snap({ commit: "HEAD" }, commitOut);
    await assertStored(commitOut, file(committed, "raw.txt").head, "raw\r\n");
    expect(await inventory(f.repo)).toEqual(before);
    expect(existsSync(path.join(f.repo, "filter-executed"))).toBe(false);
  });

  test("working text/eol attributes normalize CRLF while preserving all other bytes", async () => {
    const f = await fixture();
    await f.put(".gitattributes", "*.txt -text\n");
    const original = Buffer.from("\ufeffhéllo 🌊\r\nraw\r\n", "utf8");
    for (const name of ["explicit.txt", "eol-only.txt", "keep.txt"]) await f.put(name, original);
    await f.commit("raw root");
    // Working attributes take precedence over their still-unchanged index copy.
    await f.put(".gitattributes", "explicit.txt text eol=crlf\neol-only.txt eol=lf\nkeep.txt -text eol=lf\n");
    const before = await inventory(f.repo);
    const out = f.output();
    const manifest = await f.snap({ uncommitted: true }, out);
    const normalized = Buffer.from("\ufeffhéllo 🌊\nraw\n", "utf8");
    for (const name of ["explicit.txt", "eol-only.txt"]) {
      expect(file(manifest, name).status).toBe("M");
      expect(file(manifest, name).head?.oid).toBe(blobOid(normalized));
      expect(file(manifest, name).head?.size).toBe(normalized.length);
      await assertStored(out, file(manifest, name).base, original);
      await assertStored(out, file(manifest, name).head, normalized);
    }
    expect(file(manifest, "keep.txt").status).toBe("");
    await assertStored(out, file(manifest, "keep.txt").head, original);
    const stagedOut = f.output();
    const staged = await f.snap({ uncommitted: true, staged: true }, stagedOut);
    expect(staged.files.every(entry => entry.status === "")).toBe(true);
    await assertStored(stagedOut, file(staged, "explicit.txt").head, original);
    expect(await inventory(f.repo)).toEqual(before);
  });

  test("text=auto preserves legacy index CRLF and binary-like working text", async () => {
    const f = await fixture();
    await f.put("legacy.txt", "legacy\r\n");
    await f.commit("legacy CRLF");
    await f.put(".gitattributes", "*.txt text=auto\n");
    await f.git("config", "core.autocrlf", "true");
    await f.put("lone-cr.txt", "one\rtwo\r\n");
    await f.put("control.txt", "control\x01\r\n");
    await f.put("new.txt", "new\r\n");
    const out = f.output();
    const manifest = await f.snap({ uncommitted: true }, out);
    expect(file(manifest, "legacy.txt").status).toBe("");
    await assertStored(out, file(manifest, "legacy.txt").head, "legacy\r\n");
    await assertStored(out, file(manifest, "lone-cr.txt").head, "one\rtwo\r\n");
    await assertStored(out, file(manifest, "control.txt").head, "control\x01\r\n");
    await assertStored(out, file(manifest, "new.txt").head, "new\n");
  });

  test("unmerged index is unavailable, while working conflict text is still captured", async () => {
    const f = await fixture();
    await f.put("conflict.txt", "base");
    await f.commit("base");
    await f.git("checkout", "-b", "side");
    await f.put("conflict.txt", "side");
    await f.commit("side");
    await f.git("checkout", "main");
    await f.put("conflict.txt", "main");
    await f.commit("main");
    await expect(f.git("merge", "side")).rejects.toThrow();
    const staged = await f.snap({ uncommitted: true, staged: true });
    expect(file(staged, "conflict.txt").head).toMatchObject({ kind: "unavailable", oid: "" });
    expect(file(staged, "conflict.txt").status).toBe("M");
    const dirty = await f.snap({ uncommitted: true });
    expect(file(dirty, "conflict.txt").head?.kind).toBe("text");
  });

  test("unusual UTF-8 filenames survive NUL-delimited tree/index parsing", async () => {
    const f = await fixture();
    const names = ["space name.txt", "日本語.txt", "--looks-like-an-option.txt", ...(process.platform === "win32" ? [] : ["tab\tand\nnewline.txt"])];
    for (const name of names) await f.put(name, name);
    await f.commit("names");
    const committed = await f.snap({ commit: "HEAD" });
    const working = await f.snap({ uncommitted: true });
    expect(committed.files.map(entry => entry.path)).toEqual([...names].sort());
    expect(working.files.map(entry => entry.path)).toEqual([...names].sort());
    expect(working.files.every(entry => entry.status === "")).toBe(true);
  });
});

describe("blob safety and metadata", () => {
  test("NUL and invalid UTF-8 are binary; >2 MiB is large; exactly 2 MiB is text", async () => {
    const f = await fixture();
    const content = new Map([
      ["contains-nul.bin", Buffer.from([65, 0, 66])],
      ["invalid.bin", Buffer.from([0xc3, 0x28])],
      ["large.txt", Buffer.alloc(2 * 1024 * 1024 + 1, 97)],
      ["limit.txt", Buffer.alloc(2 * 1024 * 1024, 98)],
      ["empty.txt", Buffer.alloc(0)],
    ]);
    for (const [name, bytes] of content) await f.put(name, bytes);
    await f.commit("various bytes");
    for (const opts of [{ commit: "HEAD" }, { uncommitted: true }]) {
      const out = f.output();
      const manifest = await f.snap(opts, out);
      for (const [name, bytes] of content) {
        const info = file(manifest, name).head!;
        const kind = name.endsWith(".bin") ? "binary" : name === "large.txt" ? "large" : "text";
        expect(info).toMatchObject({ oid: blobOid(bytes), size: bytes.length, kind });
        if (kind !== "text") expect(existsSync(path.join(out, "blobs", `${info.oid}.txt`))).toBe(false);
        else await assertStored(out, info, bytes);
      }
    }
  });

  test("SHA-256 repositories retain real Git blob IDs and empty-tree ID", async () => {
    const f = await fixture("sha256");
    await f.put("a.txt", "sha256\n");
    await f.commit("root");
    const manifest = await f.snap({ commit: "HEAD" });
    expect(manifest.scope?.objectFormat).toBe("sha256");
    expect(manifest.base).toBe(await f.git("hash-object", "-t", "tree", "--stdin"));
    expect(file(manifest, "a.txt").head?.oid).toBe(blobOid(Buffer.from("sha256\n"), "sha256"));
    await f.put("a.txt", "dirty\r\n");
    const dirty = await f.snap({ uncommitted: true });
    expect(file(dirty, "a.txt").head?.oid).toBe(blobOid(Buffer.from("dirty\r\n"), "sha256"));
  });

  test("gitlinks are unavailable and never traversed", async () => {
    const f = await fixture();
    await f.put("normal", "base");
    const oid = await f.commit("base");
    await f.git("update-index", "--add", "--cacheinfo", `160000,${oid},vendor`);
    await f.git("commit", "-m", "gitlink");
    await fs.mkdir(path.join(f.repo, "vendor"));
    await f.put("vendor/secret.txt", "must not be read");
    const before = await inventory(f.repo);
    for (const opts of [{ commit: "HEAD" }, { uncommitted: true }, { uncommitted: true, staged: true }]) {
      const out = f.output();
      const manifest = await f.snap(opts, out);
      expect(file(manifest, "vendor").head).toMatchObject({ oid, mode: "160000", kind: "unavailable" });
      expect(manifest.files.some(entry => entry.path === "vendor/secret.txt")).toBe(false);
      expect(existsSync(path.join(out, "blobs", `${oid}.txt`))).toBe(false);
    }
    expect(await inventory(f.repo)).toEqual(before);
  });

  test("committed symlink stores target bytes, even if target is absent", async () => {
    const f = await fixture();
    const bytes = Buffer.from("../absent-target");
    const oid = (await run("git", ["hash-object", "-w", "--stdin"], f.repo, bytes)).toString().trim();
    await f.git("update-index", "--add", "--cacheinfo", `120000,${oid},link`);
    await f.git("commit", "-m", "symlink root");
    const out = f.output();
    const manifest = await f.snap({ commit: "HEAD" }, out);
    expect(file(manifest, "link").head?.mode).toBe("120000");
    await assertStored(out, file(manifest, "link").head, bytes);
  });

  test("working tracked descendants behind a directory symlink/junction are not followed", async () => {
    const f = await fixture();
    await f.put("nested/secret.txt", "safe base");
    await f.commit("base");
    const outside = path.join(f.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "private outside content");
    await fs.unlink(path.join(f.repo, "nested", "secret.txt"));
    await fs.rmdir(path.join(f.repo, "nested"));
    await fs.symlink(outside, path.join(f.repo, "nested"), process.platform === "win32" ? "junction" : "dir");
    const out = f.output();
    const manifest = await f.snap({ uncommitted: true }, out);
    expect(file(manifest, "nested/secret.txt").head).toMatchObject({ kind: "unavailable", oid: "" });
    const secretOid = blobOid(Buffer.from("private outside content"));
    expect(existsSync(path.join(out, "blobs", `${secretOid}.txt`))).toBe(false);
  });

  test("untracked directory links capture their target without reading its contents", async () => {
    const f = await fixture();
    await f.put("base", "base");
    await f.commit("base");
    const outside = path.join(f.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "not followed");
    await fs.symlink(outside, path.join(f.repo, "untracked-link"), process.platform === "win32" ? "junction" : "dir");
    const out = f.output();
    const manifest = await f.snap({ uncommitted: true }, out);
    expect(manifest.files.some(entry => entry.path.includes("secret.txt"))).toBe(false);
    const info = file(manifest, "untracked-link").head!;
    expect(info.mode).toBe("120000");
    const target = await fs.readlink(path.join(f.repo, "untracked-link"), { encoding: "buffer" });
    expect(info.oid).toBe(blobOid(target));
    await assertStored(out, info, target);
  });

  test("missing local blob is metadata-only and retains its known OID", async () => {
    const f = await fixture();
    await f.put("missing.txt", "missing object");
    await f.commit("root");
    const oid = await f.git("rev-parse", "HEAD:missing.txt");
    await fs.unlink(path.join(f.repo, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
    const manifest = await f.snap({ commit: "HEAD" });
    expect(file(manifest, "missing.txt").head).toMatchObject({ oid, kind: "unavailable" });
    expect(manifest.scope?.unavailable).toEqual(expect.arrayContaining([expect.objectContaining({ path: "missing.txt", reason: expect.stringContaining("unavailable locally") })]));
  });
});

describe("output protection and CLI", () => {
  test("rejects nonempty outputs, source descendants, Git storage and symlink aliases", async () => {
    const f = await fixture();
    await f.put("a", "a");
    await f.commit("root");
    const out = f.output();
    await fs.mkdir(out);
    await fs.writeFile(path.join(out, "keep.txt"), "keep");
    await expect(f.snap({ commit: "HEAD" }, out)).rejects.toThrow("nonempty");
    expect(await fs.readFile(path.join(out, "keep.txt"), "utf8")).toBe("keep");
    await expect(f.snap({ commit: "HEAD" }, path.join(f.repo, "capture"))).rejects.toThrow("outside");
    await expect(f.snap({ commit: "HEAD" }, path.join(f.repo, ".git", "capture"))).rejects.toThrow("outside");
    const alias = path.join(f.root, "alias");
    await fs.symlink(f.repo, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(f.snap({ commit: "HEAD" }, path.join(alias, "capture"))).rejects.toThrow("outside");
    expect(existsSync(path.join(f.repo, "capture"))).toBe(false);
    const empty = f.output();
    await fs.mkdir(empty);
    await f.snap({ commit: "HEAD" }, empty);
    await expect(f.snap({ commit: "HEAD" }, empty)).rejects.toThrow("nonempty");
  });

  test("works from a repository subdirectory and does not mutate source files or index", async () => {
    const f = await fixture();
    await f.put("nested/a.txt", "base");
    await f.commit("root");
    await f.put("nested/a.txt", "dirty");
    const before = await inventory(f.repo);
    const manifest = await capture({ repo: path.join(f.repo, "nested"), out: f.output(), uncommitted: true });
    expect(file(manifest, "nested/a.txt").head?.oid).toBe(blobOid(Buffer.from("dirty")));
    expect(await inventory(f.repo)).toEqual(before);
  });

  test("invalid scope combinations fail before writing output", () => {
    const prefix = ["--repo", "repo", "--out", "out"];
    expect(() => parseArgs(prefix)).toThrow("exactly one");
    expect(() => parseArgs([...prefix, "--commit", "HEAD", "--uncommitted"])).toThrow("exactly one");
    expect(() => parseArgs([...prefix, "--branch", "main"])).toThrow("requires --base");
    expect(() => parseArgs([...prefix, "--commit", "HEAD", "--staged"])).toThrow("requires --uncommitted");
    expect(() => parseArgs([...prefix, "--base", "main", "--commit", "HEAD"])).toThrow("only valid");
    expect(() => parseArgs([...prefix, "--commit", "HEAD", "--out", "again"])).toThrow("Repeated");
    expect(() => parseArgs([...prefix, "--pr", "bad-ref"])).toThrow("PR number");
    expect(() => parseArgs([...prefix, "--commit", "--staged"])).toThrow("Missing value");
    expect(() => parseArgs([...prefix, "--unknown"])).toThrow("Unknown option");
    expect(parseArgs([...prefix, "--uncommitted", "--staged"])).toMatchObject({ uncommitted: true, staged: true });
  });

  test("CLI runs under Bun, prints help, writes output, and exits nonzero on errors", async () => {
    const f = await fixture();
    await f.put("hello", "hello");
    await f.commit("root");
    const script = path.resolve(import.meta.dir, "../scripts/capture.ts");
    const help = await run(process.execPath, [script, "--help"], f.repo);
    expect(help.toString()).toContain("--range A...B");
    const out = f.output();
    const stdout = await run(process.execPath, [script, "--repo", f.repo, "--out", out, "--commit", "HEAD"], f.repo);
    expect(stdout.toString()).toContain("Captured 1 files");
    expect(existsSync(path.join(out, "manifest.json"))).toBe(true);
    await expect(run(process.execPath, [script, "--repo", f.repo, "--out", out, "--commit", "HEAD"], f.repo)).rejects.toThrow("nonempty");
  });
});
