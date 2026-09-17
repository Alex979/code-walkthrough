import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { BlobInfo, Lesson, Manifest, SourceLink, Version } from "./types";

/**
 * await validate(artifactDir) -> { ok: true, files, steps, textBlobs }.
 * Failure throws ValidationError; .problems contains up to 50 actionable messages
 * and .omitted counts further problems. This checks identity, not compilation.
 *
 * Snapshots are exact UTF-8 bytes: CRLF, trailing newlines and BOM are preserved.
 * Text changes replace full source and preserve the current mode (or the captured
 * base mode, then head mode, when introducing a file). use:"head" adopts all head
 * metadata. A text change requires at least one captured textual side; it cannot
 * produce a non-text head. Binary/large/unavailable versions allow an unanchored
 * file selection, but cannot supply source lines or symbols.
 *
 * Changes apply before that step's selections/links and accumulate from base.
 * Selections default to version:"step". Lines are 1-based, split on LF (including
 * a final empty line). Symbols are literal substrings matching exactly one line;
 * count is the number of lines starting there (default 1). They are not parsed
 * language symbols. Prose links resolve their own version independently.
 */
export interface ValidationResult {
  ok: true;
  files: number;
  steps: number;
  textBlobs: number;
}

export class ValidationError extends Error {
  readonly problems: string[];
  readonly omitted: number;

  constructor(problems: string[], omitted = 0) {
    super(
      `Artifact validation failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}${omitted ? `\n- ${omitted} further problem(s) omitted.` : ""}`,
    );
    this.name = "ValidationError";
    this.problems = [...problems];
    this.omitted = omitted;
  }
}

class Problems {
  items: string[] = [];
  omitted = 0;

  add(message: string): void {
    if (this.items.length < 50) {
      this.items.push(message.length > 600 ? `${message.slice(0, 597)}...` : message);
    } else {
      this.omitted++;
    }
  }

  throwIfAny(): void {
    if (this.items.length) {
      throw new ValidationError(this.items, this.omitted);
    }
  }
}

type ObjectValue = Record<string, unknown>;

function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafePath(value: unknown): value is string {
  return (
    isNonemptyString(value) &&
    !/[\\:\x00-\x1f\x7f]/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function validateKeys(value: ObjectValue, allowed: string[], at: string, errors: Problems): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.add(`${at}: unknown key ${JSON.stringify(key)}; allowed: ${allowed.join(", ")}.`);
    }
  }
}

function validateRequiredText(value: unknown, at: string, errors: Problems): void {
  if (!isNonemptyString(value)) {
    errors.add(`${at}: expected a nonempty string.`);
  }
}

function validatePathField(value: unknown, at: string, errors: Problems): void {
  if (!isSafePath(value)) {
    errors.add(
      `${at}: expected a relative slash-separated path without empty, dot, parent, drive or control segments.`,
    );
  }
}

function validateVersion(value: ObjectValue, at: string, errors: Problems): void {
  if ("version" in value && !["base", "step", "head"].includes(value.version as string)) {
    errors.add(`${at}.version: expected "base", "step" or "head".`);
  }
}

function validateAnchor(value: ObjectValue, at: string, isStep: boolean, errors: Problems): void {
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
      if (
        !Array.isArray(focus) ||
        focus.length !== 2 ||
        !focus.every(isPositiveInteger) ||
        focus[1] < focus[0]
      ) {
        errors.add(
          `${at}.focus: expected [start, end] with positive 1-based integers and end >= start.`,
        );
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
    if ("symbol" in value && ("start" in value || "end" in value)) {
      errors.add(`${at}: choose either start/end or symbol/count, not both.`);
    }
  }

  validateVersion(value, at, errors);
}

function validateBlobShape(value: unknown, at: string, errors: Problems): void {
  if (!isObject(value)) {
    errors.add(`${at}: expected a BlobInfo object.`);
    return;
  }
  validateKeys(value, ["oid", "size", "kind", "mode"], at, errors);
  if (
    !(value.kind === "unavailable" && value.oid === "") &&
    (typeof value.oid !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.oid))
  ) {
    errors.add(
      `${at}.oid: expected a lowercase 40-character SHA-1 or 64-character SHA-256 Git blob ID (or empty for unavailable content).`,
    );
  }
  if (!Number.isSafeInteger(value.size) || (value.size as number) < 0) {
    errors.add(`${at}.size: expected a nonnegative safe integer byte length.`);
  }
  if (!["text", "binary", "large", "unavailable"].includes(value.kind as string)) {
    errors.add(`${at}.kind: expected text, binary, large or unavailable.`);
  }
  if ("mode" in value && (typeof value.mode !== "string" || !/^[0-7]{6}$/.test(value.mode))) {
    errors.add(`${at}.mode: expected six octal digits, e.g. "100644".`);
  }
}

function validateManifestShape(value: unknown, errors: Problems): void {
  if (!isObject(value)) {
    errors.add("manifest.json: expected an object.");
    return;
  }
  validateKeys(
    value,
    ["schemaVersion", "repo", "base", "head", "title", "sourceUrl", "scope", "files"],
    "manifest.json",
    errors,
  );
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
  const seen = new Set<string>();
  value.files.forEach((file: unknown, index: number) => {
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
    if (!["A", "M", "D", ""].includes(file.status as string)) {
      errors.add(`${at}.status: expected "A", "M", "D" or "".`);
    } else if (
      (file.status === "A" && ("base" in file || !("head" in file))) ||
      (file.status === "D" && (!("base" in file) || "head" in file)) ||
      ((file.status === "M" || file.status === "") && (!("base" in file) || !("head" in file)))
    ) {
      errors.add(
        `${at}.status: inconsistent with base/head presence (A: head only, D: base only, M/empty: both).`,
      );
    }
  });
}

function validateLessonShape(value: unknown, errors: Problems): void {
  if (!isObject(value)) {
    errors.add("lesson.json: expected an object.");
    return;
  }
  validateKeys(value, ["schemaVersion", "title", "steps"], "lesson.json", errors);
  if (value.schemaVersion !== 1) {
    errors.add("lesson.schemaVersion: expected 1.");
  }
  validateRequiredText(value.title, "lesson.title", errors);
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    errors.add("lesson.steps: expected a nonempty array.");
    return;
  }
  const ids = new Set<string>();
  value.steps.forEach((step: unknown, index: number) => {
    const at = `lesson.steps[${index}]`;
    if (!isObject(step)) {
      errors.add(`${at}: expected a Step object.`);
      return;
    }
    validateKeys(
      step,
      ["id", "title", "paragraphs", "file", "focus", "symbol", "count", "version", "changes"],
      at,
      errors,
    );
    validateRequiredText(step.id, `${at}.id`, errors);
    validateRequiredText(step.title, `${at}.title`, errors);
    validatePathField(step.file, `${at}.file`, errors);
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
      step.paragraphs.forEach((paragraph: unknown, paragraphIndex: number) => {
        const here = `${at}.paragraphs[${paragraphIndex}]`;
        if (!Array.isArray(paragraph) || paragraph.length === 0) {
          errors.add(`${here}: expected a nonempty array of strings/source links.`);
          return;
        }
        if (paragraph.every((part) => typeof part === "string" && !part.trim())) {
          errors.add(`${here}: paragraph must contain text or a source link.`);
        }
        paragraph.forEach((part: unknown, partIndex: number) => {
          if (typeof part === "string") {
            return;
          }
          const linkAt = `${here}[${partIndex}]`;
          if (!isObject(part)) {
            errors.add(`${linkAt}: expected a string or SourceLink object.`);
            return;
          }
          validateKeys(
            part,
            ["label", "path", "start", "end", "symbol", "count", "version"],
            linkAt,
            errors,
          );
          validateRequiredText(part.label, `${linkAt}.label`, errors);
          validatePathField(part.path, `${linkAt}.path`, errors);
          validateAnchor(part, linkAt, false, errors);
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
          if (
            Object.keys(change).length !== 1 ||
            !(typeof change.text === "string" || change.use === "head")
          ) {
            errors.add(`${changeAt}: expected exactly {text: string} or {use: "head"}.`);
          }
        }
      }
    }
  });
}

async function readRegularFile(path: string): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("expected a regular file, not a symlink or directory");
  }
  return readFile(path);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonFile(dir: string, name: string, errors: Problems): Promise<unknown> {
  try {
    const bytes = await readRegularFile(join(dir, name));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    errors.add(`${name}: cannot read valid UTF-8 JSON: ${errorText(error)}`);
    return undefined;
  }
}

interface Snapshot {
  info: BlobInfo;
  bytes?: Buffer;
  text?: string;
}

async function loadSnapshots(
  root: string,
  manifest: Manifest,
  errors: Problems,
): Promise<{
  base: Map<string, Snapshot>;
  head: Map<string, Snapshot>;
  textBlobs: number;
}> {
  const blobBytesByOid = new Map<string, Buffer | undefined>();
  const blobTextByOid = new Map<string, string>();
  const base = new Map<string, Snapshot>();
  const head = new Map<string, Snapshot>();
  const hasText = manifest.files.some(
    (file) => file.base?.kind === "text" || file.head?.kind === "text",
  );
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
    for (const side of ["base", "head"] as const) {
      const info = file[side];
      if (!info) {
        continue;
      }
      const snapshot: Snapshot = { info };
      (side === "base" ? base : head).set(file.path, snapshot);
      if (info.kind !== "text" || !blobsSafe) {
        continue;
      }
      const at = `manifest ${JSON.stringify(file.path)}.${side}`;
      if (!blobBytesByOid.has(info.oid)) {
        // Remember failed reads too: shared blobs report their read failure once,
        // while declared byte lengths are still checked for each referencing side.
        blobBytesByOid.set(info.oid, undefined);
        try {
          const bytes = await readRegularFile(join(root, "blobs", `${info.oid}.txt`));
          const hash = createHash(info.oid.length === 40 ? "sha1" : "sha256")
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest("hex");
          if (hash !== info.oid) {
            errors.add(
              `blobs/${info.oid}.txt: Git blob hash mismatch; actual ${hash}. Recapture the original raw bytes.`,
            );
          }
          // ignoreBOM:true means include the BOM in decoded source, not strip it.
          const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          blobBytesByOid.set(info.oid, bytes);
          blobTextByOid.set(info.oid, text);
        } catch (error) {
          errors.add(
            `${at}, blobs/${info.oid}.txt: cannot read UTF-8 text snapshot: ${errorText(error)}`,
          );
        }
      }
      snapshot.bytes = blobBytesByOid.get(info.oid);
      snapshot.text = blobTextByOid.get(info.oid);
      if (snapshot.bytes && snapshot.bytes.length !== info.size) {
        errors.add(
          `${at}.size: declared ${info.size} bytes, blob contains ${snapshot.bytes.length}. Recapture or correct the manifest.`,
        );
      }
    }
  }
  return { base, head, textBlobs: blobBytesByOid.size };
}

function validateFinalState(
  manifest: Manifest,
  current: Map<string, Snapshot>,
  head: Map<string, Snapshot>,
  errors: Problems,
): void {
  // Check the entire union, including files no step happened to mention.
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
      errors.add(
        `${at}: missing head file; introduce it with {use:"head"} or its full exact text.`,
      );
      continue;
    }
    if (actual.info.mode !== expected.info.mode) {
      errors.add(
        `${at}: mode ${actual.info.mode ?? "(unspecified)"} differs from head ${expected.info.mode ?? "(unspecified)"}; adopt {use:"head"} to capture metadata changes.`,
      );
    }
    if (expected.info.kind === "text" && actual.info.kind === "text") {
      if (actual.bytes && expected.bytes && !actual.bytes.equals(expected.bytes)) {
        errors.add(
          `${at}: text differs from head bytes (actual ${actual.bytes.length}, head ${expected.bytes.length} bytes). Use exact full source or {use:"head"}; CRLF, BOM and trailing newlines are significant.`,
        );
      }
    } else if (
      actual.info.kind !== expected.info.kind ||
      actual.info.oid !== expected.info.oid ||
      actual.info.size !== expected.info.size
    ) {
      errors.add(
        `${at}: snapshot kind/content differs from captured head; adopt {use:"head"} (required for non-text content).`,
      );
    }
  }
}

/** Validate a captured manifest, its textual blobs, and the authored cumulative lesson. */
export async function validate(dir: string): Promise<ValidationResult> {
  const errors = new Problems();
  if (!isNonemptyString(dir)) {
    throw new ValidationError(["artifact directory: expected a nonempty path string."]);
  }
  let root: string;
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
  // Reject unsafe OIDs and source paths before loading blobs or applying changes.
  errors.throwIfAny();

  const manifest = rawManifest as Manifest;
  const lesson = rawLesson as Lesson;
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const { base, head, textBlobs } = await loadSnapshots(root, manifest, errors);

  // Each step sees the prior step's state plus its own changes. Captured base/head
  // remain fixed so explicit version selections never drift with the lesson.
  const current = new Map(base);

  function validateSelection(
    path: string,
    selected: Version | undefined,
    at: string,
    range?: [number, number],
    symbol?: string,
    count?: number,
  ): void {
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
      errors.add(
        `${at}: ${JSON.stringify(path)} does not exist in selected version "${selectedVersion}". Introduce it earlier or select an existing version.`,
      );
      return;
    }
    // An opaque snapshot can be selected as a file, but cannot provide anchors.
    if (!range && symbol === undefined) {
      return;
    }
    if (snapshot.info.kind !== "text") {
      errors.add(
        `${at}: ${JSON.stringify(path)} is ${snapshot.info.kind} in "${selectedVersion}"; its placeholder has no source lines or symbols.`,
      );
      return;
    }
    if (snapshot.text === undefined) {
      // Its missing or invalid blob was already reported during loading.
      return;
    }
    const lines = snapshot.text.split("\n");
    if (symbol !== undefined) {
      const matches: number[] = [];
      lines.forEach((line, index) => {
        if (line.includes(symbol)) {
          matches.push(index + 1);
        }
      });
      if (matches.length !== 1) {
        const matchDescription = matches.length
          ? `is ambiguous (${matches.length} matching lines: ${matches.slice(0, 8).join(", ")})`
          : "was not found";
        errors.add(
          `${at}: symbol ${JSON.stringify(symbol)} ${matchDescription} in ${JSON.stringify(path)} (${selectedVersion}); use a unique literal substring or explicit line bounds.`,
        );
        return;
      }
      range = [matches[0], matches[0] + (count ?? 1) - 1];
    }
    if (
      range &&
      (range[0] > lines.length || range[1] > lines.length || !Number.isSafeInteger(range[1]))
    ) {
      errors.add(
        `${at}: line range ${range[0]}-${range[1]} exceeds ${JSON.stringify(path)} (${selectedVersion}, ${lines.length} lines).`,
      );
    }
  }

  function applyChanges(step: Lesson["steps"][number], at: string): void {
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
          errors.add(
            `${changeAt}: use:"head" requires a captured head; this file is deleted at head. Use null.`,
          );
        } else {
          current.set(path, target);
        }
      } else {
        if (file.base?.kind !== "text" && file.head?.kind !== "text") {
          errors.add(
            `${changeAt}: text overrides require a captured text base or head; use {use:"head"} for non-text files.`,
          );
          continue;
        }
        const bytes = Buffer.from(change.text, "utf8");
        if (bytes.toString("utf8") !== change.text) {
          errors.add(
            `${changeAt}.text: contains an unpaired UTF-16 surrogate; provide valid Unicode source.`,
          );
          continue;
        }
        // Text replaces content only. Adopting head is what also updates metadata.
        const mode = (current.get(path)?.info ?? file.base ?? file.head)?.mode;
        current.set(path, {
          info: { oid: "", size: bytes.length, kind: "text", mode },
          bytes,
          text: change.text,
        });
      }
    }
  }

  for (const [index, step] of lesson.steps.entries()) {
    const at = `step ${JSON.stringify(step.id)} [${index}]`;
    // A selection in this step must resolve after its changes have been applied.
    applyChanges(step, at);

    validateSelection(step.file, step.version, `${at}.file`, step.focus, step.symbol, step.count);
    for (const [paragraphIndex, paragraph] of step.paragraphs.entries()) {
      for (const [partIndex, part] of paragraph.entries()) {
        if (typeof part === "string") {
          continue;
        }
        const link: SourceLink = part;
        validateSelection(
          link.path,
          link.version,
          `${at}.paragraphs[${paragraphIndex}][${partIndex}] (${JSON.stringify(link.label)})`,
          link.start === undefined ? undefined : [link.start, link.end ?? link.start],
          link.symbol,
          link.count,
        );
      }
    }
  }

  validateFinalState(manifest, current, head, errors);
  errors.throwIfAny();
  return { ok: true, files: files.size, steps: lesson.steps.length, textBlobs };
}

if (import.meta.main) {
  if (process.argv.length !== 3) {
    console.error("Usage: bun scripts/validate.ts ARTIFACT_DIR");
    process.exitCode = 2;
  } else {
    try {
      const result = await validate(process.argv[2]);
      console.log(
        `Valid artifact: ${result.files} files, ${result.steps} steps, ${result.textBlobs} text blobs.`,
      );
    } catch (error) {
      console.error(
        error instanceof ValidationError ? error.message : `Validation failed: ${errorText(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
