#!/usr/bin/env node

// skills/code-walkthrough/scripts/capture.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// skills/code-walkthrough/scripts/runtime.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
function isMainModule(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}
function requireSupportedRuntime(version = process.versions.node) {
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node.js 22 or newer is required (found ${version}). Install a supported Node.js LTS release from https://nodejs.org/ and retry. No npm install is needed.`);
  }
}

// skills/code-walkthrough/scripts/capture.ts
class OutputError extends Error {
}
var MAX_TEXT_BYTES = 2 * 1024 * 1024;
var decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
var HELP = `Usage: node scripts/capture.mjs --repo PATH --out PATH SCOPE

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
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) {
      delete env[key];
    }
  }
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LITERAL_PATHSPECS: "1",
    GH_PROMPT_DISABLED: "1"
  };
}
async function command(executable, args, cwd, input, allowedExitCodes = [0]) {
  return new Promise((resolve2, reject) => {
    const child = execFile(executable, args, { cwd, env: cleanEnv(), encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error && !allowedExitCodes.includes(Number(error.code))) {
        reject(new Error(`${executable} ${args.join(" ")} failed: ${stderr.toString().trim() || error.message}`));
      } else {
        resolve2(stdout);
      }
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}
function utf8(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error("Git returned a non-UTF-8 path; the manifest cannot represent it losslessly.");
  }
}
function oidFor(bytes, algorithm, type = "blob") {
  return createHash(algorithm).update(`${type} ${bytes.length}\x00`).update(bytes).digest("hex");
}
function isText(bytes) {
  if (bytes.includes(0)) {
    return false;
  }
  try {
    decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
}
function contentKind(bytes, totalSize) {
  if (totalSize > MAX_TEXT_BYTES) {
    return "large";
  }
  return isText(bytes) ? "text" : "binary";
}
function eolStats(bytes) {
  let crlf = false;
  let binary = false;
  let printable = 0;
  let controls = 0;
  for (let i = 0;i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 13) {
      if (bytes[i + 1] === 10) {
        crlf = true;
        i++;
      } else {
        binary = true;
      }
    } else if (byte !== 10) {
      if (byte === 0) {
        binary = true;
      }
      if (byte === 127 || byte < 32 && ![8, 9, 27, 12].includes(byte)) {
        controls++;
      } else {
        printable++;
      }
    }
  }
  if (bytes[bytes.length - 1] === 26) {
    controls--;
  }
  return { crlf, binary: binary || Math.floor(printable / 128) < controls };
}
function attributeEolAction(value) {
  if (value === "unset") {
    return "raw";
  }
  if (value === "set" || value === "input") {
    return "text";
  }
  if (value === "auto") {
    return "auto";
  }
  return;
}
function eolAction(attrs, autocrlf) {
  const action = attributeEolAction(attrs.text) ?? attributeEolAction(attrs.crlf);
  if (action === "raw") {
    return "raw";
  }
  if (attrs.eol === "lf" || attrs.eol === "crlf") {
    return action === "auto" ? "auto" : "text";
  }
  return action ?? (/^(true|yes|on|1|input)$/i.test(autocrlf) ? "auto" : "raw");
}
function within(parent, candidate) {
  const relative2 = path.relative(parent, candidate);
  return relative2 === "" || !relative2.startsWith(`..${path.sep}`) && relative2 !== ".." && !path.isAbsolute(relative2);
}
async function canonicalFuturePath(target) {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const parent = path.dirname(target);
    if (parent === target) {
      throw error;
    }
    return path.join(await canonicalFuturePath(parent), path.basename(target));
  }
}
function validateOptions(options) {
  if (!options.repo || !options.out) {
    throw new Error("--repo and --out are required.");
  }
  const scopes = [
    options.pr !== undefined,
    options.branch !== undefined,
    options.commit !== undefined,
    options.range !== undefined,
    !!options.uncommitted
  ];
  if (scopes.filter(Boolean).length !== 1) {
    throw new Error("Choose exactly one scope: --pr, --branch, --commit, --range, or --uncommitted.");
  }
  if (options.branch !== undefined && !options.base) {
    throw new Error("--branch requires --base.");
  }
  if (options.base !== undefined && options.branch === undefined) {
    throw new Error("--base is only valid with --branch.");
  }
  if (options.staged && !options.uncommitted) {
    throw new Error("--staged requires --uncommitted.");
  }
  if (options.pr !== undefined && !/^(?:[1-9]\d*|https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$)/.test(String(options.pr))) {
    throw new Error("--pr must be a PR number or an HTTPS pull request URL.");
  }
}
function workingFileMode(indexMode, filesystemMode, trackExecutableBit, symlinks) {
  if (!symlinks && indexMode === "120000") {
    return "120000";
  }
  if (trackExecutableBit) {
    return filesystemMode & 73 ? "100755" : "100644";
  }
  return indexMode === "100755" ? "100755" : "100644";
}
function fileStatus(base, head) {
  if (!base) {
    return "A";
  }
  if (!head) {
    return "D";
  }
  if (base.oid !== head.oid || base.mode !== head.mode || !head.oid) {
    return "M";
  }
  return "";
}
async function readTree(git, revision) {
  const result = new Map;
  for (const row of utf8(await git(["ls-tree", "-r", "-z", "--full-tree", revision])).split("\x00")) {
    if (!row) {
      continue;
    }
    const match = /^(\d{6}) (?:blob|commit) ([0-9a-f]+)\t([\s\S]+)$/.exec(row);
    if (!match) {
      throw new Error("Unexpected ls-tree record.");
    }
    result.set(match[3], { mode: match[1], oid: match[2] });
  }
  return result;
}
async function readIndex(git) {
  const indexTree = new Map;
  for (const row of utf8(await git(["ls-files", "--stage", "-z", "--full-name"])).split("\x00")) {
    if (!row) {
      continue;
    }
    const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(row);
    if (!match) {
      throw new Error("Unexpected index record.");
    }
    const previous = indexTree.get(match[4]);
    indexTree.set(match[4], {
      mode: match[1],
      oid: match[2],
      conflict: match[3] !== "0" || previous?.conflict
    });
  }
  return indexTree;
}
async function addUntrackedPaths(repo, indexTree) {
  let directories = [""];
  while (directories.length) {
    const candidates = [];
    for (const directory of directories) {
      const absolute = path.join(repo, directory);
      const stat = await fs.lstat(absolute);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        continue;
      }
      for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
        if (entry.name === ".git") {
          continue;
        }
        const name = directory ? `${directory}/${entry.name}` : entry.name;
        if (indexTree.has(name)) {
          continue;
        }
        candidates.push({ name, directory: entry.isDirectory() && !entry.isSymbolicLink() });
      }
    }
    directories = [];
    if (!candidates.length) {
      break;
    }
    const input = candidates.map((entry) => "./" + entry.name + (entry.directory ? "/" : "")).join("\x00") + "\x00";
    const records = utf8(await command("git", [
      "--no-literal-pathspecs",
      "check-ignore",
      "--no-index",
      "--stdin",
      "-z",
      "--verbose",
      "--non-matching"
    ], repo, input, [0, 1])).split("\x00");
    if (records.length !== candidates.length * 4 + 1) {
      throw new Error("Unexpected check-ignore response.");
    }
    for (let i = 0;i < candidates.length; i++) {
      const candidate = candidates[i];
      const pattern = records[i * 4 + 2];
      if (pattern && !pattern.startsWith("!")) {
        continue;
      }
      if (candidate.directory) {
        let nestedRepo = false;
        try {
          await fs.lstat(path.join(repo, candidate.name, ".git"));
          nestedRepo = true;
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
        if (!nestedRepo) {
          directories.push(candidate.name);
          continue;
        }
      }
      indexTree.set(candidate.name, { mode: candidate.directory ? "040000" : "100644", oid: "" });
    }
  }
}
async function attributeCandidatePaths(repo, workingTree) {
  const names = [];
  for (const [name, entry] of workingTree) {
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      continue;
    }
    const parts = name.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || process.platform === "win32" && /[\\:]/.test(part))) {
      continue;
    }
    let current = repo;
    try {
      for (let i = 0;i < parts.length; i++) {
        current = path.join(current, parts[i]);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          break;
        }
        if (i === parts.length - 1) {
          if (stat.isFile() && stat.size <= MAX_TEXT_BYTES) {
            names.push(name);
          }
        } else if (!stat.isDirectory()) {
          break;
        }
      }
    } catch {}
  }
  return names;
}
async function resolveScope(options, dependencies, repo, algorithm, gitText) {
  const validOid = (value) => typeof value === "string" && new RegExp(`^[0-9a-f]{${algorithm === "sha1" ? 40 : 64}}$`).test(value);
  const resolveCommit = async (ref) => {
    if (!ref || ref.startsWith("-") || ref.includes("\x00")) {
      throw new Error(`Invalid revision: ${ref}`);
    }
    try {
      return await gitText(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
    } catch {
      throw new Error(`Commit ${JSON.stringify(ref)} is not available locally. Fetch the required ref/history explicitly in your repository, then retry.`);
    }
  };
  const mergeBase = async (baseRevision, headRevision) => {
    let bases;
    try {
      bases = (await gitText(["merge-base", "--all", baseRevision, headRevision])).split(/\r?\n/).filter(Boolean);
    } catch {
      throw new Error("No local merge-base is available. Fetch the required history explicitly (deepen/unshallow a shallow clone), then retry.");
    }
    if (bases.length !== 1) {
      throw new Error("Multiple merge bases exist; select one explicitly with --range A..B.");
    }
    return bases[0];
  };
  const scope = {
    objectFormat: algorithm,
    textLimitBytes: MAX_TEXT_BYTES
  };
  let base;
  let head;
  let emptyBase = false;
  let title;
  let sourceUrl;
  if (options.pr !== undefined) {
    const args = [
      "pr",
      "view",
      String(options.pr),
      "--json",
      "number,url,title,baseRefName,baseRefOid,headRefName,headRefOid"
    ];
    let pr;
    try {
      pr = JSON.parse(await (dependencies.gh ? dependencies.gh(args, repo) : command("gh", args, repo).then((result) => result.toString("utf8"))));
    } catch (error) {
      throw new Error(`Authenticated PR resolution through gh failed. Check gh auth status and the repository remote. ${String(error)}`);
    }
    if (!validOid(pr.baseRefOid) || !validOid(pr.headRefOid) || !/^https:\/\//.test(pr.url)) {
      throw new Error("gh returned incomplete or invalid PR revisions.");
    }
    try {
      await resolveCommit(pr.baseRefOid);
      head = await resolveCommit(pr.headRefOid);
    } catch (error) {
      throw new Error(`PR #${pr.number} objects are missing locally. This capture never fetches automatically. In the repository, fetch the authenticated PR refs explicitly, for example: git fetch <verified-base-remote> ${JSON.stringify(pr.baseRefName)} refs/pull/${pr.number}/head. For forks, fetch the head ref from the verified fork remote if needed. Then retry; the fetched OIDs must match gh. ${String(error)}`);
    }
    base = await mergeBase(pr.baseRefOid, head);
    title = pr.title;
    sourceUrl = pr.url;
    Object.assign(scope, {
      kind: "pr",
      requested: String(options.pr),
      number: pr.number,
      baseRef: pr.baseRefName,
      headRef: pr.headRefName,
      baseRevision: pr.baseRefOid,
      headRevision: head,
      mergeBase: base,
      comparison: "merge-base-to-head"
    });
  } else if (options.branch !== undefined) {
    const baseRevision = await resolveCommit(options.base);
    head = await resolveCommit(options.branch);
    base = await mergeBase(baseRevision, head);
    Object.assign(scope, {
      kind: "branch",
      baseRef: options.base,
      headRef: options.branch,
      baseRevision,
      headRevision: head,
      mergeBase: base,
      comparison: "merge-base-to-head"
    });
  } else if (options.commit !== undefined) {
    head = await resolveCommit(options.commit);
    const headers = (await gitText(["cat-file", "commit", head])).split(`

`, 1)[0];
    const parents = [...headers.matchAll(/^parent ([0-9a-f]+)$/gm)].map((match) => match[1]);
    emptyBase = parents.length === 0;
    base = emptyBase ? oidFor(Buffer.alloc(0), algorithm, "tree") : await resolveCommit(parents[0]);
    Object.assign(scope, {
      kind: "commit",
      requested: options.commit,
      baseRevision: emptyBase ? null : base,
      headRevision: head,
      parents,
      emptyBase,
      comparison: "first-parent-to-commit"
    });
  } else if (options.range !== undefined) {
    const match = /^(.+?)(\.{3}|\.{2})([^.].*)$/.exec(options.range);
    if (!match || match[1].includes("..") || match[3].includes("..")) {
      throw new Error("--range requires explicit A..B or A...B endpoints.");
    }
    const baseRevision = await resolveCommit(match[1]);
    head = await resolveCommit(match[3]);
    base = match[2] === "..." ? await mergeBase(baseRevision, head) : baseRevision;
    Object.assign(scope, {
      kind: "range",
      requested: options.range,
      baseRef: match[1],
      headRef: match[3],
      baseRevision,
      headRevision: head,
      comparison: match[2] === "..." ? "merge-base-to-head" : "tree-to-tree",
      ...match[2] === "..." ? { mergeBase: base } : {}
    });
  } else {
    base = await resolveCommit("HEAD");
    head = options.staged ? "index" : "working-tree";
    Object.assign(scope, {
      kind: "uncommitted",
      baseRef: "HEAD",
      baseRevision: base,
      headRevision: null,
      source: head,
      staged: !!options.staged,
      includesUntracked: !options.staged,
      includesIgnoredUntracked: false,
      comparison: options.staged ? "HEAD-to-index" : "HEAD-to-working-tree",
      content: options.staged ? "exact index blobs" : "working bytes with Git-managed CRLF normalized to LF for UTF-8 text <= 2 MiB; hashes, sizes and status describe captured bytes",
      symlinks: "link-target bytes; never followed",
      atomic: false
    });
  }
  return { scope, base, head, emptyBase, title, sourceUrl };
}
async function capture(options, dependencies = {}) {
  validateOptions(options);
  const initial = await fs.realpath(path.resolve(options.repo));
  const git = (args, input) => command("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], initial, input);
  const gitText = async (args) => (await git(args)).toString("utf8").trim();
  const bare = await gitText(["rev-parse", "--is-bare-repository"]) === "true";
  if (bare && options.uncommitted) {
    throw new Error("--uncommitted requires a working tree.");
  }
  const repo = await fs.realpath(bare ? initial : await gitText(["rev-parse", "--show-toplevel"]));
  const rootGit = (args, input) => command("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], repo, input);
  const rootText = async (args) => (await rootGit(args)).toString("utf8").trim();
  const gitDir = await fs.realpath(await rootText(["rev-parse", "--absolute-git-dir"]));
  const commonDir = await fs.realpath(path.resolve(repo, await rootText(["rev-parse", "--git-common-dir"])));
  const outRequested = path.resolve(options.out);
  const out = await canonicalFuturePath(outRequested);
  if ([repo, gitDir, commonDir].some((root) => within(root, out))) {
    throw new Error("Output must be outside the source repository/worktree and Git directory.");
  }
  try {
    if ((await fs.lstat(outRequested)).isSymbolicLink()) {
      throw new Error("Output directory must not be a symlink.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    if ((await fs.readdir(out)).length) {
      throw new Error("Output directory is nonempty; choose a new empty output directory.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const algorithm = await rootText(["rev-parse", "--show-object-format"]);
  if (algorithm !== "sha1" && algorithm !== "sha256") {
    throw new Error(`Unsupported Git object format: ${algorithm}`);
  }
  const { scope, base, head, emptyBase, title, sourceUrl } = await resolveScope(options, dependencies, repo, algorithm, rootText);
  const baseTree = emptyBase ? new Map : await readTree(rootGit, base);
  let headTree;
  if (options.uncommitted) {
    headTree = await readIndex(rootGit);
    if (!options.staged) {
      await addUntrackedPaths(repo, headTree);
    }
  } else {
    headTree = await readTree(rootGit, head);
  }
  const eolActions = new Map;
  const normalizedPaths = [];
  const unknownIndexPaths = [];
  if (options.uncommitted && !options.staged) {
    let autocrlf = "false";
    try {
      autocrlf = await rootText(["config", "--get", "core.autocrlf"]);
    } catch {}
    const names = await attributeCandidatePaths(repo, headTree);
    if (names.length) {
      const records = utf8(await rootGit(["check-attr", "-z", "--stdin", "text", "eol", "crlf"], names.join("\x00") + "\x00")).split("\x00");
      if (records.length !== names.length * 9 + 1) {
        throw new Error("Unexpected check-attr response.");
      }
      for (let i = 0;i < names.length; i++) {
        const attrs = {};
        for (let j = 0;j < 9; j += 3) {
          const offset = i * 9 + j;
          if (records[offset] !== names[i]) {
            throw new Error("Unexpected path in check-attr response.");
          }
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
      normalizedPaths,
      unknownIndexPaths
    };
  }
  await fs.mkdir(out, { recursive: true });
  if ((await fs.readdir(out)).length) {
    throw new Error("Output directory became nonempty; refusing to overwrite it.");
  }
  const lock = await fs.open(path.join(out, ".capture-in-progress"), "wx");
  await lock.close();
  await fs.mkdir(path.join(out, "blobs"));
  const written = new Set;
  const writeBlob = async (oid, bytes) => {
    if (written.has(oid)) {
      return;
    }
    try {
      await fs.writeFile(path.join(out, "blobs", `${oid}.txt`), bytes, { flag: "wx" });
    } catch (error) {
      throw new OutputError(`Unable to write output blob ${oid}: ${String(error)}`);
    }
    written.add(oid);
  };
  const unavailable = [];
  const missing = (name, version, entry, reason) => {
    unavailable.push({ path: name, version, reason });
    return { oid: entry.oid, mode: entry.mode, size: 0, kind: "unavailable" };
  };
  const objects = new Map;
  const snapshotIds = new Set([
    ...baseTree.values(),
    ...!options.uncommitted || options.staged ? headTree.values() : []
  ].map((entry) => entry.oid));
  const indexCrlf = new Map;
  const ids = [
    ...new Set([...baseTree.values(), ...headTree.values()].filter((entry) => entry.oid && entry.mode !== "160000" && !entry.conflict).map((entry) => entry.oid))
  ];
  const eligible = [];
  if (ids.length) {
    const rows = utf8(await rootGit(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], `${ids.join(`
`)}
`)).trim().split(`
`);
    if (rows.length !== ids.length) {
      throw new Error("Incomplete cat-file metadata batch.");
    }
    rows.forEach((row, index) => {
      const [oid, type, sizeText] = row.trim().split(" ");
      const size = Number(sizeText);
      if (oid !== ids[index]) {
        throw new Error("Unexpected object ID in cat-file response.");
      }
      if (type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
        objects.set(oid, { oid, size: 0, kind: "unavailable" });
      } else if (size > MAX_TEXT_BYTES) {
        objects.set(oid, { oid, size, kind: "large" });
      } else {
        eligible.push({ oid, size });
      }
    });
  }
  for (let start = 0;start < eligible.length; ) {
    let end = start;
    let batchBytes = 0;
    while (end < eligible.length && (end === start || batchBytes + eligible[end].size <= 16 * 1024 * 1024) && end - start < 4096) {
      batchBytes += eligible[end].size;
      end++;
    }
    const batch = eligible.slice(start, end);
    const buffer = await rootGit(["cat-file", "--batch"], `${batch.map((entry) => entry.oid).join(`
`)}
`);
    let offset = 0;
    for (const entry of batch) {
      const newline = buffer.indexOf(10, offset);
      if (newline < 0 || buffer.subarray(offset, newline).toString() !== `${entry.oid} blob ${entry.size}`) {
        throw new Error("Invalid cat-file blob header.");
      }
      const body = buffer.subarray(newline + 1, newline + 1 + entry.size);
      offset = newline + 1 + entry.size;
      if (buffer[offset++] !== 10 || oidFor(body, algorithm) !== entry.oid) {
        throw new Error(`Blob integrity check failed: ${entry.oid}`);
      }
      const kind = isText(body) ? "text" : "binary";
      const stats = eolStats(body);
      indexCrlf.set(entry.oid, stats.crlf && !stats.binary);
      objects.set(entry.oid, { ...entry, kind });
      if (kind === "text" && snapshotIds.has(entry.oid)) {
        await writeBlob(entry.oid, body);
      }
    }
    if (offset !== buffer.length) {
      throw new Error("Unexpected bytes after cat-file batch.");
    }
    start = end;
  }
  const fromObject = (name, version, entry) => {
    if (entry.mode === "160000") {
      return missing(name, version, entry, "submodule gitlink; not a blob; submodule content is not traversed");
    }
    if (entry.conflict) {
      return missing(name, version, { ...entry, oid: "" }, "unmerged index stages; no single index blob exists");
    }
    const info = objects.get(entry.oid);
    if (!info || info.kind === "unavailable") {
      return missing(name, version, entry, "Git blob unavailable locally; fetch required objects explicitly");
    }
    return { ...info, mode: entry.mode };
  };
  let fileMode = false;
  let symlinks = true;
  if (options.uncommitted && !options.staged) {
    try {
      fileMode = await rootText(["config", "--bool", "core.filemode"]) === "true";
    } catch {}
    try {
      symlinks = await rootText(["config", "--bool", "core.symlinks"]) !== "false";
    } catch {}
  }
  const workingFile = async (name, entry) => {
    const unknown = { ...entry, oid: "" };
    const parts = name.split("/");
    const absolute = path.resolve(repo, ...parts);
    if (!within(repo, absolute) || parts.some((part) => !part || part === "." || part === "..") || process.platform === "win32" && parts.some((part) => part.includes("\\") || part.includes(":"))) {
      return missing(name, "head", unknown, "unsafe filesystem path");
    }
    try {
      let parent = repo;
      for (const part of parts.slice(0, -1)) {
        parent = path.join(parent, part);
        const stat2 = await fs.lstat(parent);
        if (stat2.isSymbolicLink()) {
          return missing(name, "head", unknown, "symlink ancestor; not followed");
        }
        if (!stat2.isDirectory()) {
          return;
        }
      }
      const stat = await fs.lstat(absolute);
      if (entry.mode === "160000") {
        return missing(name, "head", entry, "submodule gitlink; working submodule contents are not traversed or captured");
      }
      if (stat.isSymbolicLink()) {
        const bytes = await fs.readlink(absolute, { encoding: "buffer" });
        const oid = oidFor(bytes, algorithm);
        const kind = contentKind(bytes, bytes.length);
        if (kind === "text") {
          await writeBlob(oid, bytes);
        }
        return { oid, size: bytes.length, mode: "120000", kind };
      }
      if (!stat.isFile()) {
        return missing(name, "head", unknown, "not a regular file or symlink");
      }
      const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev) {
          return missing(name, "head", unknown, "file changed while opening");
        }
        const hash = createHash(algorithm).update(`blob ${before.size}\x00`);
        const chunks = [];
        const buffer = Buffer.alloc(64 * 1024);
        let total = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) {
            break;
          }
          total += bytesRead;
          if (total > before.size) {
            return missing(name, "head", unknown, "file grew during capture");
          }
          hash.update(buffer.subarray(0, bytesRead));
          if (before.size <= MAX_TEXT_BYTES) {
            chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
          }
        }
        const after = await handle.stat();
        const current = await fs.lstat(absolute);
        if (total !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev) {
          return missing(name, "head", unknown, "file changed during capture");
        }
        let oid = hash.digest("hex");
        let bytes = Buffer.concat(chunks);
        const kind = contentKind(bytes, total);
        const action = eolActions.get(name) ?? "raw";
        if (kind === "text" && action !== "raw" && bytes.includes(Buffer.from(`\r
`))) {
          const unknownIndex = action === "auto" && !!entry.oid && !entry.conflict && !indexCrlf.has(entry.oid);
          if (unknownIndex) {
            unknownIndexPaths.push(name);
          }
          if (action === "text" || !unknownIndex && !eolStats(bytes).binary && (entry.conflict || !indexCrlf.get(entry.oid))) {
            bytes = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, `
`), "latin1");
            total = bytes.length;
            oid = oidFor(bytes, algorithm);
            normalizedPaths.push(name);
          }
        }
        if (kind === "text") {
          await writeBlob(oid, bytes);
        }
        const mode = workingFileMode(entry.mode, before.mode, fileMode, symlinks);
        return { oid, size: total, mode, kind };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof OutputError) {
        throw error;
      }
      const code = error.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return;
      }
      if (code === "ENOSPC" || code === "EEXIST") {
        throw error;
      }
      return missing(name, "head", unknown, `filesystem content unavailable: ${code ?? String(error)}`);
    }
  };
  const files = [];
  const paths = [...new Set([...baseTree.keys(), ...headTree.keys()])].sort();
  for (const name of paths) {
    const before = baseTree.get(name);
    const after = headTree.get(name);
    const baseInfo = before ? fromObject(name, "base", before) : undefined;
    let headInfo;
    if (after) {
      if (options.uncommitted && !options.staged) {
        headInfo = await workingFile(name, after);
      } else {
        headInfo = fromObject(name, "head", after);
      }
    }
    if (!baseInfo && !headInfo) {
      continue;
    }
    const status = fileStatus(baseInfo, headInfo);
    files.push({
      path: name,
      ...baseInfo ? { base: baseInfo } : {},
      ...headInfo ? { head: headInfo } : {},
      status
    });
  }
  Object.assign(scope, { capturedAt: new Date().toISOString(), unavailable });
  const manifest = {
    schemaVersion: 1,
    repo,
    base,
    head,
    ...title ? { title } : {},
    ...sourceUrl ? { sourceUrl } : {},
    scope,
    files
  };
  await fs.writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}
`, {
    flag: "wx"
  });
  await fs.unlink(path.join(out, ".capture-in-progress"));
  return manifest;
}
function parseArgs(args) {
  const options = {};
  const values = new Set(["repo", "out", "pr", "branch", "base", "commit", "range"]);
  for (let i = 0;i < args.length; i++) {
    const flag = args[i];
    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected argument: ${flag}`);
    }
    const key = flag.slice(2);
    if (key in options) {
      throw new Error(`Repeated option: ${flag}`);
    }
    if (key === "uncommitted" || key === "staged") {
      options[key] = true;
    } else if (values.has(key)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
      }
      options[key] = args[++i];
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  const result = options;
  validateOptions(result);
  return result;
}
if (isMainModule(import.meta.url)) {
  try {
    requireSupportedRuntime();
    if (process.argv.slice(2).includes("--help")) {
      process.stdout.write(HELP);
    } else {
      const options = parseArgs(process.argv.slice(2));
      const manifest = await capture(options);
      process.stdout.write(`Captured ${manifest.files.length} files to ${path.resolve(options.out, "manifest.json")}
`);
    }
  } catch (error) {
    process.stderr.write(`capture: ${error.message}
`);
    process.exitCode = 1;
  }
}
export {
  parseArgs,
  capture
};
