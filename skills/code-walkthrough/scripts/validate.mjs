// skills/code-walkthrough/scripts/validate.ts
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

// skills/code-walkthrough/scripts/diff.ts
var LCS_CELL_BUDGET = 3000000;
function sourceLines(source) {
  if (!source) {
    return [];
  }
  return source.replaceAll(`\r
`, `
`).replace(/\n$/, "").split(`
`);
}
function uniquePositions(lines, start, end) {
  const positions = new Map;
  for (let index = start;index < end; index++) {
    const text = lines[index];
    positions.set(text, positions.has(text) ? -1 : index);
  }
  return positions;
}
function patienceAnchors(before, after, span) {
  const beforePositions = uniquePositions(before, span.beforeStart, span.beforeEnd);
  const afterPositions = uniquePositions(after, span.afterStart, span.afterEnd);
  const candidates = [];
  for (const [text, beforeIndex] of beforePositions) {
    const afterIndex = afterPositions.get(text);
    if (beforeIndex >= 0 && afterIndex !== undefined && afterIndex >= 0) {
      candidates.push({ before: beforeIndex, after: afterIndex });
    }
  }
  const tails = [];
  const predecessors = new Int32Array(candidates.length).fill(-1);
  for (let index2 = 0;index2 < candidates.length; index2++) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if (candidates[tails[middle]].after < candidates[index2].after) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      predecessors[index2] = tails[low - 1];
    }
    tails[low] = index2;
  }
  const anchors = [];
  let index = tails.at(-1) ?? -1;
  while (index >= 0) {
    anchors.push(candidates[index]);
    index = predecessors[index];
  }
  return anchors.reverse();
}
function appendExactDiff(before, after, span, rows) {
  const beforeLength = span.beforeEnd - span.beforeStart;
  const afterLength = span.afterEnd - span.afterStart;
  const width = afterLength + 1;
  const table = new Uint32Array((beforeLength + 1) * width);
  for (let old2 = beforeLength - 1;old2 >= 0; old2--) {
    for (let next2 = afterLength - 1;next2 >= 0; next2--) {
      const cell = old2 * width + next2;
      if (before[span.beforeStart + old2] === after[span.afterStart + next2]) {
        table[cell] = table[(old2 + 1) * width + next2 + 1] + 1;
      } else {
        table[cell] = Math.max(table[(old2 + 1) * width + next2], table[cell + 1]);
      }
    }
  }
  let old = span.beforeStart;
  let next = span.afterStart;
  while (old < span.beforeEnd || next < span.afterEnd) {
    const hasBefore = old < span.beforeEnd;
    const hasAfter = next < span.afterEnd;
    const cell = (old - span.beforeStart) * width + next - span.afterStart;
    if (hasBefore && hasAfter && before[old] === after[next]) {
      rows.push({ kind: "same", text: before[old], old: old + 1, next: next + 1 });
      old++;
      next++;
    } else if (hasAfter && (!hasBefore || table[cell + 1] > table[cell + width])) {
      rows.push({ kind: "add", text: after[next], next: next + 1 });
      next++;
    } else {
      rows.push({ kind: "remove", text: before[old], old: old + 1 });
      old++;
    }
  }
}
function compareLines(before, after) {
  const beforeLines = sourceLines(before);
  const afterLines = sourceLines(after);
  const rows = [];
  const pending = [
    {
      beforeStart: 0,
      beforeEnd: beforeLines.length,
      afterStart: 0,
      afterEnd: afterLines.length
    }
  ];
  let remainingCells = LCS_CELL_BUDGET;
  let remainingScans = (beforeLines.length + afterLines.length) * 8;
  let coarse = false;
  while (pending.length > 0) {
    const span = pending.pop();
    while (span.beforeStart < span.beforeEnd && span.afterStart < span.afterEnd && beforeLines[span.beforeStart] === afterLines[span.afterStart]) {
      rows.push({
        kind: "same",
        text: beforeLines[span.beforeStart],
        old: span.beforeStart + 1,
        next: span.afterStart + 1
      });
      span.beforeStart++;
      span.afterStart++;
    }
    const beforeEnd = span.beforeEnd;
    const afterEnd = span.afterEnd;
    while (span.beforeEnd > span.beforeStart && span.afterEnd > span.afterStart && beforeLines[span.beforeEnd - 1] === afterLines[span.afterEnd - 1]) {
      span.beforeEnd--;
      span.afterEnd--;
    }
    if (span.beforeEnd < beforeEnd) {
      pending.push({
        beforeStart: span.beforeEnd,
        beforeEnd,
        afterStart: span.afterEnd,
        afterEnd
      });
    }
    const beforeLength = span.beforeEnd - span.beforeStart;
    const afterLength = span.afterEnd - span.afterStart;
    const cells = (beforeLength + 1) * (afterLength + 1);
    if (beforeLength > 0 && afterLength > 0 && cells <= remainingCells) {
      remainingCells -= cells;
      appendExactDiff(beforeLines, afterLines, span, rows);
      continue;
    }
    if (beforeLength > 0 && afterLength > 0) {
      const scanSize = beforeLength + afterLength;
      if (scanSize <= remainingScans) {
        remainingScans -= scanSize;
        const anchors = patienceAnchors(beforeLines, afterLines, span);
        if (anchors.length > 0) {
          let oldEnd = span.beforeEnd;
          let nextEnd = span.afterEnd;
          for (let index = anchors.length - 1;index >= 0; index--) {
            const anchor = anchors[index];
            pending.push({
              beforeStart: anchor.before + 1,
              beforeEnd: oldEnd,
              afterStart: anchor.after + 1,
              afterEnd: nextEnd
            });
            pending.push({
              beforeStart: anchor.before,
              beforeEnd: anchor.before + 1,
              afterStart: anchor.after,
              afterEnd: anchor.after + 1
            });
            oldEnd = anchor.before;
            nextEnd = anchor.after;
          }
          pending.push({ ...span, beforeEnd: oldEnd, afterEnd: nextEnd });
          continue;
        }
      }
      coarse = true;
    }
    for (let index = span.beforeStart;index < span.beforeEnd; index++) {
      rows.push({ kind: "remove", text: beforeLines[index], old: index + 1 });
    }
    for (let index = span.afterStart;index < span.afterEnd; index++) {
      rows.push({ kind: "add", text: afterLines[index], next: index + 1 });
    }
  }
  return { rows, coarse };
}

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

// skills/code-walkthrough/scripts/validate.ts
class ValidationError extends Error {
  problems;
  omitted;
  constructor(problems, omitted = 0) {
    super(`Artifact validation failed:
${problems.map((problem) => `- ${problem}`).join(`
`)}${omitted ? `
- ${omitted} further problem(s) omitted.` : ""}`);
    this.name = "ValidationError";
    this.problems = [...problems];
    this.omitted = omitted;
  }
}

class Problems {
  items = [];
  omitted = 0;
  add(message) {
    if (this.items.length < 50) {
      this.items.push(message.length > 600 ? `${message.slice(0, 597)}...` : message);
    } else {
      this.omitted++;
    }
  }
  throwIfAny() {
    if (this.items.length) {
      throw new ValidationError(this.items, this.omitted);
    }
  }
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function isSafePath(value) {
  return isNonemptyString(value) && !/[\\:\x00-\x1f\x7f]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function validateKeys(value, allowed, at, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.add(`${at}: unknown key ${JSON.stringify(key)}; allowed: ${allowed.join(", ")}.`);
    }
  }
}
function validateRequiredText(value, at, errors) {
  if (!isNonemptyString(value)) {
    errors.add(`${at}: expected a nonempty string.`);
  }
}
function validatePathField(value, at, errors) {
  if (!isSafePath(value)) {
    errors.add(`${at}: expected a relative slash-separated path without empty, dot, parent, drive or control segments.`);
  }
}
function validateVersion(value, at, errors) {
  if ("version" in value && !["base", "step", "head"].includes(value.version)) {
    errors.add(`${at}.version: expected "base", "step" or "head".`);
  }
}
function validateAnchor(value, at, isStep, errors) {
  if ("symbol" in value) {
    validateRequiredText(value.symbol, `${at}.symbol`, errors);
    if (typeof value.symbol === "string" && /[\r\n]/.test(value.symbol)) {
      errors.add(`${at}.symbol: must fit on one source line.`);
    }
  }
  if ("count" in value) {
    if (!isPositiveInteger(value.count)) {
      errors.add(`${at}.count: expected a positive safe integer.`);
    }
    if (!("symbol" in value)) {
      errors.add(`${at}.count: requires symbol.`);
    }
  }
  if (isStep) {
    if ("focus" in value) {
      const focus = value.focus;
      if (!Array.isArray(focus) || focus.length !== 2 || !focus.every(isPositiveInteger) || focus[1] < focus[0]) {
        errors.add(`${at}.focus: expected [start, end] with positive 1-based integers and end >= start.`);
      }
      if ("symbol" in value) {
        errors.add(`${at}: choose either focus or symbol/count, not both.`);
      }
    }
  } else {
    for (const field of ["start", "end"]) {
      if (field in value && !isPositiveInteger(value[field])) {
        errors.add(`${at}.${field}: expected a positive safe integer.`);
      }
    }
    if ("end" in value && !("start" in value)) {
      errors.add(`${at}.end: requires start.`);
    }
    if (isPositiveInteger(value.start) && isPositiveInteger(value.end) && value.end < value.start) {
      errors.add(`${at}.end: must be >= start.`);
    }
    if ("symbol" in value && (("start" in value) || ("end" in value))) {
      errors.add(`${at}: choose either start/end or symbol/count, not both.`);
    }
  }
  validateVersion(value, at, errors);
}
function validateBlobShape(value, at, errors) {
  if (!isObject(value)) {
    errors.add(`${at}: expected a BlobInfo object.`);
    return;
  }
  validateKeys(value, ["oid", "size", "kind", "mode"], at, errors);
  if (!(value.kind === "unavailable" && value.oid === "") && (typeof value.oid !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.oid))) {
    errors.add(`${at}.oid: expected a lowercase 40-character SHA-1 or 64-character SHA-256 Git blob ID (or empty for unavailable content).`);
  }
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    errors.add(`${at}.size: expected a nonnegative safe integer byte length.`);
  }
  if (!["text", "binary", "large", "unavailable"].includes(value.kind)) {
    errors.add(`${at}.kind: expected text, binary, large or unavailable.`);
  }
  if ("mode" in value && (typeof value.mode !== "string" || !/^[0-7]{6}$/.test(value.mode))) {
    errors.add(`${at}.mode: expected six octal digits, e.g. "100644".`);
  }
}
function validateManifestShape(value, errors) {
  if (!isObject(value)) {
    errors.add("manifest.json: expected an object.");
    return;
  }
  validateKeys(value, ["schemaVersion", "repo", "base", "head", "title", "sourceUrl", "scope", "files"], "manifest.json", errors);
  if (value.schemaVersion !== 1) {
    errors.add("manifest.schemaVersion: expected 1.");
  }
  for (const key of ["repo", "base", "head"]) {
    validateRequiredText(value[key], `manifest.${key}`, errors);
  }
  for (const key of ["title", "sourceUrl"]) {
    if (key in value) {
      validateRequiredText(value[key], `manifest.${key}`, errors);
    }
  }
  if (typeof value.sourceUrl === "string") {
    try {
      if (!["http:", "https:"].includes(new URL(value.sourceUrl).protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      errors.add("manifest.sourceUrl: expected an absolute HTTP or HTTPS URL.");
    }
  }
  if ("scope" in value && !isObject(value.scope)) {
    errors.add("manifest.scope: expected an object.");
  }
  if (!Array.isArray(value.files)) {
    errors.add("manifest.files: expected an array.");
    return;
  }
  const seen = new Set;
  value.files.forEach((file, index) => {
    const at = `manifest.files[${index}]`;
    if (!isObject(file)) {
      errors.add(`${at}: expected a FileInfo object.`);
      return;
    }
    validateKeys(file, ["path", "base", "head", "status"], at, errors);
    validatePathField(file.path, `${at}.path`, errors);
    if (typeof file.path === "string") {
      if (seen.has(file.path)) {
        errors.add(`${at}.path: duplicate path ${JSON.stringify(file.path)}.`);
      }
      seen.add(file.path);
    }
    for (const side of ["base", "head"]) {
      if (side in file) {
        validateBlobShape(file[side], `${at}.${side}`, errors);
      }
    }
    if (!("base" in file) && !("head" in file)) {
      errors.add(`${at}: requires a base or head snapshot.`);
    }
    if (!["A", "M", "D", ""].includes(file.status)) {
      errors.add(`${at}.status: expected "A", "M", "D" or "".`);
    } else if (file.status === "A" && (("base" in file) || !("head" in file)) || file.status === "D" && (!("base" in file) || ("head" in file)) || (file.status === "M" || file.status === "") && (!("base" in file) || !("head" in file))) {
      errors.add(`${at}.status: inconsistent with base/head presence (A: head only, D: base only, M/empty: both).`);
    }
  });
}
function validateChapters(value, steps, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.add("lesson.chapters: expected a nonempty array; omit chapters for an ungrouped lesson.");
    return;
  }
  const stepPositions = new Map;
  steps.forEach((step, index) => {
    if (isObject(step) && typeof step.id === "string") {
      stepPositions.set(step.id, index);
    }
  });
  const ids = new Set;
  let previousStart = -1;
  value.forEach((chapter, index) => {
    const at = `lesson.chapters[${index}]`;
    if (!isObject(chapter)) {
      errors.add(`${at}: expected a Chapter object.`);
      return;
    }
    validateKeys(chapter, ["id", "title", "start"], at, errors);
    for (const field of ["id", "title", "start"]) {
      validateRequiredText(chapter[field], `${at}.${field}`, errors);
    }
    if (typeof chapter.id === "string") {
      if (ids.has(chapter.id)) {
        errors.add(`${at}.id: duplicate chapter ID ${JSON.stringify(chapter.id)}.`);
      }
      ids.add(chapter.id);
    }
    if (!isNonemptyString(chapter.start)) {
      return;
    }
    const start = stepPositions.get(chapter.start);
    if (start === undefined) {
      errors.add(`${at}.start: unknown step ID ${JSON.stringify(chapter.start)}.`);
      return;
    }
    if (index === 0 && start !== 0) {
      errors.add(`${at}.start: the first chapter must begin at the lesson's first step.`);
    }
    if (start <= previousStart) {
      errors.add(`${at}.start: chapters must begin at distinct steps in increasing lesson order.`);
    }
    previousStart = start;
  });
}
function validateLessonShape(value, errors) {
  if (!isObject(value)) {
    errors.add("lesson.json: expected an object.");
    return;
  }
  validateKeys(value, ["schemaVersion", "title", "steps", "chapters"], "lesson.json", errors);
  if (value.schemaVersion !== 1) {
    errors.add("lesson.schemaVersion: expected 1.");
  }
  validateRequiredText(value.title, "lesson.title", errors);
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    errors.add("lesson.steps: expected a nonempty array.");
    return;
  }
  if ("chapters" in value) {
    validateChapters(value.chapters, value.steps, errors);
  }
  const ids = new Set;
  value.steps.forEach((step, index) => {
    const at = `lesson.steps[${index}]`;
    if (!isObject(step)) {
      errors.add(`${at}: expected a Step object.`);
      return;
    }
    validateKeys(step, ["id", "title", "paragraphs", "file", "focus", "symbol", "count", "version", "changes"], at, errors);
    validateRequiredText(step.id, `${at}.id`, errors);
    validateRequiredText(step.title, `${at}.title`, errors);
    if ("file" in step) {
      validatePathField(step.file, `${at}.file`, errors);
    } else {
      for (const field of ["focus", "symbol", "count", "version"]) {
        if (field in step) {
          errors.add(`${at}.${field}: requires file; omit target fields for a step without a reading target.`);
        }
      }
    }
    if (typeof step.id === "string") {
      if (ids.has(step.id)) {
        errors.add(`${at}.id: duplicate step ID ${JSON.stringify(step.id)}.`);
      }
      ids.add(step.id);
    }
    validateAnchor(step, at, true, errors);
    if (!Array.isArray(step.paragraphs) || step.paragraphs.length === 0) {
      errors.add(`${at}.paragraphs: expected a nonempty array of paragraphs.`);
    } else {
      step.paragraphs.forEach((paragraph, paragraphIndex) => {
        const here = `${at}.paragraphs[${paragraphIndex}]`;
        if (!Array.isArray(paragraph) || paragraph.length === 0) {
          errors.add(`${here}: expected a nonempty array of strings/source links.`);
          return;
        }
        if (paragraph.every((part) => typeof part === "string" && !part.trim())) {
          errors.add(`${here}: paragraph must contain text or a source link.`);
        }
        paragraph.forEach((part, partIndex) => {
          if (typeof part === "string") {
            return;
          }
          const linkAt = `${here}[${partIndex}]`;
          if (!isObject(part)) {
            errors.add(`${linkAt}: expected a string or SourceLink object.`);
            return;
          }
          validateKeys(part, ["label", "path", "view", "start", "end", "symbol", "count", "version"], linkAt, errors);
          validateRequiredText(part.label, `${linkAt}.label`, errors);
          validatePathField(part.path, `${linkAt}.path`, errors);
          validateAnchor(part, linkAt, false, errors);
          if ("view" in part && !["file", "changes"].includes(part.view)) {
            errors.add(`${linkAt}.view: expected "file" or "changes".`);
          }
          if (part.view === "changes") {
            if ("version" in part && part.version !== "step") {
              errors.add(`${linkAt}.version: view:"changes" requires "step" or an omitted version.`);
            }
            if (!("start" in part) && !("symbol" in part)) {
              errors.add(`${linkAt}: view:"changes" requires a start/end or symbol/count anchor.`);
            }
            if (!isObject(step.changes) || typeof part.path !== "string" || !Object.hasOwn(step.changes, part.path)) {
              errors.add(`${linkAt}.path: view:"changes" requires a path in this step's changes.`);
            }
          }
        });
      });
    }
    if ("changes" in step) {
      if (!isObject(step.changes)) {
        errors.add(`${at}.changes: expected an object mapping manifest paths to changes.`);
      } else {
        for (const [path, change] of Object.entries(step.changes)) {
          const changeAt = `${at}.changes[${JSON.stringify(path)}]`;
          validatePathField(path, changeAt, errors);
          if (change === null) {
            continue;
          }
          if (!isObject(change)) {
            errors.add(`${changeAt}: expected {text: string}, {use: "head"} or null.`);
            continue;
          }
          validateKeys(change, ["text", "use"], changeAt, errors);
          if (Object.keys(change).length !== 1 || !(typeof change.text === "string" || change.use === "head")) {
            errors.add(`${changeAt}: expected exactly {text: string} or {use: "head"}.`);
          }
        }
      }
    }
  });
}
async function readRegularFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("expected a regular file, not a symlink or directory");
  }
  return readFile(path);
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
async function readJsonFile(dir, name, errors) {
  try {
    const bytes = await readRegularFile(join(dir, name));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    errors.add(`${name}: cannot read valid UTF-8 JSON: ${errorText(error)}`);
    return;
  }
}
async function loadSnapshots(root, manifest, errors) {
  const blobBytesByOid = new Map;
  const blobTextByOid = new Map;
  const base = new Map;
  const head = new Map;
  const hasText = manifest.files.some((file) => file.base?.kind === "text" || file.head?.kind === "text");
  let blobsSafe = true;
  if (hasText) {
    try {
      const stat = await lstat(join(root, "blobs"));
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("expected a directory, not a symlink");
      }
    } catch (error) {
      errors.add(`blobs/: ${errorText(error)}`);
      blobsSafe = false;
    }
  }
  for (const file of manifest.files) {
    for (const side of ["base", "head"]) {
      const info = file[side];
      if (!info) {
        continue;
      }
      const snapshot = { info };
      (side === "base" ? base : head).set(file.path, snapshot);
      if (info.kind !== "text" || !blobsSafe) {
        continue;
      }
      const at = `manifest ${JSON.stringify(file.path)}.${side}`;
      if (!blobBytesByOid.has(info.oid)) {
        blobBytesByOid.set(info.oid, undefined);
        try {
          const bytes = await readRegularFile(join(root, "blobs", `${info.oid}.txt`));
          const hash = createHash(info.oid.length === 40 ? "sha1" : "sha256").update(`blob ${bytes.length}\x00`).update(bytes).digest("hex");
          if (hash !== info.oid) {
            errors.add(`blobs/${info.oid}.txt: Git blob hash mismatch; actual ${hash}. Recapture the original raw bytes.`);
          }
          const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          blobBytesByOid.set(info.oid, bytes);
          blobTextByOid.set(info.oid, text);
        } catch (error) {
          errors.add(`${at}, blobs/${info.oid}.txt: cannot read UTF-8 text snapshot: ${errorText(error)}`);
        }
      }
      snapshot.bytes = blobBytesByOid.get(info.oid);
      snapshot.text = blobTextByOid.get(info.oid);
      if (snapshot.bytes && snapshot.bytes.length !== info.size) {
        errors.add(`${at}.size: declared ${info.size} bytes, blob contains ${snapshot.bytes.length}. Recapture or correct the manifest.`);
      }
    }
  }
  return { base, head, textBlobs: blobBytesByOid.size };
}
function validateFinalState(manifest, current, head, errors) {
  for (const file of manifest.files) {
    const actual = current.get(file.path);
    const expected = head.get(file.path);
    const at = `final ${JSON.stringify(file.path)}`;
    if (!expected) {
      if (actual) {
        errors.add(`${at}: must be deleted at head; add a null change.`);
      }
      continue;
    }
    if (!actual) {
      errors.add(`${at}: missing head file; introduce it with {use:"head"} or its full exact text.`);
      continue;
    }
    if (actual.info.mode !== expected.info.mode) {
      errors.add(`${at}: mode ${actual.info.mode ?? "(unspecified)"} differs from head ${expected.info.mode ?? "(unspecified)"}; adopt {use:"head"} to capture metadata changes.`);
    }
    if (expected.info.kind === "text" && actual.info.kind === "text") {
      if (actual.bytes && expected.bytes && !actual.bytes.equals(expected.bytes)) {
        errors.add(`${at}: text differs from head bytes (actual ${actual.bytes.length}, head ${expected.bytes.length} bytes). Use exact full source or {use:"head"}; CRLF, BOM and trailing newlines are significant.`);
      }
    } else if (actual.info.kind !== expected.info.kind || actual.info.oid !== expected.info.oid || actual.info.size !== expected.info.size) {
      errors.add(`${at}: snapshot kind/content differs from captured head; adopt {use:"head"} (required for non-text content).`);
    }
  }
}
async function validate(dir, options = {}) {
  const errors = new Problems;
  if (!isNonemptyString(dir)) {
    throw new ValidationError(["artifact directory: expected a nonempty path string."]);
  }
  let root;
  try {
    root = await realpath(dir);
    if (!(await lstat(root)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch (error) {
    throw new ValidationError([`artifact directory: ${errorText(error)}`]);
  }
  const rawManifest = await readJsonFile(root, "manifest.json", errors);
  const rawLesson = await readJsonFile(root, "lesson.json", errors);
  if (rawManifest !== undefined) {
    validateManifestShape(rawManifest, errors);
  }
  if (rawLesson !== undefined) {
    validateLessonShape(rawLesson, errors);
  }
  errors.throwIfAny();
  const manifest = rawManifest;
  const lesson = rawLesson;
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const { base, head, textBlobs } = await loadSnapshots(root, manifest, errors);
  const current = new Map(base);
  const presentation = options.presentation ? { comparisons: 0, coarse: [] } : undefined;
  function validateSelection(path, selected, at, range, symbol, count) {
    if (!files.has(path)) {
      errors.add(`${at}: unknown manifest path ${JSON.stringify(path)}.`);
      return;
    }
    const selectedVersion = selected ?? "step";
    let selectedSnapshots = current;
    if (selectedVersion === "base") {
      selectedSnapshots = base;
    } else if (selectedVersion === "head") {
      selectedSnapshots = head;
    }
    const snapshot = selectedSnapshots.get(path);
    if (!snapshot) {
      errors.add(`${at}: ${JSON.stringify(path)} does not exist in selected version "${selectedVersion}". Introduce it earlier or select an existing version.`);
      return;
    }
    if (!range && symbol === undefined) {
      return;
    }
    if (snapshot.info.kind !== "text") {
      errors.add(`${at}: ${JSON.stringify(path)} is ${snapshot.info.kind} in "${selectedVersion}"; its placeholder has no source lines or symbols.`);
      return;
    }
    if (snapshot.text === undefined) {
      return;
    }
    const lines = snapshot.text.split(`
`);
    if (symbol !== undefined) {
      const matches = [];
      lines.forEach((line, index) => {
        if (line.includes(symbol)) {
          matches.push(index + 1);
        }
      });
      if (matches.length !== 1) {
        const matchDescription = matches.length ? `is ambiguous (${matches.length} matching lines: ${matches.slice(0, 8).join(", ")})` : "was not found";
        errors.add(`${at}: symbol ${JSON.stringify(symbol)} ${matchDescription} in ${JSON.stringify(path)} (${selectedVersion}); use a unique literal substring or explicit line bounds.`);
        return;
      }
      range = [matches[0], matches[0] + (count ?? 1) - 1];
    }
    if (range && (range[0] > lines.length || range[1] > lines.length || !Number.isSafeInteger(range[1]))) {
      errors.add(`${at}: line range ${range[0]}-${range[1]} exceeds ${JSON.stringify(path)} (${selectedVersion}, ${lines.length} lines).`);
    }
  }
  function applyChanges(step, at) {
    for (const [path, change] of Object.entries(step.changes ?? {})) {
      const file = files.get(path);
      const changeAt = `${at}.changes[${JSON.stringify(path)}]`;
      if (!file) {
        errors.add(`${changeAt}: unknown manifest path.`);
        continue;
      }
      if (change === null) {
        current.delete(path);
        continue;
      }
      if ("use" in change) {
        const target = head.get(path);
        if (!target) {
          errors.add(`${changeAt}: use:"head" requires a captured head; this file is deleted at head. Use null.`);
        } else {
          current.set(path, target);
        }
      } else {
        if (file.base?.kind !== "text" && file.head?.kind !== "text") {
          errors.add(`${changeAt}: text overrides require a captured text base or head; use {use:"head"} for non-text files.`);
          continue;
        }
        const bytes = Buffer.from(change.text, "utf8");
        if (bytes.toString("utf8") !== change.text) {
          errors.add(`${changeAt}.text: contains an unpaired UTF-16 surrogate; provide valid Unicode source.`);
          continue;
        }
        const mode = (current.get(path)?.info ?? file.base ?? file.head)?.mode;
        current.set(path, {
          info: { oid: "", size: bytes.length, kind: "text", mode },
          bytes,
          text: change.text
        });
      }
    }
  }
  for (const [index, step] of lesson.steps.entries()) {
    const at = `step ${JSON.stringify(step.id)} [${index}]`;
    const previous = presentation ? new Map(current) : undefined;
    applyChanges(step, at);
    if (step.file !== undefined) {
      validateSelection(step.file, step.version, `${at}.file`, step.focus, step.symbol, step.count);
    }
    for (const [paragraphIndex, paragraph] of step.paragraphs.entries()) {
      for (const [partIndex, part] of paragraph.entries()) {
        if (typeof part === "string") {
          continue;
        }
        const link = part;
        validateSelection(link.path, link.version, `${at}.paragraphs[${paragraphIndex}][${partIndex}] (${JSON.stringify(link.label)})`, link.start === undefined ? undefined : [link.start, link.end ?? link.start], link.symbol, link.count);
      }
    }
    if (presentation && previous && !errors.items.length) {
      for (const path of Object.keys(step.changes ?? {})) {
        const before = previous.get(path);
        const after = current.get(path);
        if (before && before.info.kind !== "text" || after && after.info.kind !== "text") {
          continue;
        }
        try {
          const comparison = compareLines(before?.text ?? "", after?.text ?? "");
          presentation.comparisons++;
          if (comparison.coarse) {
            presentation.coarse.push({ step: step.id, path });
          }
        } catch (error) {
          errors.add(`${at}.changes[${JSON.stringify(path)}]: viewer comparison could not be prepared: ${errorText(error)}`);
        }
      }
    }
  }
  validateFinalState(manifest, current, head, errors);
  errors.throwIfAny();
  return {
    ok: true,
    files: files.size,
    steps: lesson.steps.length,
    textBlobs,
    ...presentation ? { presentation } : {}
  };
}
if (isMainModule(import.meta.url)) {
  try {
    requireSupportedRuntime();
    const args = process.argv.slice(2);
    const usage = "Usage: node scripts/validate.mjs ARTIFACT_DIR [--presentation]";
    if (args.length === 1 && args[0] === "--help") {
      console.log(usage);
    } else if (!args[0] || args[0].startsWith("--") || !(args.length === 1 || args.length === 2 && args[1] === "--presentation")) {
      console.error(usage);
      process.exitCode = 2;
    } else {
      const result = await validate(args[0], { presentation: args[1] === "--presentation" });
      console.log(`Valid artifact: ${result.files} files, ${result.steps} steps, ${result.textBlobs} text blobs.`);
      if (result.presentation) {
        console.log(`Presentation checked: ${result.presentation.comparisons} text comparisons; ${result.presentation.coarse.length} coarse comparisons.`);
        for (const item of result.presentation.coarse) {
          console.warn(`Review step ${JSON.stringify(item.step)}, ${JSON.stringify(item.path)}: the viewer preserves all lines but uses coarse replacement blocks. Check whether the explanation remains easy to follow.`);
        }
      }
    }
  } catch (error) {
    console.error(error instanceof ValidationError ? error.message : `Validation failed: ${errorText(error)}`);
    process.exitCode = 1;
  }
}
export {
  validate,
  ValidationError
};
