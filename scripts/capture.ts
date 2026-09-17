#!/usr/bin/env bun
/** Read-only Git snapshots. Run `bun scripts/capture.ts --help` for CLI usage. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { BlobInfo, FileInfo, Manifest } from "../viewer/src/types";

export interface CaptureOptions {
  repo: string;
  out: string;
  pr?: string | number;
  branch?: string;
  base?: string;
  commit?: string;
  range?: string;
  uncommitted?: boolean;
  staged?: boolean;
}

/** Only gh is injectable, so tests can exercise PR resolution without network/auth. */
export interface CaptureDependencies {
  gh?: (args: string[], cwd: string) => Promise<string>;
}

type Entry = { oid: string; mode: string; conflict?: boolean };
type Tree = Map<string, Entry>;
type HashAlgorithm = "sha1" | "sha256";
class OutputError extends Error {}
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HELP = `Usage: bun scripts/capture.ts --repo PATH --out PATH SCOPE

Choose exactly one scope:
  --pr URL|NUMBER          Resolve authenticated PR base/head with gh; use merge-base
  --branch REF --base REF  Compare merge-base(BASE, REF) to REF
  --commit REF             Compare first parent to REF (root: empty tree)
  --range A..B             Compare the exact A and B trees
  --range A...B            Compare merge-base(A, B) to B
  --uncommitted            HEAD vs tracked working files + nonignored untracked files
  --uncommitted --staged   HEAD vs index only

OUT must be outside the source worktree/Git directory and empty or nonexistent.
No checkout, fetch, index writes, custom filters, or global configuration changes.
PR objects must already exist locally; missing objects fail with fetch guidance.
Output: manifest.json and blobs/<Git object ID>.txt (UTF-8, <= 2 MiB, no NUL).
Full trees include unchanged context. Symlink targets are captured without following
them; submodules and inaccessible content are metadata-only. Snapshots are frozen
copies, not an atomic snapshot of concurrently edited working files.
Working UTF-8 text <= 2 MiB uses Git text/eol/crlf attributes and core.autocrlf
to normalize managed CRLF to LF before hashing, sizing, storing and comparison.
Automatic conversion preserves binary-like text and existing index CRLF. Unknown
or oversized index content conservatively stays raw in automatic mode. -text,
unmanaged files, binary/large files and symlink targets retain raw bytes. No ident
or working-tree-encoding conversion is performed. Commit/index blobs stay exact.
`;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) delete env[key];
  }
  return { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", GH_PROMPT_DISABLED: "1" };
}

async function command(exe: string, args: string[], cwd: string, input?: Buffer | string, okCodes = [0]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(exe, args, { cwd, env: cleanEnv(), encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && !okCodes.includes(Number(error.code))) reject(new Error(`${exe} ${args.join(" ")} failed: ${stderr.toString().trim() || error.message}`));
      else resolve(stdout);
    });
    // A failed child can close its input before all batch requests are written.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

function utf8(bytes: Uint8Array): string {
  try { return decoder.decode(bytes); }
  catch { throw new Error("Git returned a non-UTF-8 path; the manifest cannot represent it losslessly."); }
}

function oidFor(bytes: Buffer, algorithm: HashAlgorithm, type = "blob"): string {
  return createHash(algorithm).update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
}

function isText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try { decoder.decode(bytes); return true; } catch { return false; }
}

// Git's automatic EOL heuristic differs from UTF-8 eligibility: bare CR and
// excessive control bytes must remain raw. See git/convert.c gather_stats.
function eolStats(bytes: Buffer): { crlf: boolean; binary: boolean } {
  let crlf = false;
  let binary = false;
  let printable = 0;
  let controls = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 13) {
      if (bytes[i + 1] === 10) { crlf = true; i++; }
      else binary = true;
    } else if (c !== 10) {
      if (c === 0) binary = true;
      if (c === 127 || (c < 32 && ![8, 9, 27, 12].includes(c))) controls++;
      else printable++;
    }
  }
  if (bytes[bytes.length - 1] === 26) controls--;
  return { crlf, binary: binary || Math.floor(printable / 128) < controls };
}

type EolAction = "raw" | "auto" | "text";
function eolAction(attrs: Record<string, string>, autocrlf: string): EolAction {
  const attributeAction = (value: string | undefined): EolAction | undefined =>
    value === "unset" ? "raw" : value === "set" || value === "input" ? "text" : value === "auto" ? "auto" : undefined;
  const action = attributeAction(attrs.text) ?? attributeAction(attrs.crlf);
  if (action === "raw") return "raw";
  if (attrs.eol === "lf" || attrs.eol === "crlf") return action === "auto" ? "auto" : "text";
  return action ?? (/^(true|yes|on|1|input)$/i.test(autocrlf) ? "auto" : "raw");
}

function within(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function canonicalFuturePath(target: string): Promise<string> {
  try { return await fs.realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(await canonicalFuturePath(parent), path.basename(target));
  }
}

function validateOptions(opts: CaptureOptions): void {
  if (!opts.repo || !opts.out) throw new Error("--repo and --out are required.");
  const scopes = [opts.pr !== undefined, opts.branch !== undefined, opts.commit !== undefined, opts.range !== undefined, !!opts.uncommitted];
  if (scopes.filter(Boolean).length !== 1) throw new Error("Choose exactly one scope: --pr, --branch, --commit, --range, or --uncommitted.");
  if (opts.branch !== undefined && !opts.base) throw new Error("--branch requires --base.");
  if (opts.base !== undefined && opts.branch === undefined) throw new Error("--base is only valid with --branch.");
  if (opts.staged && !opts.uncommitted) throw new Error("--staged requires --uncommitted.");
  if (opts.pr !== undefined && !/^(?:[1-9]\d*|https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$)/.test(String(opts.pr))) throw new Error("--pr must be a PR number or an HTTPS pull request URL.");
}

/** Returns exactly the manifest written to out. Never writes to the source repo. */
export async function capture(opts: CaptureOptions, dependencies: CaptureDependencies = {}): Promise<Manifest> {
  validateOptions(opts);
  const initial = await fs.realpath(path.resolve(opts.repo));
  const git = (args: string[], input?: Buffer | string) => command("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], initial, input);
  const gitText = async (args: string[]) => (await git(args)).toString("utf8").trim();
  const bare = (await gitText(["rev-parse", "--is-bare-repository"])) === "true";
  if (bare && opts.uncommitted) throw new Error("--uncommitted requires a working tree.");
  const repo = await fs.realpath(bare ? initial : await gitText(["rev-parse", "--show-toplevel"]));
  // Run all subsequent commands at the root, including when --repo is a subdirectory.
  const rootGit = (args: string[], input?: Buffer | string) => command("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], repo, input);
  const rootText = async (args: string[]) => (await rootGit(args)).toString("utf8").trim();
  const gitDir = await fs.realpath(await rootText(["rev-parse", "--absolute-git-dir"]));
  const commonDir = await fs.realpath(path.resolve(repo, await rootText(["rev-parse", "--git-common-dir"])));
  const outRequested = path.resolve(opts.out);
  const out = await canonicalFuturePath(outRequested);
  if ([repo, gitDir, commonDir].some(root => within(root, out))) throw new Error("Output must be outside the source repository/worktree and Git directory.");
  // Reject a final symlink even if it points at an otherwise valid empty directory.
  try { if ((await fs.lstat(outRequested)).isSymbolicLink()) throw new Error("Output directory must not be a symlink."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { if ((await fs.readdir(out)).length) throw new Error("Output directory is nonempty; choose a new empty output directory."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const algorithm = await rootText(["rev-parse", "--show-object-format"]);
  if (algorithm !== "sha1" && algorithm !== "sha256") throw new Error(`Unsupported Git object format: ${algorithm}`);
  const validOid = (value: unknown): value is string => typeof value === "string" && new RegExp(`^[0-9a-f]{${algorithm === "sha1" ? 40 : 64}}$`).test(value);
  const resolveCommit = async (ref: string): Promise<string> => {
    if (!ref || ref.startsWith("-") || ref.includes("\0")) throw new Error(`Invalid revision: ${ref}`);
    try { return await rootText(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]); }
    catch { throw new Error(`Commit ${JSON.stringify(ref)} is not available locally. Fetch the required ref/history explicitly in your repository, then retry.`); }
  };
  const mergeBase = async (a: string, b: string): Promise<string> => {
    let bases: string[];
    try { bases = (await rootText(["merge-base", "--all", a, b])).split(/\r?\n/).filter(Boolean); }
    catch { throw new Error("No local merge-base is available. Fetch the required history explicitly (deepen/unshallow a shallow clone), then retry."); }
    if (bases.length !== 1) throw new Error("Multiple merge bases exist; select one explicitly with --range A..B.");
    return bases[0];
  };

  const scope: Record<string, unknown> = { objectFormat: algorithm, textLimitBytes: MAX_TEXT_BYTES };
  let base: string;
  let head: string;
  let emptyBase = false;
  let title: string | undefined;
  let sourceUrl: string | undefined;
  if (opts.pr !== undefined) {
    const args = ["pr", "view", String(opts.pr), "--json", "number,url,title,baseRefName,baseRefOid,headRefName,headRefOid"];
    let pr: { number: number; url: string; title: string; baseRefName: string; baseRefOid: string; headRefName: string; headRefOid: string };
    try {
      pr = JSON.parse(await (dependencies.gh ? dependencies.gh(args, repo) : command("gh", args, repo).then(result => result.toString("utf8"))));
    } catch (error) { throw new Error(`Authenticated PR resolution through gh failed. Check gh auth status and the repository remote. ${String(error)}`); }
    if (!validOid(pr.baseRefOid) || !validOid(pr.headRefOid) || !/^https:\/\//.test(pr.url)) throw new Error("gh returned incomplete or invalid PR revisions.");
    try {
      await resolveCommit(pr.baseRefOid);
      head = await resolveCommit(pr.headRefOid);
    } catch (error) {
      throw new Error(`PR #${pr.number} objects are missing locally. This capture never fetches automatically. In the repository, fetch the authenticated PR refs explicitly, for example: git fetch <verified-base-remote> ${JSON.stringify(pr.baseRefName)} refs/pull/${pr.number}/head. For forks, fetch the head ref from the verified fork remote if needed. Then retry; the fetched OIDs must match gh. ${String(error)}`);
    }
    base = await mergeBase(pr.baseRefOid, head);
    title = pr.title;
    sourceUrl = pr.url;
    Object.assign(scope, { kind: "pr", requested: String(opts.pr), number: pr.number, baseRef: pr.baseRefName, headRef: pr.headRefName, baseRevision: pr.baseRefOid, headRevision: head, mergeBase: base, comparison: "merge-base-to-head" });
  } else if (opts.branch !== undefined) {
    const baseRevision = await resolveCommit(opts.base!);
    head = await resolveCommit(opts.branch);
    base = await mergeBase(baseRevision, head);
    Object.assign(scope, { kind: "branch", baseRef: opts.base, headRef: opts.branch, baseRevision, headRevision: head, mergeBase: base, comparison: "merge-base-to-head" });
  } else if (opts.commit !== undefined) {
    head = await resolveCommit(opts.commit);
    // Read real commit headers: rev-list suppresses parents at a shallow boundary.
    const headers = (await rootText(["cat-file", "commit", head])).split("\n\n", 1)[0];
    const parents = [...headers.matchAll(/^parent ([0-9a-f]+)$/gm)].map(match => match[1]);
    emptyBase = parents.length === 0;
    base = emptyBase ? oidFor(Buffer.alloc(0), algorithm, "tree") : await resolveCommit(parents[0]);
    Object.assign(scope, { kind: "commit", requested: opts.commit, baseRevision: emptyBase ? null : base, headRevision: head, parents, emptyBase, comparison: "first-parent-to-commit" });
  } else if (opts.range !== undefined) {
    const match = /^(.+?)(\.{3}|\.{2})([^.].*)$/.exec(opts.range);
    if (!match || match[1].includes("..") || match[3].includes("..")) throw new Error("--range requires explicit A..B or A...B endpoints.");
    const baseRevision = await resolveCommit(match[1]);
    head = await resolveCommit(match[3]);
    base = match[2] === "..." ? await mergeBase(baseRevision, head) : baseRevision;
    Object.assign(scope, { kind: "range", requested: opts.range, baseRef: match[1], headRef: match[3], baseRevision, headRevision: head, comparison: match[2] === "..." ? "merge-base-to-head" : "tree-to-tree", ...(match[2] === "..." ? { mergeBase: base } : {}) });
  } else {
    base = await resolveCommit("HEAD");
    head = opts.staged ? "index" : "working-tree";
    Object.assign(scope, { kind: "uncommitted", baseRef: "HEAD", baseRevision: base, headRevision: null, source: head, staged: !!opts.staged, includesUntracked: !opts.staged, includesIgnoredUntracked: false, comparison: opts.staged ? "HEAD-to-index" : "HEAD-to-working-tree", content: opts.staged ? "exact index blobs" : "working bytes with Git-managed CRLF normalized to LF for UTF-8 text <= 2 MiB; hashes, sizes and status describe captured bytes", symlinks: "link-target bytes; never followed", atomic: false });
  }

  const readTree = async (revision: string): Promise<Tree> => {
    const result: Tree = new Map();
    for (const row of utf8(await rootGit(["ls-tree", "-r", "-z", "--full-tree", revision])).split("\0")) {
      if (!row) continue;
      const match = /^(\d{6}) (?:blob|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Unexpected ls-tree record.");
      result.set(match[3], { mode: match[1], oid: match[2] });
    }
    return result;
  };
  const baseTree = emptyBase ? new Map<string, Entry>() : await readTree(base);
  let headTree: Tree;
  if (opts.uncommitted) {
    headTree = new Map();
    for (const row of utf8(await rootGit(["ls-files", "--stage", "-z", "--full-name"])).split("\0")) {
      if (!row) continue;
      const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Unexpected index record.");
      const previous = headTree.get(match[4]);
      headTree.set(match[4], { mode: match[1], oid: match[2], conflict: match[3] !== "0" || previous?.conflict });
    }
    if (!opts.staged) {
      // Git for Windows may traverse junctions in ls-files --others. Discover
      // candidates ourselves without following links, then let Git apply ignores.
      let directories = [""];
      while (directories.length) {
        const candidates: Array<{ name: string; directory: boolean }> = [];
        for (const directory of directories) {
          const absolute = path.join(repo, directory);
          const stat = await fs.lstat(absolute);
          if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
          for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
            if (entry.name === ".git") continue;
            const name = directory ? `${directory}/${entry.name}` : entry.name;
            if (headTree.has(name)) continue;
            candidates.push({ name, directory: entry.isDirectory() && !entry.isSymbolicLink() });
          }
        }
        directories = [];
        if (!candidates.length) break;
        // --no-index makes ignore decisions independent of tracked descendants;
        // their content is already represented by headTree's index entries.
        const input = candidates.map(entry => "./" + entry.name + (entry.directory ? "/" : "")).join("\0") + "\0";
        const records = utf8(await command("git", ["--no-literal-pathspecs", "check-ignore", "--no-index", "--stdin", "-z", "--verbose", "--non-matching"], repo, input, [0, 1])).split("\0");
        if (records.length !== candidates.length * 4 + 1) throw new Error("Unexpected check-ignore response.");
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          const pattern = records[i * 4 + 2];
          if (pattern && !pattern.startsWith("!")) continue;
          if (candidate.directory) {
            let nestedRepo = false;
            try { await fs.lstat(path.join(repo, candidate.name, ".git")); nestedRepo = true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            if (!nestedRepo) { directories.push(candidate.name); continue; }
          }
          headTree.set(candidate.name, { mode: candidate.directory ? "040000" : "100644", oid: "" });
        }
      }
    }
  } else headTree = await readTree(head);

  const eolActions = new Map<string, EolAction>();
  const normalizedPaths: string[] = [];
  const unknownIndexPaths: string[] = [];
  if (opts.uncommitted && !opts.staged) {
    let autocrlf = "false";
    try { autocrlf = await rootText(["config", "--get", "core.autocrlf"]); } catch { /* default false */ }
    const names: string[] = [];
    for (const [name, entry] of headTree) {
      if (entry.mode !== "100644" && entry.mode !== "100755") continue;
      const parts = name.split("/");
      if (parts.some(part => !part || part === "." || part === ".." || (process.platform === "win32" && /[\\:]/.test(part)))) continue;
      // Do not let attribute lookup read .gitattributes behind a symlink ancestor.
      let current = repo;
      try {
        for (let i = 0; i < parts.length; i++) {
          current = path.join(current, parts[i]);
          const stat = await fs.lstat(current);
          if (stat.isSymbolicLink()) break;
          if (i === parts.length - 1) {
            if (stat.isFile() && stat.size <= MAX_TEXT_BYTES) names.push(name);
          } else if (!stat.isDirectory()) break;
        }
      } catch { /* Working-content capture below records missing/unavailable files. */ }
    }
    if (names.length) {
      const records = utf8(await rootGit(["check-attr", "-z", "--stdin", "text", "eol", "crlf"], names.join("\0") + "\0")).split("\0");
      if (records.length !== names.length * 9 + 1) throw new Error("Unexpected check-attr response.");
      for (let i = 0; i < names.length; i++) {
        const attrs: Record<string, string> = {};
        for (let j = 0; j < 9; j += 3) {
          const offset = i * 9 + j;
          if (records[offset] !== names[i]) throw new Error("Unexpected path in check-attr response.");
          attrs[records[offset + 1]] = records[offset + 2];
        }
        eolActions.set(names[i], eolAction(attrs, autocrlf));
      }
    }
    scope.eol = {
      coreAutocrlf: autocrlf,
      attributes: "effective working-tree text/eol/crlf attributes via git check-attr (Git index fallback)",
      policy: "CRLF-to-LF for eligible UTF-8 regular files <= 2 MiB; automatic mode respects Git binary heuristic and existing index CRLF",
      raw: "-text, unmanaged, binary/large and symlink content; automatic mode with unavailable/oversized index content",
      otherConversions: "none: custom filters, ident and working-tree-encoding are not applied",
      normalizedPaths, unknownIndexPaths,
    };
  }

  // Reserve only after revision/tree validation. A failed capture leaves a nonempty
  // incomplete directory intentionally; retries must use a fresh output path.
  await fs.mkdir(out, { recursive: true });
  if ((await fs.readdir(out)).length) throw new Error("Output directory became nonempty; refusing to overwrite it.");
  const lock = await fs.open(path.join(out, ".capture-in-progress"), "wx");
  await lock.close();
  await fs.mkdir(path.join(out, "blobs"));
  const written = new Set<string>();
  const writeBlob = async (oid: string, bytes: Buffer) => {
    if (written.has(oid)) return;
    try { await fs.writeFile(path.join(out, "blobs", `${oid}.txt`), bytes, { flag: "wx" }); }
    catch (error) { throw new OutputError(`Unable to write output blob ${oid}: ${String(error)}`); }
    written.add(oid);
  };
  const unavailable: Array<{ path: string; version: "base" | "head"; reason: string }> = [];
  const missing = (name: string, version: "base" | "head", entry: Entry, reason: string): BlobInfo => {
    unavailable.push({ path: name, version, reason });
    return { oid: entry.oid, mode: entry.mode, size: 0, kind: "unavailable" };
  };

  // Batch metadata first, then bounded batches of eligible blob bodies. Large blobs
  // never enter memory; raw cat-file bytes bypass attributes and conversion filters.
  const objects = new Map<string, Omit<BlobInfo, "mode">>();
  const snapshotIds = new Set([...baseTree.values(), ...(!opts.uncommitted || opts.staged ? headTree.values() : [])].map(e => e.oid));
  const indexCrlf = new Map<string, boolean>();
  const ids = [...new Set([...baseTree.values(), ...headTree.values()].filter(e => e.oid && e.mode !== "160000" && !e.conflict).map(e => e.oid))];
  const eligible: Array<{ oid: string; size: number }> = [];
  if (ids.length) {
    const rows = utf8(await rootGit(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], `${ids.join("\n")}\n`)).trim().split("\n");
    if (rows.length !== ids.length) throw new Error("Incomplete cat-file metadata batch.");
    rows.forEach((row, index) => {
      const [oid, type, sizeText] = row.trim().split(" ");
      const size = Number(sizeText);
      if (oid !== ids[index]) throw new Error("Unexpected object ID in cat-file response.");
      if (type !== "blob" || !Number.isSafeInteger(size) || size < 0) objects.set(oid, { oid, size: 0, kind: "unavailable" });
      else if (size > MAX_TEXT_BYTES) objects.set(oid, { oid, size, kind: "large" });
      else eligible.push({ oid, size });
    });
  }
  for (let start = 0; start < eligible.length;) {
    let end = start;
    let bytes = 0;
    while (end < eligible.length && (end === start || bytes + eligible[end].size <= 16 * 1024 * 1024) && end - start < 4096) bytes += eligible[end++].size;
    const batch = eligible.slice(start, end);
    const buffer = await rootGit(["cat-file", "--batch"], `${batch.map(entry => entry.oid).join("\n")}\n`);
    let offset = 0;
    for (const entry of batch) {
      const newline = buffer.indexOf(10, offset);
      if (newline < 0 || buffer.subarray(offset, newline).toString() !== `${entry.oid} blob ${entry.size}`) throw new Error("Invalid cat-file blob header.");
      const body = buffer.subarray(newline + 1, newline + 1 + entry.size);
      offset = newline + 1 + entry.size;
      if (buffer[offset++] !== 10 || oidFor(body, algorithm) !== entry.oid) throw new Error(`Blob integrity check failed: ${entry.oid}`);
      const kind = isText(body) ? "text" : "binary";
      const stats = eolStats(body);
      indexCrlf.set(entry.oid, stats.crlf && !stats.binary);
      objects.set(entry.oid, { ...entry, kind });
      if (kind === "text" && snapshotIds.has(entry.oid)) await writeBlob(entry.oid, body);
    }
    if (offset !== buffer.length) throw new Error("Unexpected bytes after cat-file batch.");
    start = end;
  }
  const fromObject = (name: string, version: "base" | "head", entry: Entry): BlobInfo => {
    if (entry.mode === "160000") return missing(name, version, entry, "submodule gitlink; not a blob; submodule content is not traversed");
    if (entry.conflict) return missing(name, version, { ...entry, oid: "" }, "unmerged index stages; no single index blob exists");
    const info = objects.get(entry.oid);
    if (!info || info.kind === "unavailable") return missing(name, version, entry, "Git blob unavailable locally; fetch required objects explicitly");
    return { ...info, mode: entry.mode };
  };

  let fileMode = false;
  let symlinks = true;
  if (opts.uncommitted && !opts.staged) {
    try { fileMode = (await rootText(["config", "--bool", "core.filemode"])) === "true"; } catch { /* Git's default is false. */ }
    try { symlinks = (await rootText(["config", "--bool", "core.symlinks"])) !== "false"; } catch { /* Git's default is true. */ }
  }
  const workingFile = async (name: string, entry: Entry): Promise<BlobInfo | undefined> => {
    // For unknown content an empty oid is deliberate: never claim the index OID
    // identifies unread working bytes. Known gitlinks retain their commit OID.
    const unknown = { ...entry, oid: "" };
    const parts = name.split("/");
    const absolute = path.resolve(repo, ...parts);
    if (!within(repo, absolute) || parts.some(part => !part || part === "." || part === "..") || (process.platform === "win32" && parts.some(part => part.includes("\\") || part.includes(":")))) return missing(name, "head", unknown, "unsafe filesystem path");
    try {
      let parent = repo;
      for (const part of parts.slice(0, -1)) {
        parent = path.join(parent, part);
        const stat = await fs.lstat(parent);
        if (stat.isSymbolicLink()) return missing(name, "head", unknown, "symlink ancestor; not followed");
        if (!stat.isDirectory()) return undefined;
      }
      const stat = await fs.lstat(absolute);
      if (entry.mode === "160000") return missing(name, "head", entry, "submodule gitlink; working submodule contents are not traversed or captured");
      if (stat.isSymbolicLink()) {
        const bytes = await fs.readlink(absolute, { encoding: "buffer" });
        const oid = oidFor(bytes, algorithm);
        const kind = bytes.length > MAX_TEXT_BYTES ? "large" : isText(bytes) ? "text" : "binary";
        if (kind === "text") await writeBlob(oid, bytes);
        return { oid, size: bytes.length, mode: "120000", kind };
      }
      if (!stat.isFile()) return missing(name, "head", unknown, "not a regular file or symlink");
      const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev) return missing(name, "head", unknown, "file changed while opening");
        const hash = createHash(algorithm).update(`blob ${before.size}\0`);
        const chunks: Buffer[] = [];
        const buffer = Buffer.alloc(64 * 1024);
        let total = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          total += bytesRead;
          if (total > before.size) return missing(name, "head", unknown, "file grew during capture");
          hash.update(buffer.subarray(0, bytesRead));
          if (before.size <= MAX_TEXT_BYTES) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
        }
        const after = await handle.stat();
        const current = await fs.lstat(absolute);
        if (total !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev) return missing(name, "head", unknown, "file changed during capture");
        let oid = hash.digest("hex");
        let bytes = Buffer.concat(chunks);
        const kind = total > MAX_TEXT_BYTES ? "large" : isText(bytes) ? "text" : "binary";
        const action = eolActions.get(name) ?? "raw";
        if (kind === "text" && action !== "raw" && bytes.includes(Buffer.from("\r\n"))) {
          const unknownIndex = action === "auto" && !!entry.oid && !entry.conflict && !indexCrlf.has(entry.oid);
          if (unknownIndex) unknownIndexPaths.push(name);
          if (action === "text" || (!unknownIndex && !eolStats(bytes).binary && (entry.conflict || !indexCrlf.get(entry.oid)))) {
            // Latin-1 is a lossless byte mapping, preserving BOMs and Unicode bytes.
            bytes = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
            total = bytes.length;
            oid = oidFor(bytes, algorithm);
            normalizedPaths.push(name);
          }
        }
        if (kind === "text") await writeBlob(oid, bytes);
        const mode = !symlinks && entry.mode === "120000" ? "120000" : fileMode ? (before.mode & 0o111 ? "100755" : "100644") : entry.mode === "100755" ? "100755" : "100644";
        return { oid, size: total, mode, kind };
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof OutputError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      // Storage/output errors must fail capture, not silently remove source text.
      if (code === "ENOSPC" || code === "EEXIST") throw error;
      return missing(name, "head", unknown, `filesystem content unavailable: ${code ?? String(error)}`);
    }
  };

  const files: FileInfo[] = [];
  const paths = [...new Set([...baseTree.keys(), ...headTree.keys()])].sort();
  for (const name of paths) {
    const before = baseTree.get(name);
    const after = headTree.get(name);
    const baseInfo = before ? fromObject(name, "base", before) : undefined;
    const headInfo = after ? (opts.uncommitted && !opts.staged ? await workingFile(name, after) : fromObject(name, "head", after)) : undefined;
    if (!baseInfo && !headInfo) continue;
    const status: FileInfo["status"] = !baseInfo ? "A" : !headInfo ? "D" : baseInfo.oid !== headInfo.oid || baseInfo.mode !== headInfo.mode || !headInfo.oid ? "M" : "";
    files.push({ path: name, ...(baseInfo ? { base: baseInfo } : {}), ...(headInfo ? { head: headInfo } : {}), status });
  }
  Object.assign(scope, { capturedAt: new Date().toISOString(), unavailable });
  const manifest: Manifest = { schemaVersion: 1, repo, base, head, ...(title ? { title } : {}), ...(sourceUrl ? { sourceUrl } : {}), scope, files };
  await fs.writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await fs.unlink(path.join(out, ".capture-in-progress"));
  return manifest;
}

export function parseArgs(args: string[]): CaptureOptions {
  const opts: Record<string, string | boolean> = {};
  const values = new Set(["repo", "out", "pr", "branch", "base", "commit", "range"]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const key = flag.slice(2);
    if (key in opts) throw new Error(`Repeated option: ${flag}`);
    if (key === "uncommitted" || key === "staged") opts[key] = true;
    else if (values.has(key)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${flag}`);
      opts[key] = args[++i];
    } else throw new Error(`Unknown option: ${flag}`);
  }
  const result = opts as unknown as CaptureOptions;
  validateOptions(result);
  return result;
}

if (import.meta.main) {
  if (process.argv.slice(2).includes("--help")) process.stdout.write(HELP);
  else {
    try {
      const opts = parseArgs(process.argv.slice(2));
      const manifest = await capture(opts);
      process.stdout.write(`Captured ${manifest.files.length} files to ${path.resolve(opts.out, "manifest.json")}\n`);
    } catch (error) {
      process.stderr.write(`capture: ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  }
}
