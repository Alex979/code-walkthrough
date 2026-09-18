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

// viewer/src/model.ts
var steps = [];
function configureLesson(value) {
  steps = value;
}
function changeAt(path, index) {
  for (let stepIndex = Math.min(index, steps.length - 1);stepIndex >= 0; stepIndex--) {
    const changes = steps[stepIndex].changes;
    if (Object.hasOwn(changes ?? {}, path)) {
      return changes[path];
    }
  }
  return;
}
function fileExists(file, index, version) {
  if (version !== "step") {
    return Boolean(file[version]);
  }
  const change = changeAt(file.path, index);
  if (change === null) {
    return false;
  }
  if (change === undefined) {
    return Boolean(file.base);
  }
  if ("text" in change) {
    return true;
  }
  return Boolean(file.head);
}
function fileStatus(file, index, version) {
  if (!fileExists(file, index, version) || version === "base") {
    return "";
  }
  if (version === "head") {
    return file.status;
  }
  const change = changeAt(file.path, index);
  if (change === undefined) {
    return "";
  }
  if (change && "use" in change) {
    return file.status;
  }
  return file.base ? "M" : "A";
}
function normalize(text) {
  return text.replaceAll(`\r
`, `
`);
}
function resolveFocus(text, target) {
  const lines = normalize(text).split(`
`);
  if (target.symbol) {
    const matchIndex = lines.findIndex((line) => line.includes(target.symbol));
    if (matchIndex < 0) {
      return;
    }
    const firstLine = matchIndex + 1;
    const lastLine = Math.min(lines.length, matchIndex + (target.count ?? 1));
    return [firstLine, lastLine];
  }
  if (target.focus) {
    return target.focus;
  }
  if (target.start) {
    return [target.start, target.end ?? target.start];
  }
  return;
}
function parseLocation(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const stepId = params.get("step");
  const stepIndex = Math.max(0, steps.findIndex((item) => item.id === stepId));
  const requestedVersion = params.get("view");
  const firstLine = Number(params.get("line"));
  const requestedEnd = Number(params.get("end"));
  const requestedMode = params.get("mode");
  let version;
  if (["base", "step", "head"].includes(requestedVersion ?? "")) {
    version = requestedVersion;
  }
  let mode;
  if (["file", "diff", "changes"].includes(requestedMode ?? "")) {
    mode = requestedMode;
  }
  let focus;
  if (firstLine > 0) {
    const lastLine = requestedEnd >= firstLine ? requestedEnd : firstLine;
    focus = [firstLine, lastLine];
  }
  const state = {
    step: stepIndex,
    path: params.get("file") ?? undefined,
    version,
    focus,
    mode
  };
  const symbol = params.get("symbol");
  if (!focus && symbol) {
    state.symbol = symbol;
    const count = Number(params.get("count"));
    if (Number.isSafeInteger(count) && count > 0) {
      state.count = count;
    }
  }
  return state;
}
function makeLocation(step, path, version, focus, mode = "file", target) {
  const params = new URLSearchParams({ step: steps[step].id, file: path, view: version, mode });
  if (focus) {
    params.set("line", String(focus[0]));
    params.set("end", String(focus[1]));
  } else if (target?.symbol) {
    params.set("symbol", target.symbol);
    if (target.count !== undefined) {
      params.set("count", String(target.count));
    }
  }
  return `#${params}`;
}
function diffRegions(rows, context = 3, focuses = []) {
  const padding = Math.max(0, Math.floor(context));
  const bounds = [];
  for (let index = 0;index < rows.length; index++) {
    const row = rows[index];
    const currentLine = row.next;
    const includesPointer = currentLine !== undefined && focuses.some(([first, last]) => currentLine >= first && currentLine <= last);
    if (row.kind === "same" && !includesPointer) {
      continue;
    }
    const start = Math.max(0, index - padding);
    const end = Math.min(rows.length - 1, index + padding);
    const previous = bounds[bounds.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      bounds.push({ start, end });
    }
  }
  return bounds.map(({ start, end }) => ({ start, end, rows: rows.slice(start, end + 1) }));
}
function focusScrollTop(scrollTop, viewportHeight, targetTop, targetBottom) {
  if (viewportHeight <= 0) {
    return scrollTop;
  }
  if (targetTop >= scrollTop && targetBottom <= scrollTop + viewportHeight) {
    return scrollTop;
  }
  const targetHeight = targetBottom - targetTop;
  if (targetHeight > viewportHeight) {
    const spaceAbove = targetTop - scrollTop;
    if (spaceAbove >= 0 && spaceAbove <= 48) {
      return scrollTop;
    }
    return Math.max(0, targetTop - 48);
  }
  const context = Math.min(48, (viewportHeight - targetHeight) / 2);
  if (targetTop < scrollTop) {
    return Math.max(0, targetTop - context);
  }
  return Math.max(0, targetBottom - viewportHeight + context);
}
function defaultSelection(step) {
  if (Object.keys(step.changes ?? {}).length > 0) {
    return { path: "", version: "step", mode: "changes" };
  }
  return { path: step.file ?? "", version: step.version ?? "step", mode: "file" };
}

// viewer/src/changes.ts
var CREATED_FILE_CONTEXT_LINES = 80;
function editedSpans(rows, side) {
  const spans = [];
  let precedingLine = 0;
  let active;
  for (const row of rows) {
    const line = row[side];
    if (row.kind === "same") {
      active = undefined;
    } else if (row.text.trim() !== "") {
      const location2 = line ?? precedingLine + 1;
      if (active) {
        active.first = Math.min(active.first, location2);
        active.last = Math.max(active.last, location2);
      } else {
        active = { first: location2, last: location2 };
        spans.push(active);
      }
    }
    if (line !== undefined) {
      precedingLine = line;
    }
  }
  return spans;
}
function continueRegions(rows, regions, previous) {
  const currentEdits = editedSpans(rows, "old");
  const bounds = regions.map((region) => ({ ...region }));
  for (const region of previous.regions) {
    const previousEdits = editedSpans(region.rows, "next");
    const relatedEdits = currentEdits.filter((current) => previousEdits.some((earlier) => current.first <= earlier.last + 1 && current.last >= earlier.first - 1));
    if (!relatedEdits.length) {
      continue;
    }
    const survivingLines = region.rows.flatMap((row) => row.next === undefined ? [] : [row.next]);
    if (!survivingLines.length) {
      continue;
    }
    const first = survivingLines[0];
    const last = survivingLines[survivingLines.length - 1];
    let retainedSpans = [{ first, last }];
    if (previous.kind === "added" && last - first + 1 > CREATED_FILE_CONTEXT_LINES) {
      retainedSpans = relatedEdits.map((edit) => {
        const start = Math.max(first, Math.min(edit.first - CREATED_FILE_CONTEXT_LINES / 2, last - CREATED_FILE_CONTEXT_LINES + 1));
        return { first: start, last: start + CREATED_FILE_CONTEXT_LINES - 1 };
      });
    }
    for (const span of retainedSpans) {
      let start = -1;
      let end = -1;
      for (let index = 0;index < rows.length; index++) {
        const oldLine = rows[index].old;
        if (oldLine !== undefined && oldLine >= span.first && oldLine <= span.last) {
          if (start < 0) {
            start = index;
          }
          end = index;
        }
      }
      if (start >= 0) {
        bounds.push({ start, end, rows: [], continued: true });
      }
    }
  }
  bounds.sort((left, right) => left.start - right.start);
  const merged = [];
  for (const bound of bounds) {
    const preceding = merged[merged.length - 1];
    if (preceding && bound.start <= preceding.end + 1) {
      preceding.end = Math.max(preceding.end, bound.end);
      if (bound.continued) {
        preceding.continued = true;
      }
    } else {
      merged.push({ ...bound });
    }
  }
  return merged.map((region) => ({ ...region, rows: rows.slice(region.start, region.end + 1) }));
}
function changeKind(previous, current) {
  if (!previous.exists && current.exists) {
    return "added";
  }
  if (previous.exists && !current.exists) {
    return "deleted";
  }
  return "modified";
}
async function prepareFileChange(path, at, readState, pointers, preceding) {
  let previous;
  let current;
  try {
    [previous, current] = await Promise.all([readState(path, at - 1), readState(path, at)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path,
      kind: "modified",
      regions: [],
      notice: `Could not load this file's changes: ${message}`,
      failed: true
    };
  }
  const kind = changeKind(previous, current);
  const change = { path, kind, regions: [], failed: false };
  if (previous.exists && previous.text === undefined || current.exists && current.text === undefined) {
    let action = "Updated asset";
    if (kind === "added") {
      action = "Added asset";
    } else if (kind === "deleted") {
      action = "Deleted asset";
    }
    change.notice = `${action}. This capture does not provide a text comparison.`;
    return change;
  }
  const previousText = previous.exists ? previous.text : "";
  const currentText = current.exists ? current.text : "";
  try {
    const focuses = [];
    if (current.exists) {
      for (const pointer of pointers) {
        if (pointer.path !== path || pointer.view !== "changes" || pointer.version !== undefined && pointer.version !== "step") {
          continue;
        }
        const focus = resolveFocus(currentText, pointer);
        if (focus) {
          focuses.push(focus);
        }
      }
    }
    const comparison = compareLines(previousText, currentText);
    const rows = comparison.rows;
    if (comparison.coarse) {
      change.coarse = true;
    }
    const currentLines = normalize(currentText).split(`
`);
    const finalLine = currentLines.length;
    if (currentLines.at(-1) === "" && focuses.some(([first, last]) => first <= finalLine && last >= finalLine)) {
      const previousLines = normalize(previousText).split(`
`);
      const old = previous.exists && previousLines.at(-1) === "" ? previousLines.length : undefined;
      rows.push({ kind: "same", text: "", next: finalLine, old });
    }
    change.regions = diffRegions(rows, 3, focuses);
    if (preceding && !preceding.failed && !preceding.coarse && !comparison.coarse) {
      change.regions = continueRegions(rows, change.regions, preceding);
    }
    if (!change.regions.length) {
      change.notice = "No visible line differences. File bytes or metadata may have changed.";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    change.notice = `Could not compare this file's changes: ${message}`;
    change.failed = true;
  }
  return change;
}
function prepareStepChanges(paths, at, readState, pointers = [], previousChanges = []) {
  return Promise.all(paths.map((path) => prepareFileChange(path, at, readState, pointers, previousChanges.find((change) => change.path === path))));
}

// viewer/src/scroll.ts
function minimalRevealScrollTop(scrollTop, viewportHeight, targetTop, targetBottom, bottomContext = 0) {
  const current = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(targetTop) || !Number.isFinite(targetBottom) || viewportHeight <= 0 || targetBottom < targetTop) {
    return current;
  }
  if (targetBottom - targetTop > viewportHeight || targetTop < current) {
    return Math.max(0, targetTop);
  }
  const requestedContext = Number.isFinite(bottomContext) ? Math.max(0, bottomContext) : 0;
  const availableContext = viewportHeight - (targetBottom - targetTop);
  const revealBottom = targetBottom + Math.min(requestedContext, availableContext);
  if (revealBottom > current + viewportHeight) {
    return Math.max(0, revealBottom - viewportHeight);
  }
  return current;
}
function reserveScrollSpace(body, desiredScrollTop) {
  const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
  if (!Number.isFinite(desiredScrollTop) || desiredScrollTop <= maxScrollTop) {
    return { maxScrollTop, release: () => {}, dispose: () => {} };
  }
  const spacer = body.ownerDocument.createElement("div");
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.flexShrink = "0";
  spacer.style.overflowAnchor = "none";
  const reservedTop = Math.ceil(desiredScrollTop);
  let height = reservedTop + body.clientHeight;
  spacer.style.height = `${height}px`;
  body.append(spacer);
  height -= body.scrollHeight - body.clientHeight - reservedTop;
  spacer.style.height = `${Math.max(0, height)}px`;
  let disposed = false;
  let releasing = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    body.removeEventListener("scroll", shrink);
    spacer.remove();
  };
  const shrink = () => {
    if (disposed) {
      return;
    }
    if (body.scrollTop <= maxScrollTop) {
      dispose();
      return;
    }
    const surplus = body.scrollHeight - body.clientHeight - body.scrollTop;
    height = Math.max(0, height - Math.max(0, Math.floor(surplus)));
    spacer.style.height = `${height}px`;
  };
  const release = () => {
    if (disposed || releasing) {
      return;
    }
    releasing = true;
    body.addEventListener("scroll", shrink, { passive: true });
    shrink();
  };
  return { maxScrollTop, release, dispose };
}
function animateScroll(body, target, onFinish, onCancel) {
  const view = body.ownerDocument.defaultView;
  const clamp = (value) => {
    const maximum = Math.max(0, body.scrollHeight - body.clientHeight);
    return Math.min(maximum, Math.max(0, value));
  };
  const destination = Number.isFinite(target) ? clamp(target) : body.scrollTop;
  const reducedMotion = view?.matchMedia("(prefers-reduced-motion: reduce)");
  if (!view || reducedMotion?.matches || destination === body.scrollTop) {
    body.scrollTop = destination;
    onFinish?.();
    return () => {};
  }
  const start = body.scrollTop;
  const duration = 600;
  let startedAt;
  let frame = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) {
      return false;
    }
    stopped = true;
    view.cancelAnimationFrame(frame);
    body.removeEventListener("wheel", cancel);
    body.removeEventListener("touchstart", cancel);
    body.removeEventListener("pointerdown", cancel);
    body.removeEventListener("keydown", onKeyDown);
    reducedMotion?.removeEventListener("change", onMotionChange);
    return true;
  };
  const cancel = () => {
    if (stop()) {
      onCancel?.();
    }
  };
  const finish = () => {
    if (stop()) {
      onFinish?.();
    }
  };
  const onKeyDown = (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      cancel();
    }
  };
  const onMotionChange = () => {
    if (reducedMotion?.matches) {
      body.scrollTop = clamp(destination);
      finish();
    }
  };
  const tick = (time) => {
    if (stopped) {
      return;
    }
    startedAt ??= time;
    const progress = Math.min(1, Math.max(0, (time - startedAt) / duration));
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    body.scrollTop = clamp(start + (destination - start) * eased);
    if (progress === 1) {
      finish();
      return;
    }
    frame = view.requestAnimationFrame(tick);
  };
  body.addEventListener("wheel", cancel, { passive: true });
  body.addEventListener("touchstart", cancel, { passive: true });
  body.addEventListener("pointerdown", cancel, { passive: true });
  body.addEventListener("keydown", onKeyDown);
  reducedMotion?.addEventListener("change", onMotionChange);
  frame = view.requestAnimationFrame(tick);
  return cancel;
}

// viewer/src/prose.ts
function escapeText(text) {
  return text.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}
function markerRun(text, start, marker) {
  let end = start;
  while (text[end] === marker) {
    end++;
  }
  return end - start;
}
function closingBacktick(text, start) {
  let position = text.indexOf("`", start);
  while (position !== -1) {
    const length = markerRun(text, position, "`");
    if (length === 1) {
      return position;
    }
    position = text.indexOf("`", position + length);
  }
  return -1;
}
function renderInline(text) {
  const frames = [{ marker: "", fragments: [] }];
  let position = 0;
  function append(fragment) {
    frames[frames.length - 1].fragments.push(fragment);
  }
  function closeFrame() {
    const frame = frames.pop();
    const tag = frame.marker === "**" ? "strong" : "em";
    append(`<${tag}>${frame.fragments.join("")}</${tag}>`);
  }
  while (position < text.length) {
    const character = text[position];
    if (character === "\\" && /[\\`*]/.test(text[position + 1] ?? "")) {
      append(escapeText(text[position + 1]));
      position += 2;
      continue;
    }
    if (character === "`") {
      const length = markerRun(text, position, "`");
      const close = length === 1 ? closingBacktick(text, position + 1) : -1;
      if (close !== -1) {
        append(`<code>${escapeText(text.slice(position + 1, close))}</code>`);
        position = close + 1;
      } else {
        append("`".repeat(length));
        position += length;
      }
      continue;
    }
    if (character === "*") {
      const length = markerRun(text, position, "*");
      const previous = text[position - 1];
      const next = text[position + length];
      const canClose = previous !== undefined && !/\s/.test(previous);
      const canOpen = next !== undefined && !/\s/.test(next);
      let remaining = length;
      while (canClose && frames.length > 1) {
        const frame = frames[frames.length - 1];
        if (frame.marker.length > remaining) {
          break;
        }
        remaining -= frame.marker.length;
        closeFrame();
      }
      if (canOpen && remaining > 0 && remaining <= 3) {
        if (remaining >= 2) {
          frames.push({ marker: "**", fragments: [] });
          remaining -= 2;
        }
        if (remaining === 1) {
          frames.push({ marker: "*", fragments: [] });
          remaining--;
        }
      }
      append("*".repeat(remaining));
      position += length;
      continue;
    }
    append(escapeText(character));
    position++;
  }
  while (frames.length > 1) {
    const frame = frames.pop();
    append(frame.marker + frame.fragments.join(""));
  }
  return frames[0].fragments.join("");
}

// viewer/src/navigation.ts
function isFocusRendered(focus, renderedLines) {
  if (!focus) {
    return true;
  }
  const lines = new Set(renderedLines);
  for (let line = focus[0];line <= focus[1]; line++) {
    if (!lines.has(line)) {
      return false;
    }
  }
  return true;
}
function fullFileFocus(filePath, targetVersion, visibleLine, selection) {
  if (visibleLine !== undefined) {
    return [visibleLine, visibleLine];
  }
  if (filePath === selection.path && targetVersion === selection.version && selection.focus) {
    return [...selection.focus];
  }
  return;
}

class ReadingMemory {
  positions = new Map;
  clear() {
    this.positions.clear();
  }
  key(stepId, path, overview) {
    return JSON.stringify([stepId, overview ? "changes" : "file", overview ? "" : path]);
  }
  save(stepId, position) {
    const key = this.key(stepId, position.path, position.mode === "changes");
    this.positions.set(key, this.copy(position));
  }
  file(stepId, path) {
    const position = this.positions.get(this.key(stepId, path, false));
    return position ? this.copy(position) : undefined;
  }
  overview(stepId) {
    const position = this.positions.get(this.key(stepId, "", true));
    return position ? this.copy(position) : undefined;
  }
  forgetFile(path) {
    for (const [key, position] of this.positions) {
      if (position.mode !== "changes" && position.path === path) {
        this.positions.delete(key);
      }
    }
  }
  copy(position) {
    return { ...position, focus: position.focus ? [...position.focus] : undefined };
  }
}

// viewer/src/chapters.ts
function chapterRanges(lesson) {
  const starts = (lesson.chapters ?? []).map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    start: lesson.steps.findIndex((step) => step.id === chapter.start)
  }));
  return starts.map((chapter, index) => ({
    ...chapter,
    end: (starts[index + 1]?.start ?? lesson.steps.length) - 1
  }));
}
function chapterAt(chapters, step) {
  return chapters.find((chapter) => chapter.start <= step && step <= chapter.end);
}

// viewer/src/resume.ts
function shouldResume(hash, savedHash, navigationType) {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const explicit = ["step", "file", "view", "mode", "line", "symbol"].some((key) => parameters.has(key));
  return !explicit || navigationType === "reload" && hash === savedHash;
}
async function resumeStorageKey(manifest, lesson) {
  const content = new TextEncoder().encode(JSON.stringify([manifest, lesson]));
  const digest = await crypto.subtle.digest("SHA-256", content);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `code-walkthrough:resume:v1:${hash}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function isScroll(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isPosition(value, paths) {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "path",
    "version",
    "mode",
    "focus",
    "scrollTop",
    "scrollLeft",
    "expandDiff"
  ])) {
    return false;
  }
  if (typeof value.path !== "string" || value.path !== "" && !paths.has(value.path)) {
    return false;
  }
  if (!["base", "step", "head"].includes(value.version)) {
    return false;
  }
  if (!["file", "changes", "diff"].includes(value.mode)) {
    return false;
  }
  if (value.mode === "changes" && value.version !== "step") {
    return false;
  }
  if (value.path === "" && (value.mode === "diff" || value.focus !== undefined)) {
    return false;
  }
  if (!isScroll(value.scrollTop) || !isScroll(value.scrollLeft) || typeof value.expandDiff !== "boolean") {
    return false;
  }
  if (value.focus !== undefined) {
    if (!Array.isArray(value.focus) || value.focus.length !== 2 || !value.focus.every((line) => Number.isSafeInteger(line) && line >= 1) || value.focus[1] < value.focus[0]) {
      return false;
    }
  }
  return true;
}
function isResumeState(value, lesson, paths) {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "stepId",
    "position",
    "guideScrollTop",
    "tabs",
    "positions",
    "showFiles",
    "showGuide"
  ])) {
    return false;
  }
  if (typeof value.stepId !== "string" || !lesson.steps.some((step) => step.id === value.stepId)) {
    return false;
  }
  if (!isPosition(value.position, paths) || !isScroll(value.guideScrollTop) || typeof value.showFiles !== "boolean" || typeof value.showGuide !== "boolean") {
    return false;
  }
  if (!Array.isArray(value.tabs) || value.tabs.length > paths.size || !value.tabs.every((path) => typeof path === "string" && path !== "" && paths.has(path)) || new Set(value.tabs).size !== value.tabs.length) {
    return false;
  }
  if (!Array.isArray(value.positions) || value.positions.length > paths.size + 1 || !value.positions.every((position) => isPosition(position, paths))) {
    return false;
  }
  const memories = new Set;
  for (const position of value.positions) {
    const key = position.mode === "changes" ? "changes" : `file:${position.path}`;
    if (memories.has(key) || position.mode !== "changes" && !value.tabs.includes(position.path)) {
      return false;
    }
    memories.add(key);
  }
  return true;
}
function loadResume(storage, key, lesson, paths) {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return;
    }
    const envelope = JSON.parse(raw);
    if (!isRecord(envelope) || !hasOnlyKeys(envelope, ["version", "state"]) || envelope.version !== 1 || !isResumeState(envelope.state, lesson, paths)) {
      return;
    }
    return envelope.state;
  } catch {
    return;
  }
}
function saveResume(storage, key, state) {
  try {
    storage.setItem(key, JSON.stringify({ version: 1, state }));
    return true;
  } catch {
    return false;
  }
}
function clearResume(storage, key) {
  try {
    storage.removeItem(key);
  } catch {}
}

// viewer/src/app.ts
var root = document.querySelector("#app");
var textCache = new Map;
var openFolders = new Set;
var tabs = [];
var steps2 = [];
var lesson;
var manifest;
var files;
var step = 0;
var path = "";
var version = "step";
var focus;
var mode = "file";
var filter = "";
var onlyChanged = false;
var expandDiff = false;
var requestId = 0;
var guideLinks = [];
var showFiles = window.innerWidth > 560;
var showGuide = true;
var initialRender = true;
var renderedSource = "";
var readingMemory = new ReadingMemory;
var chapters = [];
var contentsOpen = false;
var guideScrollTop = 0;
var resumeKey = "";
var resumeStorage;
var resumeReady = false;
var saveTimer;
var cancelCodeScroll;
function currentPosition() {
  const body = root.querySelector("#code-body");
  return {
    path,
    version,
    mode,
    focus,
    expandDiff,
    scrollTop: body.scrollTop,
    scrollLeft: body.scrollLeft
  };
}
function persistResume() {
  if (!resumeReady || !resumeStorage || renderedSource !== sourceIdentity()) {
    return;
  }
  rememberPosition();
  const positions = tabs.flatMap((filePath) => {
    const position = readingMemory.file(steps2[step].id, filePath);
    return position ? [position] : [];
  });
  const overview = readingMemory.overview(steps2[step].id);
  if (overview) {
    positions.push(overview);
  }
  if (!contentsOpen && showGuide) {
    guideScrollTop = root.querySelector("#guide-content").scrollTop;
  }
  saveResume(resumeStorage, resumeKey, {
    stepId: steps2[step].id,
    position: currentPosition(),
    guideScrollTop,
    tabs: [...tabs],
    positions,
    showFiles,
    showGuide
  });
}
function scheduleResumeSave() {
  if (!resumeReady) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistResume, 200);
}
function sourceIdentity() {
  return JSON.stringify([step, version, mode, mode === "changes" ? "" : path, expandDiff]);
}
function rememberPosition() {
  if (renderedSource !== sourceIdentity() || !path && mode !== "changes") {
    return;
  }
  const body = root.querySelector("#code-body");
  readingMemory.save(steps2[step].id, {
    path,
    version,
    mode,
    focus,
    expandDiff,
    scrollTop: body.scrollTop,
    scrollLeft: body.scrollLeft
  });
}
function applyPosition(position) {
  path = position.path;
  version = position.version;
  mode = position.mode;
  focus = position.focus;
  expandDiff = position.expandDiff;
}
var changeRegions = [];
var stepChangesCache = new Map;
function escape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function highlight(text, file) {
  if (!/\.(?:cs|ts|js|json|shader|hlsl|cginc|yaml|yml|asmdef)$/.test(file)) {
    return escape(text);
  }
  const tokenPattern = /\/\/.*$|"(?:\\.|[^"\\])*"|\b(?:public|private|internal|static|readonly|sealed|abstract|record|struct|class|namespace|using|return|yield|break|if|else|new|var|double|int|bool|null|true|false|try|finally|foreach|in|continue|throw|out|is|not|switch)\b|\b\d+(?:\.\d+)?\b/g;
  let output = "";
  let offset = 0;
  for (const match of text.matchAll(tokenPattern)) {
    output += escape(text.slice(offset, match.index));
    const token = match[0];
    let kind = "keyword";
    if (token.startsWith("//")) {
      kind = "comment";
    } else if (token.startsWith('"')) {
      kind = "string";
    } else if (/^\d/.test(token)) {
      kind = "number";
    }
    output += `<span class="${kind}">${escape(token)}</span>`;
    offset = match.index + token.length;
  }
  return output + escape(text.slice(offset));
}
async function readBlob(file, version2) {
  const info = file[version2];
  if (!info || info.kind !== "text") {
    return;
  }
  if (!textCache.has(info.oid)) {
    const pendingText = fetch(`/blobs/${info.oid}.txt`).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not read ${file.path} (${response.status}).`);
      }
      return normalize(await response.text());
    }).catch((error) => {
      textCache.delete(info.oid);
      throw error;
    });
    textCache.set(info.oid, pendingText);
  }
  return textCache.get(info.oid);
}
async function read(filePath, view, at = step) {
  const file = files.get(filePath);
  if (!file) {
    return;
  }
  if (view !== "step") {
    return readBlob(file, view);
  }
  const change = changeAt(filePath, at);
  if (change === null) {
    return;
  }
  if (change && "text" in change) {
    return normalize(change.text);
  }
  return readBlob(file, change ? "head" : "base");
}
function revealPath(filePath) {
  const segments = filePath.split("/");
  for (let depth = 1;depth < segments.length; depth++) {
    openFolders.add(segments.slice(0, depth).join("/"));
  }
  if (!tabs.includes(filePath)) {
    tabs.push(filePath);
  }
}
function updateLocation() {
  history.pushState(null, "", makeLocation(step, path, version, focus, mode));
}
function existsInView(filePath) {
  const file = files.get(filePath);
  return Boolean(file && fileExists(file, step, version));
}
function reconcileSelection() {
  if (path && mode !== "changes") {
    revealPath(path);
  }
}
function changeVersion(next) {
  rememberPosition();
  if (mode === "changes") {
    path = steps2[step].file ?? Object.keys(steps2[step].changes ?? {})[0] ?? "";
    mode = "file";
  }
  version = next;
  focus = undefined;
  expandDiff = false;
  reconcileSelection();
  renderTree();
  renderTabs();
  updateLocation();
  renderCode();
}
function renderShell() {
  const repositoryName = manifest.repo.split(/[\\/]/).at(-1) ?? manifest.repo;
  root.innerHTML = `
    <a class="skip" href="#guide-title">Skip to walkthrough</a>
    <header class="topbar">
      <div class="repo-title"><strong>${escape(repositoryName)}</strong></div>
      <span class="page-title">${escape(lesson.title)}</span>
      <div class="layout-controls">
        <button type="button" data-action="files" aria-pressed="true">Files</button>
        <button type="button" data-action="guide" aria-pressed="true">Walkthrough</button>
      </div>
    </header>
    <div class="workspace">
      <aside class="files-pane" aria-label="Repository files">
        <div class="files-heading">
          <strong>Files</strong>
          <span id="file-count"></span>
        </div>
        <div class="snapshot-picker">
          <label for="version">Repository version</label>
          <select id="version">
            <option value="base">Before change</option>
            <option value="step">At this step</option>
            <option value="head">Final change</option>
          </select>
        </div>
        <div class="file-filters">
          <input
            id="filter"
            type="search"
            placeholder="Find a file…"
            aria-label="Filter repository files"
          />
          <label>
            <input type="checkbox" id="changed-only" />
            <span id="changed-label">Changed so far</span>
            <span id="changed-count"></span>
          </label>
        </div>
        <div class="file-tree" id="file-tree"></div>
        <div class="tree-foot" id="tree-foot"></div>
      </aside>
      <main class="code-pane" aria-label="Source code">
        <div class="tabs" id="tabs"></div>
        <div class="file-bar">
          <span id="file-path"></span>
          <button type="button" class="text-button" data-action="step-file" hidden>Open focused file</button>
        </div>
        <div class="code-toolbar">
          <div class="view-buttons">
            <button type="button" data-mode="file">Full file</button>
            <button type="button" data-mode="diff">${step === 0 ? "Changes" : "Step diff"}</button>
          </div>
          <a id="github-source" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <div class="version-note" id="version-note"></div>
        <nav class="change-nav" id="change-nav" aria-label="Changes introduced in this step" hidden></nav>
        <div class="code-body" id="code-body">
          <p class="loading">Loading source…</p>
        </div>
        <div class="code-status" id="code-status"></div>
      </main>
      <aside class="guide-pane" aria-label="Step-by-step walkthrough">
        <div class="guide-top">
          <div class="guide-heading">
            <button type="button" data-action="contents" aria-controls="lesson-contents" aria-expanded="false">☰ Contents</button>
            <button type="button" class="return-step" data-action="return" title="Restore this step’s starting view">↩ Return to step</button>
          </div>
          <div class="chapter-context">
            <div id="chapter-title"></div>
            <div id="chapter-progress"></div>
          </div>
          <div id="resume-notice" class="resume-notice" hidden>
            <span id="resume-message" role="status"></span>
            <button type="button" class="text-button" data-action="start-over">Start over</button>
            <button type="button" class="dismiss-notice" data-action="dismiss-resume" aria-label="Dismiss resume notice">×</button>
          </div>
        </div>
        <div class="guide-reading">
          <div class="guide-content" id="guide-content"></div>
          <nav class="lesson-contents" id="lesson-contents" aria-label="Walkthrough contents" hidden></nav>
        </div>
        <div class="guide-footer">
          <button type="button" data-action="back">← Back</button>
          <span id="step-count"></span>
          <button type="button" data-action="next">Next →</button>
          <span id="next-chapter" hidden></span>
        </div>
      </aside>
    </div>
    <div class="sr-only" id="announcement" aria-live="polite"></div>
  `;
  root.querySelector("#filter").addEventListener("input", (event) => {
    filter = event.target.value;
    renderTree();
  });
  root.querySelector("#changed-only").addEventListener("change", (event) => {
    onlyChanged = event.target.checked;
    renderTree();
  });
  root.querySelector("#version").addEventListener("change", (event) => {
    changeVersion(event.target.value);
  });
}
function renderTreeFile(node, indent) {
  const status = fileStatus(node.file, step, version);
  const selected = node.path === path;
  let title = escape(node.path);
  if (status) {
    const changeName = status === "A" ? "Added" : "Modified";
    const changeScope = version === "step" ? "so far" : "in change";
    title += ` · ${changeName} ${changeScope}`;
  }
  return `
    <button
      type="button"
      class="file-row ${selected ? "selected" : ""}"
      data-file="${escape(node.path)}"
      title="${title}"
      ${selected ? 'aria-current="true"' : ""}
    >
      ${indent}
      <span class="file-symbol" aria-hidden="true">▤</span>
      <span class="file-name">${escape(node.name)}</span>
      <span class="file-status ${status}">${status}</span>
    </button>
  `;
}
function compareTreeNodes(left, right) {
  const folderOrder = Number(Boolean(left.file)) - Number(Boolean(right.file));
  return folderOrder || left.name.localeCompare(right.name);
}
function renderTreeChildren(node, depth = 0) {
  const children = [...node.children.values()].sort(compareTreeNodes);
  const indent = '<span class="indent" aria-hidden="true"></span>'.repeat(depth);
  const rendered = [];
  for (const child of children) {
    if (child.file) {
      rendered.push(renderTreeFile(child, indent));
      continue;
    }
    const expanded = Boolean(filter) || openFolders.has(child.path);
    const descendants = expanded ? renderTreeChildren(child, depth + 1) : "";
    rendered.push(`
      <div class="folder">
        <button
          type="button"
          class="folder-row"
          data-folder="${escape(child.path)}"
          aria-expanded="${expanded}"
        >
          ${indent}
          <span class="chevron" aria-hidden="true">${expanded ? "⌄" : "›"}</span>
          <span>${escape(child.name)}</span>
        </button>
        ${descendants}
      </div>
    `);
  }
  return rendered.join("");
}
function renderTree() {
  const tree = { name: "", path: "", children: new Map };
  const available = manifest.files.filter((file) => fileExists(file, step, version));
  root.querySelector("#version").value = version;
  root.querySelector('#version option[value="step"]').textContent = `At this step (${step + 1})`;
  root.querySelector("#file-count").textContent = String(available.length);
  root.querySelector("#changed-count").textContent = String(available.filter((file) => fileStatus(file, step, version)).length);
  root.querySelector("#changed-label").textContent = version === "step" ? "Changed so far" : "Changed in change";
  let treeNote = "Files in the completed change";
  if (version === "step") {
    treeNote = `Files present at step ${step + 1}`;
  } else if (version === "base") {
    treeNote = "Files before this change";
  }
  root.querySelector("#tree-foot").textContent = treeNote;
  const changedCheckbox = root.querySelector("#changed-only");
  changedCheckbox.disabled = version === "base";
  if (version === "base") {
    onlyChanged = false;
    changedCheckbox.checked = false;
  }
  const matches = available.filter((file) => (!onlyChanged || fileStatus(file, step, version)) && file.path.toLowerCase().includes(filter.toLowerCase()));
  for (const file of matches) {
    let node = tree;
    const segments = file.path.split("/");
    segments.forEach((name, index) => {
      if (!node.children.has(name)) {
        node.children.set(name, {
          name,
          path: segments.slice(0, index + 1).join("/"),
          children: new Map
        });
      }
      node = node.children.get(name);
      if (index === segments.length - 1) {
        node.file = file;
      }
    });
  }
  root.querySelector("#file-tree").innerHTML = matches.length ? renderTreeChildren(tree) : '<p class="empty-tree">No matching files.</p>';
}
function renderTab(filePath) {
  const active = mode !== "changes" && filePath === path;
  const escapedPath = escape(filePath);
  const fileName = escape(filePath.split("/").at(-1));
  return `
    <div class="tab ${active ? "active" : ""}">
      <button
        type="button"
        class="tab-label"
        data-tab="${escapedPath}"
        title="${escapedPath}"
        ${active ? 'aria-current="page"' : ""}
      >${fileName}</button>
      <button
        type="button"
        class="tab-close"
        data-close-file="${escapedPath}"
        aria-label="Close ${fileName}"
        title="Close ${escapedPath}"
      >×</button>
    </div>
  `;
}
function renderTabs() {
  const overview = Object.keys(steps2[step].changes ?? {}).length ? `<div class="tab ${mode === "changes" ? "active" : ""}"><button type="button" class="tab-label" data-action="overview" ${mode === "changes" ? 'aria-current="page"' : ""}>This step’s changes</button></div>` : "";
  root.querySelector("#tabs").innerHTML = overview + tabs.filter((filePath) => existsInView(filePath) || filePath === path || readingMemory.file(steps2[step].id, filePath)).map(renderTab).join("");
}
async function closeTab(filePath) {
  rememberPosition();
  const visible = tabs.filter(existsInView);
  const visibleIndex = visible.indexOf(filePath);
  const index = tabs.indexOf(filePath);
  if (index < 0) {
    return;
  }
  tabs.splice(index, 1);
  readingMemory.forgetFile(filePath);
  if (filePath !== path || mode === "changes") {
    renderTabs();
    return;
  }
  renderedSource = "";
  const remaining = visible.filter((tab) => tab !== filePath);
  const adjacent = remaining[Math.min(visibleIndex, remaining.length - 1)];
  if (adjacent) {
    await openTab(adjacent, false);
  } else {
    path = "";
    mode = "file";
    focus = undefined;
    renderTabs();
    renderTree();
    updateLocation();
    await renderCode();
  }
  const active = root.querySelector('.tab-label[aria-current="page"]') ?? root.querySelector('#code-body [data-action="return"]');
  active?.focus({ preventScroll: true });
}
function renderPart(part) {
  if (typeof part === "string") {
    return renderInline(part);
  }
  const index = guideLinks.push(part) - 1;
  const range = part.start ? [part.start, part.end ?? part.start] : undefined;
  const hash = makeLocation(step, part.path, part.version ?? "step", range, part.view === "changes" ? "changes" : "file", part);
  const title = escape(part.path) + (part.version === "head" ? " · final change" : "");
  return `<a
    href="${escape(hash)}"
    data-source="${index}"
    title="${title}"
  >${renderInline(part.label)}</a>`;
}
function contentsStep(index) {
  return `<li><button type="button" data-step="${index}"
    ${index === step ? 'aria-current="step"' : ""}>
    <span class="contents-number">${index + 1}</span>
    <span>${escape(steps2[index].title)}</span>
  </button></li>`;
}
function renderContents() {
  const current = chapterAt(chapters, step);
  const outline = chapters.length ? chapters.map((chapter, index) => {
    const chapterSteps = Array.from({ length: chapter.end - chapter.start + 1 }, (_, offset) => contentsStep(chapter.start + offset)).join("");
    return `<details ${current?.id === chapter.id ? "open" : ""}>
          <summary><span>${index + 1}. ${escape(chapter.title)}</span>
            <small>${chapter.start === chapter.end ? `Step ${chapter.start + 1}` : `Steps ${chapter.start + 1}–${chapter.end + 1}`}</small>
          </summary>
          <button type="button" class="chapter-start" data-step="${chapter.start}"
            aria-label="Start chapter ${index + 1}: ${escape(chapter.title)}">Start chapter →</button>
          <ol>${chapterSteps}</ol>
        </details>`;
  }).join("") : `<ol>${steps2.map((_, index) => contentsStep(index)).join("")}</ol>`;
  root.querySelector("#lesson-contents").innerHTML = `
    <div class="contents-heading"><strong>Walkthrough contents</strong>
      <button type="button" class="text-button" data-action="start-over">Start over</button>
    </div>${outline}`;
}
function toggleContents(open = !contentsOpen) {
  const guide = root.querySelector("#guide-content");
  const outline = root.querySelector("#lesson-contents");
  if (open && !contentsOpen) {
    guideScrollTop = guide.scrollTop;
    renderContents();
  }
  contentsOpen = open;
  guide.hidden = open;
  outline.hidden = !open;
  const button = root.querySelector('[data-action="contents"]');
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "← Back to reading" : "☰ Contents";
  if (open) {
    const current = outline.querySelector('[aria-current="step"]');
    const chapterHeading = current?.closest("details")?.querySelector("summary");
    const target = chapterHeading ?? current;
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  } else {
    guide.scrollTop = guideScrollTop;
    button.focus({ preventScroll: true });
  }
}
function renderGuide() {
  if (contentsOpen) {
    toggleContents(false);
  }
  guideScrollTop = 0;
  guideLinks = [];
  const paragraphs = steps2[step].paragraphs.map((paragraph) => `<p>${paragraph.map(renderPart).join("")}</p>`).join("");
  root.querySelector("#guide-content").innerHTML = `
    <h1 id="guide-title">${escape(steps2[step].title)}</h1>
    ${paragraphs}
  `;
  root.querySelector("#guide-content").scrollTop = 0;
  const chapter = chapterAt(chapters, step);
  const chapterIndex = chapters.findIndex((item) => item === chapter);
  root.querySelector("#chapter-title").textContent = chapter ? `${chapterIndex + 1}. ${chapter.title}` : "Walkthrough";
  root.querySelector("#chapter-progress").textContent = chapter ? `Step ${step - chapter.start + 1} of ${chapter.end - chapter.start + 1} in this chapter · ${step + 1} of ${steps2.length} overall` : `Step ${step + 1} of ${steps2.length}`;
  root.querySelector("#step-count").textContent = `${step + 1} of ${steps2.length}`;
  root.querySelector('[data-action="back"]').disabled = step === 0;
  const next = root.querySelector('[data-action="next"]');
  const nextChapter = chapter && step === chapter.end ? chapters[chapterIndex + 1] : undefined;
  next.textContent = step === steps2.length - 1 ? "Start again" : nextChapter ? "Next chapter →" : "Next →";
  const transition = root.querySelector("#next-chapter");
  transition.hidden = !nextChapter;
  transition.textContent = nextChapter ? `Up next: ${nextChapter.title}` : "";
  root.querySelector("#announcement").textContent = `Step ${step + 1}: ${steps2[step].title}`;
}
function renderCodeRow(row, isDiff, filePath = path, selection = focus) {
  const selectedLine = row.next !== undefined && selection && row.next >= selection[0] && row.next <= selection[1];
  const lineAttribute = `${row.next ? `data-line="${row.next}"` : ""} ${row.old ? `data-old-line="${row.old}"` : ""}`;
  const oldNumber = isDiff ? `<span class="line-number old" aria-hidden="true">${row.old ?? ""}</span>` : "";
  let changeSign = "";
  if (row.kind === "add") {
    changeSign = "+";
  } else if (row.kind === "remove") {
    changeSign = "−";
  }
  return [
    `<div
      class="code-line ${row.kind} ${selectedLine ? "line-focus" : ""}"
      ${lineAttribute}
    >`,
    oldNumber,
    `<span class="line-number" aria-hidden="true">${row.next ?? ""}</span>`,
    `<span class="change-sign" aria-hidden="true">${changeSign}</span>`,
    `<code>${highlight(row.text, filePath) || " "}</code>`,
    "</div>"
  ].join("");
}
function renderDiffGap(lineCount) {
  return `<button
    type="button"
    class="diff-gap"
    data-action="expand-diff"
  >Show ${lineCount} unchanged lines</button>`;
}
function renderRows(rows, isDiff) {
  const contextRows = new Set;
  if (isDiff && !expandDiff) {
    for (let index = 0;index < rows.length; index++) {
      if (rows[index].kind === "same") {
        continue;
      }
      const firstContextRow = Math.max(0, index - 3);
      const lastContextRow = Math.min(rows.length - 1, index + 3);
      for (let contextIndex = firstContextRow;contextIndex <= lastContextRow; contextIndex++) {
        contextRows.add(contextIndex);
      }
    }
  }
  const selected = rows.flatMap((row, index) => !isDiff || expandDiff || contextRows.has(index) ? [{ row, index }] : []);
  if (!selected.length && isDiff) {
    return `<p class="code-message">No changes to this file in this step. <button
      type="button"
      class="text-button"
      data-mode="file"
    >Read the full file</button></p>`;
  }
  let html = "";
  let previousIndex = -1;
  for (const { row, index } of selected) {
    if (index > previousIndex + 1) {
      html += renderDiffGap(index - previousIndex - 1);
    }
    previousIndex = index;
    html += renderCodeRow(row, isDiff);
  }
  if (isDiff && previousIndex < rows.length - 1) {
    html += renderDiffGap(rows.length - previousIndex - 1);
  }
  return html;
}
function versionDescription() {
  if (version === "base") {
    return `Before change · ${manifest.base.slice(0, 12)}`;
  }
  if (version === "head") {
    return `Final change · ${manifest.head.slice(0, 12)}`;
  }
  return `At step ${step + 1} · ${steps2[step].title}`;
}
function renderFilePlaceholder(selectedFile) {
  const change = changeAt(path, step);
  const usesBaseline = version === "base" || version === "step" && change === undefined;
  const info = usesBaseline ? selectedFile?.base : selectedFile?.head;
  const absent = !selectedFile || !fileExists(selectedFile, step, version);
  let heading;
  if (absent) {
    heading = version === "step" ? "This file hasn’t been introduced yet." : "This file does not exist in this version.";
  } else if (info?.kind === "large") {
    heading = "This file is too large to display.";
  } else {
    heading = "This is a binary asset.";
  }
  let description = "Choose Final change to read the completed file.";
  if (!absent) {
    description = escape(path);
    if (info) {
      description += ` · ${(info.size / 1024).toFixed(1)} KB`;
    }
  }
  let finalFileButton = "";
  if (version !== "head" && selectedFile?.head) {
    finalFileButton = `
      <button type="button" data-action="final-file">View final change file</button>
    `;
  }
  return `
    <div class="file-placeholder">
      <h2>${heading}</h2>
      <p>${description}</p>
      ${finalFileButton}
    </div>
  `;
}
function fullFileRows(sourceLines2, comparisonRows) {
  const addedLines = new Set;
  if (version === "step") {
    for (const row of comparisonRows) {
      if (row.kind === "add" && row.next !== undefined) {
        addedLines.add(row.next);
      }
    }
  }
  return sourceLines2.map((text, index) => ({
    text,
    next: index + 1,
    kind: addedLines.has(index + 1) ? "add" : "same"
  }));
}
function coarseComparisonNote() {
  return '<p class="code-message">Some large sections are shown as complete replacements. All source lines are preserved; unchanged lines inside those sections may also be marked as removed and added.</p>';
}
function codeStatus(lineCount) {
  let status = `${lineCount} lines`;
  if (focus) {
    status += ` · Selected ${focus[0]}`;
    if (focus[1] > focus[0]) {
      status += `–${focus[1]}`;
    }
  }
  if (mode === "diff") {
    const comparison = version === "step" ? "previous step" : "change base";
    status += ` · Compared with ${comparison}`;
  }
  return status;
}
function regionLabel(rows) {
  const changed = rows.filter((row) => row.kind !== "same");
  const added = changed.flatMap((row) => row.next === undefined ? [] : [row.next]);
  const removed = changed.flatMap((row) => row.old === undefined ? [] : [row.old]);
  const context = rows.flatMap((row) => row.next === undefined ? [] : [row.next]);
  const numbers = added.length ? added : removed.length ? removed : context;
  const range = numbers.length > 1 ? `${numbers[0]}–${numbers.at(-1)}` : `${numbers[0]}`;
  return `${added.length ? "Lines" : removed.length ? "Removed lines" : "Context lines"} ${range}`;
}
function loadStepChanges(at) {
  const cached = stepChangesCache.get(at);
  if (cached) {
    return cached;
  }
  let retryable = false;
  const pending = (async () => {
    const paths = Object.keys(steps2[at].changes ?? {});
    let previous = [];
    if (at > 0 && paths.some((filePath) => Object.hasOwn(steps2[at - 1].changes ?? {}, filePath))) {
      const predecessor = await loadStepChanges(at - 1);
      previous = predecessor.files;
      retryable = predecessor.retryable;
    }
    return prepareStepChanges(paths, at, async (filePath, index) => ({
      exists: fileExists(files.get(filePath), index, "step"),
      text: await read(filePath, "step", index)
    }), steps2[at].paragraphs.flat().filter((part) => typeof part !== "string" && part.view === "changes"), previous);
  })().then((changes) => {
    retryable ||= changes.some((change) => change.failed);
    if (retryable) {
      stepChangesCache.delete(at);
    }
    const entries = changes.map((change, fileIndex) => {
      const filePath = change.path;
      const readingVersion = change.kind === "deleted" ? "base" : "step";
      const regions = [];
      let content = "";
      if (change.notice) {
        const retry = change.failed ? '<button type="button" data-action="retry">Retry</button>' : "";
        content = `<p class="code-message">${escape(change.notice)} ${retry}</p>`;
      } else {
        content = change.regions.map((region, regionIndex) => {
          const id = `change-${fileIndex}-${regionIndex}`;
          const label = regionLabel(region.rows);
          regions.push({ id, path: filePath, label });
          return `<section class="change-region" id="${id}" ${region.continued ? 'data-continued="true"' : ""} tabindex="-1" aria-label="${escape(filePath + ": " + label)}">
            <div class="region-heading">${escape(label)}</div>
            ${region.rows.map((row) => renderCodeRow(row, true, filePath, null)).join("")}
          </section>`;
        }).join("");
        if (change.coarse) {
          content = coarseComparisonNote() + content;
        }
      }
      const sectionId = `change-file-${fileIndex}`;
      if (!regions.length) {
        regions.push({ id: sectionId, path: filePath, label: "File change" });
      }
      return {
        regions,
        html: `<article class="change-file" id="${sectionId}" data-change-path="${escape(filePath)}" tabindex="-1">
        <header class="change-file-heading"><strong>${escape(filePath)}</strong>
          <button type="button" data-change-file="${escape(filePath)}" data-view="${readingVersion}">${change.kind === "deleted" ? "Before change" : "Full file"}</button>
        </header>${content}</article>`
      };
    });
    return {
      files: changes,
      retryable,
      html: entries.map((entry) => entry.html).join(""),
      regions: entries.flatMap((entry) => entry.regions)
    };
  }).catch((error) => {
    stepChangesCache.delete(at);
    throw error;
  });
  stepChangesCache.set(at, pending);
  return pending;
}
function renderChangeNavigation() {
  const nav = root.querySelector("#change-nav");
  nav.hidden = changeRegions.length === 0;
  const fileCount = new Set(changeRegions.map((region) => region.path)).size;
  nav.innerHTML = `<span class="change-summary">This step: ${fileCount} ${fileCount === 1 ? "file" : "files"} · ${changeRegions.length} ${changeRegions.length === 1 ? "region" : "regions"}</span>
    <div class="change-targets">${changeRegions.map((region, index) => `<button type="button" data-region="${index}" title="${escape(region.path + ": " + region.label)}">${escape(region.path.split("/").at(-1))} · ${escape(region.label)}</button>`).join("")}</div>`;
}
function revealFocus(body, animate = false) {
  if (!focus) {
    return;
  }
  const source = mode === "changes" ? changeArticle(path) : body;
  const selected = Array.from(source?.querySelectorAll("[data-line]") ?? []).filter((row) => {
    const line = Number(row.dataset.line);
    return line >= focus[0] && line <= focus[1];
  });
  const first = selected[0];
  const last = selected.at(-1);
  if (!first || !last) {
    return;
  }
  const inset = mode === "changes" ? source.querySelector(".change-file-heading").offsetHeight : 0;
  const bodyTop = body.getBoundingClientRect().top + body.clientTop;
  const top = first.getBoundingClientRect().top - bodyTop + body.scrollTop;
  const bottom = last.getBoundingClientRect().bottom - bodyTop + body.scrollTop;
  const destination = Math.max(0, focusScrollTop(body.scrollTop + inset, body.clientHeight - inset, top, bottom) - inset);
  if (animate) {
    cancelCodeScroll = animateScroll(body, destination, scheduleResumeSave);
  } else {
    body.scrollTop = destination;
  }
}
function changeArticle(filePath) {
  return Array.from(root.querySelectorAll("[data-change-path]")).find((article) => article.dataset.changePath === filePath);
}
function markOverviewFocus() {
  root.querySelectorAll("#code-body .line-focus").forEach((line) => line.classList.remove("line-focus"));
  if (!focus || !path) {
    return;
  }
  changeArticle(path)?.querySelectorAll("[data-line]").forEach((line) => {
    const number = Number(line.dataset.line);
    line.classList.toggle("line-focus", number >= focus[0] && number <= focus[1]);
  });
}
function captureContinuation(backward) {
  const body = root.querySelector("#code-body");
  const bounds = body.getBoundingClientRect();
  const candidates = [];
  for (const article of body.querySelectorAll("[data-change-path]")) {
    const inset = article.querySelector(".change-file-heading").offsetHeight;
    const selector = backward ? "[data-continued] .code-line.same[data-old-line]" : ".code-line[data-line]";
    const visibleTop = bounds.top + inset;
    for (const row of article.querySelectorAll(selector)) {
      const rect = row.getBoundingClientRect();
      const visible = rect.top >= visibleTop && rect.top < bounds.bottom;
      if (backward || visible) {
        let priority = 0;
        if (!visible) {
          priority = rect.top < visibleTop ? 1 : 2;
        }
        candidates.push({
          anchor: {
            path: article.dataset.changePath,
            line: Number(backward ? row.dataset.oldLine : row.dataset.line),
            screenTop: rect.top
          },
          priority,
          distance: Math.abs(rect.top - visibleTop)
        });
      }
    }
  }
  if (backward) {
    candidates.sort((left, right) => left.priority - right.priority || left.distance - right.distance);
  }
  const anchors = candidates.map((candidate) => candidate.anchor);
  return { anchors, scrollLeft: body.scrollLeft, backward };
}
function revealContinuation(body, previous) {
  const backward = previous?.backward === true;
  let target = backward ? null : body.querySelector('[data-continued="true"]');
  if (!backward && !target) {
    return;
  }
  let space;
  for (const anchor of previous?.anchors ?? []) {
    const article2 = changeArticle(anchor.path);
    const row = article2?.querySelector(backward ? `.change-region .code-line[data-line="${anchor.line}"]` : `[data-continued] .code-line.same[data-old-line="${anchor.line}"]`);
    if (row) {
      const anchoredTop = Math.max(0, body.scrollTop + row.getBoundingClientRect().top - anchor.screenTop);
      if (backward) {
        space = reserveScrollSpace(body, anchoredTop);
      }
      body.scrollTop = anchoredTop;
      target = row.closest(".change-region");
      break;
    }
  }
  if (!target) {
    return;
  }
  if (previous) {
    body.scrollLeft = previous.scrollLeft;
  }
  const edits = target.querySelectorAll(".code-line.add, .code-line.remove");
  const first = edits[0];
  const last = edits[edits.length - 1];
  if (!first || !last) {
    space?.dispose();
    return;
  }
  const article = target.closest(".change-file");
  const inset = article.querySelector(".change-file-heading").offsetHeight;
  const bodyTop = body.getBoundingClientRect().top + body.clientTop;
  const top = first.getBoundingClientRect().top - bodyTop + body.scrollTop;
  const bottom = last.getBoundingClientRect().bottom - bodyTop + body.scrollTop;
  const bottomContext = 2 * Number.parseFloat(getComputedStyle(last).lineHeight);
  let destination = Math.max(0, minimalRevealScrollTop(body.scrollTop + inset, body.clientHeight - inset, top, bottom, bottomContext) - inset);
  if (space) {
    destination = Math.min(destination, space.maxScrollTop);
  }
  if (previous) {
    const finish = () => {
      space?.release();
      scheduleResumeSave();
    };
    const cancel = animateScroll(body, destination, finish, () => space?.release());
    cancelCodeScroll = () => {
      cancel();
      space?.dispose();
    };
  } else {
    body.scrollTop = destination;
  }
}
async function renderCode(position = {}) {
  cancelCodeScroll?.();
  cancelCodeScroll = undefined;
  const ticket = ++requestId;
  const body = root.querySelector("#code-body");
  const sourceKey = sourceIdentity();
  const animateFocus = renderedSource === sourceKey;
  const savedScroll = position.scrollTop ?? (renderedSource === sourceKey ? body.scrollTop : 0);
  const savedHorizontal = position.scrollLeft ?? (renderedSource === sourceKey ? body.scrollLeft : 0);
  const overview = mode === "changes";
  root.querySelector('[data-action="step-file"]').hidden = !overview || !steps2[step].file;
  root.querySelector(".code-pane").classList.toggle("no-file", !path && !overview);
  root.querySelector(".code-pane").classList.toggle("show-changes", overview);
  root.querySelector("#version").value = version;
  root.querySelector("#code-status").textContent = "";
  if (!path && !overview) {
    body.innerHTML = '<p class="code-message">Open a source reference or choose a file to explore.</p>';
    changeRegions = [];
    renderChangeNavigation();
    renderedSource = sourceKey;
    scheduleResumeSave();
    return;
  }
  const selectedFile = files.get(path);
  root.querySelector("#file-path").textContent = overview ? "Changes introduced in this step" : path;
  root.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  root.querySelector('[data-mode="diff"]').textContent = version === "step" ? "Step diff" : "Change diff";
  root.querySelector("#version-note").textContent = versionDescription();
  const github = root.querySelector("#github-source");
  github.hidden = !manifest.sourceUrl;
  if (manifest.sourceUrl) {
    github.href = manifest.sourceUrl;
  }
  github.textContent = "Change source ↗";
  if (renderedSource !== sourceKey && !position.continuation) {
    body.innerHTML = '<p class="loading">Loading source…</p>';
  }
  try {
    const pendingChanges = loadStepChanges(step);
    if (overview) {
      const changes = await pendingChanges;
      if (ticket !== requestId) {
        return;
      }
      changeRegions = changes.regions;
      renderChangeNavigation();
      body.innerHTML = changes.html;
      markOverviewFocus();
      body.scrollTop = savedScroll;
      body.scrollLeft = savedHorizontal;
      renderedSource = sourceKey;
      const renderedLines = Array.from(changeArticle(path)?.querySelectorAll("[data-line]") ?? [], (row) => Number(row.dataset.line));
      if (focus && path && !isFocusRendered(focus, renderedLines)) {
        readingMemory.save(steps2[step].id, {
          path: "",
          version: "step",
          mode: "changes",
          scrollTop: savedScroll,
          scrollLeft: savedHorizontal,
          expandDiff: false
        });
        mode = "file";
        expandDiff = false;
        reconcileSelection();
        renderTree();
        renderTabs();
        history.replaceState(null, "", makeLocation(step, path, version, focus, mode));
        await renderCode();
        return;
      }
      root.querySelector("#code-status").textContent = "All changes in this step · Compared with the preceding state" + (focus && path ? ` · Selected ${path}:${focus[0]}–${focus[1]}` : "");
      if (position.reveal !== false) {
        if (focus) {
          revealFocus(body, animateFocus);
        } else {
          revealContinuation(body, position.continuation);
        }
      }
      return;
    }
    pendingChanges.then((changes) => {
      if (ticket === requestId) {
        changeRegions = changes.regions;
        renderChangeNavigation();
      }
    }).catch(() => {});
    const currentText = await read(path, version);
    if (ticket !== requestId) {
      return;
    }
    const deletedDiff = mode === "diff" && selectedFile && !fileExists(selectedFile, step, version);
    if (currentText === undefined && !deletedDiff) {
      body.innerHTML = renderFilePlaceholder(selectedFile);
      renderedSource = sourceKey;
      return;
    }
    let previous;
    if (version === "step" && step > 0) {
      previous = await read(path, "step", step - 1);
    } else {
      previous = await read(path, "base");
    }
    if (ticket !== requestId) {
      return;
    }
    const sourceLines2 = (currentText ?? "").split(`
`);
    let comparison = { rows: [], coarse: false };
    let comparisonUnavailable = false;
    if (mode === "diff" || version === "step") {
      try {
        comparison = compareLines(previous ?? "", currentText ?? "");
      } catch (error) {
        if (mode === "diff") {
          throw error;
        }
        comparisonUnavailable = true;
      }
    }
    let rows;
    if (mode === "diff") {
      rows = comparison.rows;
    } else {
      rows = fullFileRows(sourceLines2, comparison.rows);
    }
    let comparisonNote = comparison.coarse ? coarseComparisonNote() : "";
    if (comparisonUnavailable) {
      comparisonNote = '<p class="code-message">Change highlighting is unavailable. The captured source is shown below.</p>';
    }
    body.innerHTML = comparisonNote + renderRows(rows, mode === "diff");
    root.querySelector("#code-status").textContent = codeStatus(sourceLines2.length);
    body.scrollTop = savedScroll;
    body.scrollLeft = savedHorizontal;
    renderedSource = sourceKey;
    requestAnimationFrame(() => {
      if (ticket !== requestId) {
        return;
      }
      if (position.reveal !== false) {
        revealFocus(body, animateFocus);
      }
    });
  } catch (error) {
    if (ticket !== requestId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    body.innerHTML = `<p class="code-message" role="alert">${escape(message)} <button
      type="button"
      class="text-button"
      data-action="retry"
    >Retry</button></p>`;
  } finally {
    if (ticket === requestId) {
      scheduleResumeSave();
    }
  }
}
async function openFile(filePath, target, record = true) {
  rememberPosition();
  path = filePath;
  if (target) {
    version = target.version ?? "step";
  }
  mode = "file";
  focus = undefined;
  expandDiff = false;
  reconcileSelection();
  const selectedFile = files.get(path);
  if (onlyChanged && (!selectedFile || !fileStatus(selectedFile, step, version))) {
    onlyChanged = false;
    root.querySelector("#changed-only").checked = false;
  }
  renderTree();
  renderTabs();
  if (target) {
    const pending = ++requestId;
    try {
      const text = await read(path, version);
      if (pending !== requestId) {
        return;
      }
      if (text !== undefined) {
        focus = resolveFocus(text, target);
      }
    } catch {}
    if (pending !== requestId) {
      return;
    }
  }
  if (record) {
    updateLocation();
  }
  await renderCode();
}
async function openTab(filePath, remember = true) {
  if (remember) {
    rememberPosition();
  }
  const position = readingMemory.file(steps2[step].id, filePath);
  if (!position) {
    await openFile(filePath);
    return;
  }
  applyPosition(position);
  reconcileSelection();
  renderTree();
  renderTabs();
  updateLocation();
  await renderCode({ ...position, reveal: false });
}
async function openOverview() {
  rememberPosition();
  const position = readingMemory.overview(steps2[step].id);
  if (position) {
    applyPosition(position);
  } else {
    path = "";
    version = "step";
    mode = "changes";
    focus = undefined;
    expandDiff = false;
  }
  renderTree();
  renderTabs();
  updateLocation();
  await renderCode({ ...position, reveal: false });
}
async function openPointer(target) {
  if (target.view !== "changes") {
    await openFile(target.path, target);
    return;
  }
  rememberPosition();
  path = target.path;
  version = "step";
  mode = "changes";
  focus = undefined;
  expandDiff = false;
  const pending = ++requestId;
  try {
    const text = await read(path, "step");
    if (pending !== requestId) {
      return;
    }
    if (text !== undefined) {
      focus = resolveFocus(text, target);
    }
  } catch {}
  if (pending !== requestId) {
    return;
  }
  renderTree();
  renderTabs();
  updateLocation();
  await renderCode();
}
async function openFullFile(button) {
  const filePath = button.dataset.changeFile;
  const selectedVersion = button.dataset.view;
  const article = changeArticle(filePath);
  const body = root.querySelector("#code-body");
  const header = article?.querySelector(".change-file-heading");
  const visibleTop = Math.max(body.getBoundingClientRect().top, header?.getBoundingClientRect().bottom ?? 0);
  const visibleBottom = body.getBoundingClientRect().bottom;
  const visibleRows = Array.from(article?.querySelectorAll(".code-line[data-line]") ?? []).filter((row) => row.getBoundingClientRect().bottom > visibleTop && row.getBoundingClientRect().top < visibleBottom);
  const first = visibleRows.find((row) => row.classList.contains("add")) ?? visibleRows[0];
  const line = selectedVersion === "step" && first ? Number(first.dataset.line) : undefined;
  const targetFocus = fullFileFocus(filePath, selectedVersion, line, { path, version, focus });
  await openFile(filePath, {
    label: "",
    path: filePath,
    version: selectedVersion,
    start: targetFocus?.[0],
    end: targetFocus?.[1]
  });
}
async function goStep(index, record = true) {
  cancelCodeScroll?.();
  cancelCodeScroll = undefined;
  const continuation = Math.abs(index - step) === 1 && mode === "changes" && renderedSource === sourceIdentity() ? captureContinuation(index < step) : undefined;
  rememberPosition();
  root.querySelector("#resume-notice").hidden = true;
  step = Math.max(0, Math.min(steps2.length - 1, index));
  renderedSource = "";
  const choice = defaultSelection(steps2[step]);
  version = choice.version;
  if (!continuation) {
    changeRegions = [];
    renderChangeNavigation();
  }
  renderGuide();
  if (choice.mode === "changes" || !choice.path) {
    path = "";
    mode = choice.mode;
    focus = undefined;
    expandDiff = false;
    renderTree();
    renderTabs();
    if (record) {
      updateLocation();
    }
    await renderCode({ continuation });
  } else {
    await openFile(choice.path, {
      label: "",
      path: choice.path,
      version: choice.version,
      symbol: steps2[step].symbol,
      count: steps2[step].count,
      start: steps2[step].focus?.[0],
      end: steps2[step].focus?.[1]
    }, record);
  }
  if (!initialRender) {
    const heading = root.querySelector("#guide-title");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  initialRender = false;
}
async function startOver() {
  clearTimeout(saveTimer);
  if (resumeStorage) {
    clearResume(resumeStorage, resumeKey);
  }
  root.querySelector("#resume-notice").hidden = true;
  tabs.length = 0;
  readingMemory.clear();
  renderedSource = "";
  await goStep(0);
  persistResume();
}
async function openRegion(index) {
  const region = changeRegions[index];
  if (!region) {
    return;
  }
  const at = step;
  const animate = mode === "changes" && renderedSource === sourceIdentity();
  if (mode !== "changes") {
    const pending = openOverview();
    const ticket = requestId;
    await pending;
    if (ticket !== requestId) {
      return;
    }
  }
  if (step !== at || mode !== "changes") {
    return;
  }
  const body = root.querySelector("#code-body");
  focus = undefined;
  path = "";
  markOverviewFocus();
  updateLocation();
  const target = document.getElementById(region.id);
  if (target) {
    const inset = target.closest(".change-file")?.querySelector(".change-file-heading")?.offsetHeight ?? 0;
    const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const destination = Math.max(0, focusScrollTop(body.scrollTop + inset, body.clientHeight - inset, top, top + target.offsetHeight) - inset);
    if (animate) {
      cancelCodeScroll = animateScroll(body, destination, scheduleResumeSave);
    } else {
      body.scrollTop = destination;
    }
    target.focus({ preventScroll: true });
  }
}
function handleClick(event) {
  const element = event.target.closest("button, a[data-source]");
  if (!element || element.disabled) {
    return;
  }
  cancelCodeScroll?.();
  cancelCodeScroll = undefined;
  if (element.dataset.step !== undefined) {
    goStep(Number(element.dataset.step));
    return;
  }
  if (element.dataset.closeFile) {
    closeTab(element.dataset.closeFile);
    return;
  }
  if (element.dataset.region !== undefined) {
    openRegion(Number(element.dataset.region));
    return;
  }
  if (element.dataset.changeFile) {
    openFullFile(element);
    return;
  }
  if (element.dataset.source !== undefined) {
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    const link = guideLinks[Number(element.dataset.source)];
    openPointer(link);
    return;
  }
  if (element.dataset.tab) {
    openTab(element.dataset.tab);
    return;
  }
  if (element.dataset.file) {
    openFile(element.dataset.file);
    return;
  }
  if (element.dataset.folder) {
    const folder = element.dataset.folder;
    if (openFolders.has(folder)) {
      openFolders.delete(folder);
    } else {
      openFolders.add(folder);
    }
    renderTree();
    return;
  }
  if (element.dataset.mode) {
    rememberPosition();
    mode = element.dataset.mode;
    expandDiff = false;
    updateLocation();
    renderTabs();
    renderCode();
    return;
  }
  switch (element.dataset.action) {
    case "contents":
      toggleContents();
      break;
    case "start-over":
      startOver();
      break;
    case "dismiss-resume":
      root.querySelector("#resume-notice").hidden = true;
      break;
    case "next":
      if (step === steps2.length - 1) {
        startOver();
      } else {
        goStep(step + 1);
      }
      break;
    case "back":
      goStep(step - 1);
      break;
    case "return":
      goStep(step);
      break;
    case "overview":
      openOverview();
      break;
    case "step-file": {
      const target = steps2[step];
      if (target.file) {
        openFile(target.file, {
          label: "",
          path: target.file,
          version: target.version ?? "step",
          start: target.focus?.[0],
          end: target.focus?.[1],
          symbol: target.symbol,
          count: target.count
        });
      }
      break;
    }
    case "final-file":
      changeVersion("head");
      break;
    case "expand-diff":
      expandDiff = true;
      renderCode();
      break;
    case "retry":
      renderCode();
      break;
    case "files":
      persistResume();
      showFiles = !showFiles;
      root.classList.toggle("hide-files", !showFiles);
      element.setAttribute("aria-pressed", String(showFiles));
      scheduleResumeSave();
      break;
    case "guide":
      persistResume();
      showGuide = !showGuide;
      root.classList.toggle("hide-guide", !showGuide);
      element.setAttribute("aria-pressed", String(showGuide));
      if (showGuide && !contentsOpen) {
        root.querySelector("#guide-content").scrollTop = guideScrollTop;
      }
      scheduleResumeSave();
      break;
  }
}
async function resolveLocationAnchor(target) {
  const pending = ++requestId;
  if (focus || !path || !target.symbol) {
    return true;
  }
  try {
    const text = await read(path, version);
    if (pending !== requestId) {
      return false;
    }
    if (text !== undefined) {
      focus = resolveFocus(text, target);
    }
  } catch {}
  return pending === requestId;
}
async function restoreLocation() {
  if (!manifest) {
    return;
  }
  root.querySelector("#resume-notice").hidden = true;
  const state = parseLocation(location.hash);
  rememberPosition();
  step = state.step;
  if (state.path === undefined && state.mode === undefined) {
    await goStep(step, false);
    history.replaceState(null, "", makeLocation(step, path, version, focus, mode));
    return;
  }
  const choice = defaultSelection(steps2[step]);
  if (state.path === "" || state.path && files.has(state.path)) {
    path = state.path;
  } else {
    path = choice.path;
  }
  version = state.version ?? choice.version;
  focus = state.focus;
  mode = state.mode ?? (state.path === undefined ? choice.mode : "file");
  if (mode === "changes") {
    version = "step";
  }
  changeRegions = [];
  renderChangeNavigation();
  reconcileSelection();
  renderTree();
  renderTabs();
  renderGuide();
  if (await resolveLocationAnchor(state)) {
    await renderCode();
    history.replaceState(null, "", makeLocation(step, path, version, focus, mode));
  }
}
async function initialize() {
  const response = await fetch("/manifest.json");
  if (!response.ok) {
    throw new Error(`Could not load the repository snapshot (${response.status}).`);
  }
  manifest = await response.json();
  const lessonResponse = await fetch("/lesson.json");
  if (!lessonResponse.ok) {
    throw new Error("Could not load lesson.json.");
  }
  lesson = await lessonResponse.json();
  if (lesson.schemaVersion !== 1 || manifest.schemaVersion !== 1 || !lesson.steps.length) {
    throw new Error("Unsupported or empty walkthrough. Run the validator.");
  }
  steps2 = lesson.steps;
  chapters = chapterRanges(lesson);
  configureLesson(steps2);
  document.title = lesson.title + " · Code walkthrough";
  files = new Map(manifest.files.map((file) => [file.path, file]));
  try {
    resumeKey = await resumeStorageKey(manifest, lesson);
    resumeStorage = window.localStorage;
  } catch {}
  const saved = resumeStorage ? loadResume(resumeStorage, resumeKey, lesson, new Set(files.keys())) : undefined;
  const savedStep = saved ? steps2.findIndex((item) => item.id === saved.stepId) : 0;
  const savedHash = saved ? makeLocation(savedStep, saved.position.path, saved.position.version, saved.position.focus, saved.position.mode) : "";
  const navigation = performance.getEntriesByType("navigation")[0];
  const resumed = saved && shouldResume(location.hash, savedHash, navigation?.type) ? saved : undefined;
  const initial = parseLocation(location.hash);
  step = initial.step;
  const choice = defaultSelection(steps2[step]);
  path = initial.path ?? choice.path;
  version = initial.version ?? choice.version;
  focus = initial.focus;
  mode = initial.mode ?? (initial.path === undefined ? choice.mode : "file");
  if (path && !files.has(path)) {
    path = choice.path;
  }
  if (mode === "changes") {
    version = "step";
  }
  if (resumed) {
    step = savedStep;
    applyPosition(resumed.position);
    tabs.push(...resumed.tabs);
    for (const position of resumed.positions) {
      readingMemory.save(resumed.stepId, position);
    }
    showFiles = resumed.showFiles;
    showGuide = resumed.showGuide;
  }
  reconcileSelection();
  renderShell();
  renderTree();
  renderTabs();
  renderGuide();
  root.classList.toggle("hide-files", !showFiles);
  root.classList.toggle("hide-guide", !showGuide);
  root.querySelector('[data-action="files"]').setAttribute("aria-pressed", String(showFiles));
  root.querySelector('[data-action="guide"]').setAttribute("aria-pressed", String(showGuide));
  if (resumed) {
    root.querySelector("#resume-notice").hidden = false;
    root.querySelector("#resume-message").textContent = `Resumed at step ${step + 1}`;
    guideScrollTop = resumed.guideScrollTop;
    root.querySelector("#guide-content").scrollTop = guideScrollTop;
    history.replaceState(null, "", savedHash);
    await renderCode({ ...resumed.position, reveal: false });
    initialRender = false;
  } else if (initial.path !== undefined || initial.mode !== undefined) {
    if (await resolveLocationAnchor(initial)) {
      await renderCode();
    }
  } else {
    await goStep(step, false);
  }
  history.replaceState(null, "", makeLocation(step, path, version, focus, mode));
  resumeReady = true;
  scheduleResumeSave();
}
root.addEventListener("click", handleClick);
root.addEventListener("click", scheduleResumeSave);
root.addEventListener("scroll", scheduleResumeSave, true);
root.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && contentsOpen) {
    toggleContents(false);
  }
});
window.addEventListener("pagehide", persistResume);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    persistResume();
  }
});
window.addEventListener("hashchange", () => {
  restoreLocation();
});
try {
  await initialize();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<p
    class="code-message"
    role="alert"
  >${escape(message)} Refresh to try again.</p>`;
}
