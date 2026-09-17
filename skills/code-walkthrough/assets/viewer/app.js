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
function diffLines(before, after) {
  const beforeLines = normalize(before).replace(/\n$/, "").split(`
`);
  const afterLines = normalize(after).replace(/\n$/, "").split(`
`);
  if (!before) {
    beforeLines.length = 0;
  }
  if (!after) {
    afterLines.length = 0;
  }
  let prefixLength = 0;
  while (prefixLength < beforeLines.length && prefixLength < afterLines.length && beforeLines[prefixLength] === afterLines[prefixLength]) {
    prefixLength++;
  }
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (beforeEnd > prefixLength && afterEnd > prefixLength && beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  const beforeLength = beforeEnd - prefixLength;
  const afterLength = afterEnd - prefixLength;
  if (beforeLength * afterLength > 3000000) {
    throw new RangeError("This diff is too large for an inline comparison. Use Full file to read either version.");
  }
  const width = afterLength + 1;
  const table = new Uint32Array((beforeLength + 1) * width);
  for (let beforeIndex2 = beforeLength - 1;beforeIndex2 >= 0; beforeIndex2--) {
    for (let afterIndex2 = afterLength - 1;afterIndex2 >= 0; afterIndex2--) {
      const cell = beforeIndex2 * width + afterIndex2;
      if (beforeLines[prefixLength + beforeIndex2] === afterLines[prefixLength + afterIndex2]) {
        table[cell] = table[(beforeIndex2 + 1) * width + afterIndex2 + 1] + 1;
      } else {
        const skipBefore = table[(beforeIndex2 + 1) * width + afterIndex2];
        const skipAfter = table[beforeIndex2 * width + afterIndex2 + 1];
        table[cell] = Math.max(skipBefore, skipAfter);
      }
    }
  }
  const result = [];
  for (let index = 0;index < prefixLength; index++) {
    result.push({ kind: "same", text: beforeLines[index], old: index + 1, next: index + 1 });
  }
  let beforeIndex = prefixLength;
  let afterIndex = prefixLength;
  while (beforeIndex < beforeEnd || afterIndex < afterEnd) {
    const hasBefore = beforeIndex < beforeEnd;
    const hasAfter = afterIndex < afterEnd;
    const tableBefore = beforeIndex - prefixLength;
    const tableAfter = afterIndex - prefixLength;
    if (hasBefore && hasAfter && beforeLines[beforeIndex] === afterLines[afterIndex]) {
      result.push({
        kind: "same",
        text: beforeLines[beforeIndex],
        old: beforeIndex + 1,
        next: afterIndex + 1
      });
      beforeIndex++;
      afterIndex++;
    } else if (hasAfter && (!hasBefore || table[tableBefore * width + tableAfter + 1] > table[(tableBefore + 1) * width + tableAfter])) {
      result.push({ kind: "add", text: afterLines[afterIndex], next: afterIndex + 1 });
      afterIndex++;
    } else {
      result.push({ kind: "remove", text: beforeLines[beforeIndex], old: beforeIndex + 1 });
      beforeIndex++;
    }
  }
  while (beforeIndex < beforeLines.length) {
    result.push({
      kind: "same",
      text: beforeLines[beforeIndex],
      old: beforeIndex + 1,
      next: afterIndex + 1
    });
    beforeIndex++;
    afterIndex++;
  }
  return result;
}
function defaultSelection(step) {
  if (Object.keys(step.changes ?? {}).length > 0) {
    return { path: "", version: "step", mode: "changes" };
  }
  return { path: step.file ?? "", version: step.version ?? "step", mode: "file" };
}

// viewer/src/changes.ts
function changeKind(previous, current) {
  if (!previous.exists && current.exists) {
    return "added";
  }
  if (previous.exists && !current.exists) {
    return "deleted";
  }
  return "modified";
}
async function prepareFileChange(path, at, readState, pointers) {
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
    const rows = diffLines(previousText, currentText);
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
    if (!change.regions.length) {
      change.notice = "No visible line differences. File bytes or metadata may have changed.";
    }
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    change.notice = error.message;
  }
  return change;
}
function prepareStepChanges(paths, at, readState, pointers = []) {
  return Promise.all(paths.map((path) => prepareFileChange(path, at, readState, pointers)));
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
class ReadingMemory {
  positions = new Map;
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
  const stepOptions = steps2.map((item, index) => `<option value="${index}">${index + 1}. ${escape(item.title)}</option>`).join("");
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
          <div class="guide-heading"><span>Walkthrough</span>
            <button type="button" class="return-step" data-action="return" title="Restore this step’s starting view">↩ Return to step</button>
          </div>
          <label>
            <span class="sr-only">Choose a step</span>
            <select id="step-select">${stepOptions}</select>
          </label>
        </div>
        <div class="guide-content" id="guide-content"></div>
        <div class="guide-footer">
          <button type="button" data-action="back">← Back</button>
          <span id="step-count"></span>
          <button type="button" data-action="next">Next →</button>
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
  root.querySelector("#step-select").addEventListener("change", (event) => {
    goStep(Number(event.target.value));
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
function renderGuide() {
  guideLinks = [];
  const paragraphs = steps2[step].paragraphs.map((paragraph) => `<p>${paragraph.map(renderPart).join("")}</p>`).join("");
  root.querySelector("#guide-content").innerHTML = `
    <h1 id="guide-title">${escape(steps2[step].title)}</h1>
    ${paragraphs}
  `;
  root.querySelector("#guide-content").scrollTop = 0;
  root.querySelector("#step-select").value = String(step);
  root.querySelector("#step-count").textContent = `${step + 1} of ${steps2.length}`;
  root.querySelector('[data-action="back"]').disabled = step === 0;
  const next = root.querySelector('[data-action="next"]');
  next.textContent = step === steps2.length - 1 ? "Start again" : "Next →";
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
function fullFileRows(sourceLines, previous, current) {
  let addedLines = new Set;
  if (version === "step") {
    try {
      addedLines = new Set(diffLines(previous, current).filter((row) => row.kind === "add").map((row) => row.next));
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
    }
  }
  return sourceLines.map((text, index) => ({
    text,
    next: index + 1,
    kind: addedLines.has(index + 1) ? "add" : "same"
  }));
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
  const pending = prepareStepChanges(Object.keys(steps2[at].changes ?? {}), at, async (filePath, index) => ({
    exists: fileExists(files.get(filePath), index, "step"),
    text: await read(filePath, "step", index)
  }), steps2[at].paragraphs.flat().filter((part) => typeof part !== "string" && part.view === "changes")).then((changes) => {
    if (changes.some((change) => change.failed)) {
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
          return `<section class="change-region" id="${id}" tabindex="-1" aria-label="${escape(filePath + ": " + label)}">
            <div class="region-heading">${escape(label)}</div>
            ${region.rows.map((row) => renderCodeRow(row, true, filePath, null)).join("")}
          </section>`;
        }).join("");
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
function revealFocus(body) {
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
  body.scrollTop = Math.max(0, focusScrollTop(body.scrollTop + inset, body.clientHeight - inset, top, bottom) - inset);
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
async function renderCode(position = {}) {
  const ticket = ++requestId;
  const body = root.querySelector("#code-body");
  const sourceKey = sourceIdentity();
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
  if (renderedSource !== sourceKey) {
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
      root.querySelector("#code-status").textContent = "All changes in this step · Compared with the preceding state" + (focus && path ? ` · Selected ${path}:${focus[0]}–${focus[1]}` : "");
      if (position.reveal !== false) {
        revealFocus(body);
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
    const sourceLines = (currentText ?? "").split(`
`);
    let rows;
    if (mode === "diff") {
      rows = diffLines(previous ?? "", currentText ?? "");
    } else {
      rows = fullFileRows(sourceLines, previous ?? "", currentText ?? "");
    }
    body.innerHTML = renderRows(rows, mode === "diff");
    root.querySelector("#code-status").textContent = codeStatus(sourceLines.length);
    body.scrollTop = savedScroll;
    body.scrollLeft = savedHorizontal;
    renderedSource = sourceKey;
    requestAnimationFrame(() => {
      if (ticket !== requestId) {
        return;
      }
      if (position.reveal !== false) {
        revealFocus(body);
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
  await openFile(filePath, {
    label: "",
    path: filePath,
    version: selectedVersion,
    start: line
  });
}
async function goStep(index, record = true) {
  rememberPosition();
  step = Math.max(0, Math.min(steps2.length - 1, index));
  renderedSource = "";
  const choice = defaultSelection(steps2[step]);
  version = choice.version;
  changeRegions = [];
  renderChangeNavigation();
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
    await renderCode();
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
async function openRegion(index) {
  const region = changeRegions[index];
  if (!region) {
    return;
  }
  const at = step;
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
    body.scrollTop = Math.max(0, focusScrollTop(body.scrollTop + inset, body.clientHeight - inset, top, top + target.offsetHeight) - inset);
    target.focus({ preventScroll: true });
  }
}
function handleClick(event) {
  const element = event.target.closest("button, a[data-source]");
  if (!element || element.disabled) {
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
    case "next":
      goStep(step === steps2.length - 1 ? 0 : step + 1);
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
      showFiles = !showFiles;
      root.classList.toggle("hide-files", !showFiles);
      element.setAttribute("aria-pressed", String(showFiles));
      break;
    case "guide":
      showGuide = !showGuide;
      root.classList.toggle("hide-guide", !showGuide);
      element.setAttribute("aria-pressed", String(showGuide));
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
  const state = parseLocation(location.hash);
  rememberPosition();
  step = state.step;
  if (state.path === undefined && state.mode === undefined) {
    goStep(step, false);
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
  configureLesson(steps2);
  document.title = lesson.title + " · Code walkthrough";
  const initial = parseLocation(location.hash);
  step = initial.step;
  const choice = defaultSelection(steps2[step]);
  path = initial.path ?? choice.path;
  version = initial.version ?? choice.version;
  focus = initial.focus;
  mode = initial.mode ?? (initial.path === undefined ? choice.mode : "file");
  files = new Map(manifest.files.map((file) => [file.path, file]));
  if (path && !files.has(path)) {
    path = choice.path;
  }
  if (mode === "changes") {
    version = "step";
  }
  reconcileSelection();
  renderShell();
  renderTree();
  renderTabs();
  renderGuide();
  root.classList.toggle("hide-files", !showFiles);
  root.querySelector('[data-action="files"]').setAttribute("aria-pressed", String(showFiles));
  if (initial.path !== undefined || initial.mode !== undefined) {
    if (await resolveLocationAnchor(initial)) {
      await renderCode();
    }
  } else {
    await goStep(step, false);
  }
}
root.addEventListener("click", handleClick);
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
