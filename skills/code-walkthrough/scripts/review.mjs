// skills/code-walkthrough/scripts/review.ts
import { readFile } from "node:fs/promises";
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

// skills/code-walkthrough/scripts/review.ts
function regions(rows) {
  const result = [];
  for (let index = 0;index < rows.length; index++) {
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
function compareFile(path, before, after) {
  if (before && before.text === undefined || after && after.text === undefined) {
    return {
      path,
      rows: [],
      regions: [],
      added: 0,
      removed: 0,
      coarse: false,
      note: `No textual comparison: ${before?.kind ?? "absent"} → ${after?.kind ?? "absent"}.`
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
    ...changedRegions.length ? {} : {
      note: "No changed source lines (check file presence, modes or line endings separately)."
    }
  };
}
function pointerDescription(link, source) {
  let start = link.start;
  let end = link.end ?? start;
  if (link.symbol !== undefined && source?.text !== undefined) {
    start = source.text.replaceAll(`\r
`, `
`).split(`
`).findIndex((line) => line.includes(link.symbol)) + 1;
    end = start + (link.count ?? 1) - 1;
  }
  const location = start ? `lines ${start}–${end}` : "whole file";
  return `${link.path} · ${link.version ?? "step"} · ${location} · ${link.view ?? "file"} view`;
}
function detailDiff(files, all) {
  const output = ["", "Actual edits (old/new line numbers; two context lines):"];
  let remaining = all ? Infinity : 240;
  for (const file of files) {
    output.push("", `### ${file.path} (+${file.added}/−${file.removed})`);
    if (file.note) {
      output.push(file.note);
    }
    if (file.coarse) {
      output.push("Coarse replacement comparison: all source is preserved; additions/removals may overstate the minimal edit.");
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
        output.push(`${String(row.old ?? "").padStart(6)} ${String(row.next ?? "").padStart(6)} ${mark} ${row.text}`);
        remaining--;
      }
    }
    if (omitted) {
      output.push(`[${omitted} diff/context rows omitted; rerun with --all for this step.]`);
    }
  }
  return output;
}
async function reviewArtifact(directory, options = {}) {
  const validatorModule = new URL("validate.mjs", import.meta.url);
  const { validate } = await import(validatorModule.href);
  await validate(directory);
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  const lesson = JSON.parse(await readFile(join(directory, "lesson.json"), "utf8"));
  if (options.step && !lesson.steps.some((step) => step.id === options.step)) {
    throw new Error(`Unknown step ID ${JSON.stringify(options.step)}. Run without --step to list IDs.`);
  }
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  const blobCache = new Map;
  async function captured(blob) {
    if (!blob) {
      return;
    }
    if (blob.kind !== "text") {
      return { kind: blob.kind };
    }
    if (!blobCache.has(blob.oid)) {
      blobCache.set(blob.oid, readFile(join(directory, "blobs", `${blob.oid}.txt`), "utf8").then((text) => ({
        text,
        kind: "text"
      })));
    }
    return blobCache.get(blob.oid);
  }
  const current = new Map;
  async function source(path, version = "step") {
    const file = files.get(path);
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
    ""
  ];
  const largest = [];
  for (const [index, step] of lesson.steps.entries()) {
    const reviewed = [];
    for (const [path, change] of Object.entries(step.changes ?? {})) {
      const before = await source(path);
      let after;
      if (change === null) {
        after = undefined;
      } else if ("text" in change) {
        after = { text: change.text, kind: "text" };
      } else {
        after = await captured(files.get(path).head);
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
    const words = step.paragraphs.flat().map((part) => typeof part === "string" ? part : part.label).join(" ").trim().split(/\s+/).filter(Boolean).length;
    output.push(`${index + 1}. ${step.id} — ${step.title}`);
    output.push(`   ${mainFiles.length} files; +${added}/−${removed} lines; ${regionCount} regions; ${words} prose words; ${pointers.length} pointers; ${reviewed.length - mainFiles.length} .meta files.`);
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
        const rendered = [];
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
      for (const [pointerIndex2, pointer] of pointers.entries()) {
        output.push(`[${pointerIndex2 + 1}] ${pointer.label}: ${pointerDescription(pointer, await source(pointer.path, pointer.version))}`);
      }
      if (step.file) {
        const target = {
          label: "Default focus",
          path: step.file,
          version: step.version,
          start: step.focus?.[0],
          end: step.focus?.[1],
          symbol: step.symbol,
          count: step.count
        };
        output.push(`Default focus: ${pointerDescription(target, await source(step.file, step.version))}`);
      }
      output.push(...detailDiff(reviewed, options.all ?? false));
      break;
    }
  }
  if (!options.step) {
    output.push("", "Largest textual edits (excluding .meta; inspection order, not a quality verdict):");
    for (const item of largest.sort((a, b) => b.count - a.count).slice(0, 8)) {
      output.push(`- ${item.id}: ${item.count} added/removed lines`);
    }
    output.push("", "Inspect a step with --step ID. Compare every meaningful addition/removal with the explanation; links alone do not explain code.");
  }
  return output.join(`
`) + `
`;
}
if (isMainModule(import.meta.url)) {
  const usage = "Usage: node scripts/review.mjs ARTIFACT_DIR [--step ID [--all]]";
  try {
    requireSupportedRuntime();
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
      console.log(usage);
    } else if (!args[0] || args[0].startsWith("--") || !(args.length === 1 || (args.length === 3 || args.length === 4 && args[3] === "--all") && args[1] === "--step" && args[2] && !args[2].startsWith("--"))) {
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
export {
  reviewArtifact
};
