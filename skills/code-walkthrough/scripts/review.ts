import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compareLines, type DiffLine } from "./diff";
import { isMainModule, requireSupportedRuntime } from "./runtime";
import type { BlobInfo, Lesson, Manifest, SourceLink, Version } from "./types";

export interface ReviewOptions {
  step?: string;
  all?: boolean;
}

interface Source {
  text?: string;
  kind: string;
}

interface FileReview {
  path: string;
  rows: DiffLine[];
  regions: [number, number][];
  added: number;
  removed: number;
  coarse: boolean;
  note?: string;
}

// These are excerpt boundaries, not claims about the number of distinct ideas.
function regions(rows: DiffLine[]): [number, number][] {
  const result: [number, number][] = [];
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].kind === "same") {
      continue;
    }
    const start = Math.max(0, index - 2);
    const end = Math.min(rows.length, index + 3);
    const previous = result.at(-1);
    if (previous && start <= previous[1]) {
      previous[1] = end;
    } else {
      result.push([start, end]);
    }
  }
  return result;
}

function compareFile(path: string, before?: Source, after?: Source): FileReview {
  if ((before && before.text === undefined) || (after && after.text === undefined)) {
    return {
      path,
      rows: [],
      regions: [],
      added: 0,
      removed: 0,
      coarse: false,
      note: `No textual comparison: ${before?.kind ?? "absent"} → ${after?.kind ?? "absent"}.`,
    };
  }
  const comparison = compareLines(before?.text ?? "", after?.text ?? "");
  const changedRegions = regions(comparison.rows);
  return {
    path,
    rows: comparison.rows,
    regions: changedRegions,
    added: comparison.rows.filter((row) => row.kind === "add").length,
    removed: comparison.rows.filter((row) => row.kind === "remove").length,
    coarse: comparison.coarse,
    ...(changedRegions.length
      ? {}
      : {
          note: "No changed source lines (check file presence, modes or line endings separately).",
        }),
  };
}

function pointerDescription(link: SourceLink, source?: Source): string {
  let start = link.start;
  let end = link.end ?? start;
  if (link.symbol !== undefined && source?.text !== undefined) {
    start =
      source.text
        .replaceAll("\r\n", "\n")
        .split("\n")
        .findIndex((line) => line.includes(link.symbol!)) + 1;
    end = start + (link.count ?? 1) - 1;
  }
  const location = start ? `lines ${start}–${end}` : "whole file";
  return `${link.path} · ${link.version ?? "step"} · ${location} · ${link.view ?? "file"} view`;
}

function detailDiff(files: FileReview[], all: boolean): string[] {
  const output = ["", "Actual edits (old/new line numbers; two context lines):"];
  let remaining = all ? Infinity : 240;
  for (const file of files) {
    output.push("", `### ${file.path} (+${file.added}/−${file.removed})`);
    if (file.note) {
      output.push(file.note);
    }
    if (file.coarse) {
      output.push(
        "Coarse replacement comparison: all source is preserved; additions/removals may overstate the minimal edit.",
      );
    }
    let omitted = 0;
    for (const [start, end] of file.regions) {
      if (remaining > 0) {
        output.push("---");
      }
      for (const row of file.rows.slice(start, end)) {
        if (remaining <= 0) {
          omitted++;
          continue;
        }
        const mark = row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " ";
        output.push(
          `${String(row.old ?? "").padStart(6)} ${String(row.next ?? "").padStart(6)} ${mark} ${row.text}`,
        );
        remaining--;
      }
    }
    if (omitted) {
      output.push(`[${omitted} diff/context rows omitted; rerun with --all for this step.]`);
    }
  }
  return output;
}

/** Evidence for a human teaching review, deliberately separate from validity or quality scores. */
export async function reviewArtifact(
  directory: string,
  options: ReviewOptions = {},
): Promise<string> {
  // Validation guards captured paths, blob integrity and selected-version anchors.
  // This audit is the final authoring pass over a complete lesson, not a draft parser.
  // Resolve the shipped sibling at runtime: bundling its CLI entry guard here
  // would make it mistake review.mjs for the validator's own entrypoint.
  const validatorModule = new URL("validate.mjs", import.meta.url);
  const { validate } = await import(validatorModule.href);
  await validate(directory);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as Manifest;
  const lesson = JSON.parse(await readFile(join(directory, "lesson.json"), "utf8")) as Lesson;
  if (options.step && !lesson.steps.some((step) => step.id === options.step)) {
    throw new Error(
      `Unknown step ID ${JSON.stringify(options.step)}. Run without --step to list IDs.`,
    );
  }
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const blobCache = new Map<string, Promise<Source>>();
  async function captured(blob?: BlobInfo): Promise<Source | undefined> {
    if (!blob) {
      return undefined;
    }
    if (blob.kind !== "text") {
      return { kind: blob.kind };
    }
    if (!blobCache.has(blob.oid)) {
      blobCache.set(
        blob.oid,
        readFile(join(directory, "blobs", `${blob.oid}.txt`), "utf8").then((text) => ({
          text,
          kind: "text",
        })),
      );
    }
    return blobCache.get(blob.oid)!;
  }
  const current = new Map<string, Source | undefined>();
  async function source(path: string, version: Version = "step"): Promise<Source | undefined> {
    const file = files.get(path)!;
    if (version === "step" && current.has(path)) {
      return current.get(path);
    }
    return captured(version === "head" ? file.head : file.base);
  }
  const output = [
    `Teaching review: ${lesson.title}`,
    "Counts identify places to inspect; they do not measure explanation quality or prove coverage.",
    "Line counts include comments and blanks. Regions merge edits with two surrounding context lines.",
    "Only .meta files are counted separately as metadata; scenes, assets and tests remain in the main counts.",
    "",
  ];
  const largest: { id: string; count: number }[] = [];
  for (const [index, step] of lesson.steps.entries()) {
    const reviewed: FileReview[] = [];
    for (const [path, change] of Object.entries(step.changes ?? {})) {
      const before = await source(path);
      let after: Source | undefined;
      if (change === null) {
        after = undefined;
      } else if ("text" in change) {
        after = { text: change.text, kind: "text" };
      } else {
        after = await captured(files.get(path)!.head);
      }
      current.set(path, after);
      if (!options.step || options.step === step.id) {
        reviewed.push(compareFile(path, before, after));
      }
    }
    if (options.step && options.step !== step.id) {
      continue;
    }
    const mainFiles = reviewed.filter((file) => !file.path.endsWith(".meta"));
    const added = mainFiles.reduce((sum, file) => sum + file.added, 0);
    const removed = mainFiles.reduce((sum, file) => sum + file.removed, 0);
    const regionCount = mainFiles.reduce((sum, file) => sum + file.regions.length, 0);
    const pointers = step.paragraphs.flat().filter((part) => typeof part !== "string");
    const words = step.paragraphs
      .flat()
      .map((part) => (typeof part === "string" ? part : part.label))
      .join(" ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    output.push(`${index + 1}. ${step.id} — ${step.title}`);
    output.push(
      `   ${mainFiles.length} files; +${added}/−${removed} lines; ${regionCount} regions; ${words} prose words; ${pointers.length} pointers; ${reviewed.length - mainFiles.length} .meta files.`,
    );
    const unreadable = reviewed.filter((file) => file.note?.startsWith("No textual"));
    if (unreadable.length) {
      output.push(`   ${unreadable.length} file(s) cannot be compared as text.`);
    }
    if (reviewed.some((file) => file.coarse)) {
      output.push("   Includes coarse replacements; counts may overstate minimal edits.");
    }
    largest.push({ id: step.id, count: added + removed });
    if (options.step) {
      output.push("", "Explanation:");
      let pointerIndex = 0;
      for (const paragraph of step.paragraphs) {
        const rendered: string[] = [];
        for (const part of paragraph) {
          if (typeof part === "string") {
            rendered.push(part);
          } else {
            rendered.push(`${part.label} [${++pointerIndex}]`);
          }
        }
        output.push("", rendered.join(""));
      }
      output.push("", "Source pointers:");
      for (const [pointerIndex, pointer] of pointers.entries()) {
        output.push(
          `[${pointerIndex + 1}] ${pointer.label}: ${pointerDescription(pointer, await source(pointer.path, pointer.version))}`,
        );
      }
      if (step.file) {
        const target: SourceLink = {
          label: "Default focus",
          path: step.file,
          version: step.version,
          start: step.focus?.[0],
          end: step.focus?.[1],
          symbol: step.symbol,
          count: step.count,
        };
        output.push(
          `Default focus: ${pointerDescription(target, await source(step.file, step.version))}`,
        );
      }
      output.push(...detailDiff(reviewed, options.all ?? false));
      break;
    }
  }
  if (!options.step) {
    output.push(
      "",
      "Largest textual edits (excluding .meta; inspection order, not a quality verdict):",
    );
    for (const item of largest.sort((a, b) => b.count - a.count).slice(0, 8)) {
      output.push(`- ${item.id}: ${item.count} added/removed lines`);
    }
    output.push(
      "",
      "Inspect a step with --step ID. Compare every meaningful addition/removal with the explanation; links alone do not explain code.",
    );
  }
  return output.join("\n") + "\n";
}

if (isMainModule(import.meta.url)) {
  const usage = "Usage: node scripts/review.mjs ARTIFACT_DIR [--step ID [--all]]";
  try {
    requireSupportedRuntime();
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
      console.log(usage);
    } else if (
      !args[0] ||
      args[0].startsWith("--") ||
      !(
        args.length === 1 ||
        ((args.length === 3 || (args.length === 4 && args[3] === "--all")) &&
          args[1] === "--step" &&
          args[2] &&
          !args[2].startsWith("--"))
      )
    ) {
      console.error(usage);
      process.exitCode = 2;
    } else {
      console.log(await reviewArtifact(args[0], { step: args[2], all: args[3] === "--all" }));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
