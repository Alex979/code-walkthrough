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
function sourceAtStep(path, index, before, after) {
  const change = changeAt(path, index);
  let source;
  if (change === null) {
    return;
  }
  if (change === undefined) {
    source = before;
  } else if ("text" in change) {
    source = change.text;
  } else {
    source = after;
  }
  return source === undefined ? undefined : normalize(source);
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
  let version;
  if (["base", "step", "head"].includes(requestedVersion ?? "")) {
    version = requestedVersion;
  }
  let focus;
  if (firstLine > 0) {
    const lastLine = requestedEnd >= firstLine ? requestedEnd : firstLine;
    focus = [firstLine, lastLine];
  }
  return {
    step: stepIndex,
    path: params.get("file") ?? undefined,
    version,
    focus,
    mode: params.get("mode") === "diff" ? "diff" : "file"
  };
}
function makeLocation(step, path, version, focus, mode = "file") {
  const params = new URLSearchParams({ step: steps[step].id, file: path, view: version, mode });
  if (focus) {
    params.set("line", String(focus[0]));
    params.set("end", String(focus[1]));
  }
  return `#${params}`;
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
  if (beforeLines.length * afterLines.length > 3000000) {
    throw new RangeError("This diff is too large for an inline comparison. Use Full file to read either version.");
  }
  const width = afterLines.length + 1;
  const table = new Uint32Array((beforeLines.length + 1) * width);
  for (let beforeIndex2 = beforeLines.length - 1;beforeIndex2 >= 0; beforeIndex2--) {
    for (let afterIndex2 = afterLines.length - 1;afterIndex2 >= 0; afterIndex2--) {
      const cell = beforeIndex2 * width + afterIndex2;
      if (beforeLines[beforeIndex2] === afterLines[afterIndex2]) {
        table[cell] = table[(beforeIndex2 + 1) * width + afterIndex2 + 1] + 1;
      } else {
        const skipBefore = table[(beforeIndex2 + 1) * width + afterIndex2];
        const skipAfter = table[beforeIndex2 * width + afterIndex2 + 1];
        table[cell] = Math.max(skipBefore, skipAfter);
      }
    }
  }
  const result = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const hasBefore = beforeIndex < beforeLines.length;
    const hasAfter = afterIndex < afterLines.length;
    if (hasBefore && hasAfter && beforeLines[beforeIndex] === afterLines[afterIndex]) {
      result.push({
        kind: "same",
        text: beforeLines[beforeIndex],
        old: beforeIndex + 1,
        next: afterIndex + 1
      });
      beforeIndex++;
      afterIndex++;
    } else if (hasAfter && (!hasBefore || table[beforeIndex * width + afterIndex + 1] > table[(beforeIndex + 1) * width + afterIndex])) {
      result.push({ kind: "add", text: afterLines[afterIndex], next: afterIndex + 1 });
      afterIndex++;
    } else {
      result.push({ kind: "remove", text: beforeLines[beforeIndex], old: beforeIndex + 1 });
      beforeIndex++;
    }
  }
  return result;
}
function defaultSelection(step) {
  return { path: step.file, version: step.version ?? "step" };
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
  const [base, head] = await Promise.all([readBlob(file, "base"), readBlob(file, "head")]);
  return sourceAtStep(filePath, at, base, head);
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
  if (path && !existsInView(path)) {
    path = existsInView(steps2[step].file) ? steps2[step].file : tabs.findLast(existsInView) ?? "";
    focus = undefined;
  }
  if (path) {
    revealPath(path);
  }
}
function changeVersion(next) {
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
          <button type="button" class="text-button" data-action="return">Return to step’s code</button>
        </div>
        <div class="code-toolbar">
          <div class="view-buttons">
            <button type="button" data-mode="file">Full file</button>
            <button type="button" data-mode="diff">${step === 0 ? "Changes" : "Step diff"}</button>
          </div>
          <a id="github-source" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
        <div class="version-note" id="version-note"></div>
        <div class="code-body" id="code-body">
          <p class="loading">Loading source…</p>
        </div>
        <div class="code-status" id="code-status"></div>
      </main>
      <aside class="guide-pane" aria-label="Step-by-step walkthrough">
        <div class="guide-top">
          <span>Walkthrough</span>
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
  const active = filePath === path;
  const escapedPath = escape(filePath);
  const fileName = escape(filePath.split("/").at(-1));
  return `
    <div class="tab ${active ? "active" : ""}">
      <button
        type="button"
        class="tab-label"
        data-file="${escapedPath}"
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
  root.querySelector("#tabs").innerHTML = tabs.filter(existsInView).map(renderTab).join("");
}
async function closeTab(filePath) {
  const visible = tabs.filter(existsInView);
  const visibleIndex = visible.indexOf(filePath);
  const index = tabs.indexOf(filePath);
  if (index < 0) {
    return;
  }
  tabs.splice(index, 1);
  if (filePath !== path) {
    renderTabs();
    return;
  }
  const remaining = visible.filter((tab) => tab !== filePath);
  const adjacent = remaining[Math.min(visibleIndex, remaining.length - 1)];
  if (adjacent) {
    await openFile(adjacent);
  } else {
    path = "";
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
    return escape(part);
  }
  const index = guideLinks.push(part) - 1;
  const hash = makeLocation(step, part.path, part.version ?? "step");
  const title = escape(part.path) + (part.version === "head" ? " · final change" : "");
  return `<a
    href="${escape(hash)}"
    data-source="${index}"
    title="${title}"
  >${escape(part.label)}</a>`;
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
function renderCodeRow(row, isDiff) {
  const selectedLine = row.next !== undefined && focus && row.next >= focus[0] && row.next <= focus[1];
  const lineAttribute = row.next ? `data-line="${row.next}"` : "";
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
    `<code>${highlight(row.text, path) || " "}</code>`,
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
  if (version === "step" && path === steps2[step].file) {
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
async function renderCode() {
  const ticket = ++requestId;
  root.querySelector(".code-pane").classList.toggle("no-file", !path);
  if (!path) {
    root.querySelector("#code-body").innerHTML = `<p class="code-message">Select a file in the browser, or <button
      type="button"
      class="text-button"
      data-action="return"
    >return to this step’s code</button>.</p>`;
    root.querySelector("#code-status").textContent = "";
    return;
  }
  const selectedFile = files.get(path);
  root.querySelector("#file-path").textContent = path;
  root.querySelector("#version").value = version;
  root.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  root.querySelector('[data-mode="diff"]').textContent = version === "step" ? "Step diff" : "Change diff";
  root.querySelector("#version-note").textContent = versionDescription();
  const github = root.querySelector("#github-source");
  github.hidden = !manifest.sourceUrl;
  if (manifest.sourceUrl) {
    github.href = manifest.sourceUrl;
  }
  github.textContent = "Change source ↗";
  root.querySelector("#code-status").textContent = "";
  const body = root.querySelector("#code-body");
  body.innerHTML = '<p class="loading">Loading source…</p>';
  try {
    const currentText = await read(path, version);
    if (ticket !== requestId) {
      return;
    }
    if (currentText === undefined) {
      body.innerHTML = renderFilePlaceholder(selectedFile);
      return;
    }
    if (!focus && version === "step" && path === steps2[step].file) {
      focus = resolveFocus(currentText, steps2[step]);
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
    const sourceLines = currentText.split(`
`);
    let rows;
    if (mode === "diff") {
      rows = diffLines(previous ?? "", currentText);
    } else {
      rows = fullFileRows(sourceLines, previous ?? "", currentText);
    }
    body.innerHTML = renderRows(rows, mode === "diff");
    root.querySelector("#code-status").textContent = codeStatus(sourceLines.length);
    body.scrollTop = 0;
    requestAnimationFrame(() => {
      if (ticket !== requestId || !focus) {
        return;
      }
      const target = body.querySelector(`[data-line="${focus[0]}"]`) ?? body.querySelector(".line-focus");
      if (target) {
        const lineTop = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        body.scrollTop = Math.max(0, lineTop - 48);
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
  }
  if (record) {
    updateLocation();
  }
  await renderCode();
}
async function goStep(index, record = true) {
  step = Math.max(0, Math.min(steps2.length - 1, index));
  const choice = defaultSelection(steps2[step]);
  version = choice.version;
  renderGuide();
  await openFile(choice.path, {
    label: "",
    path: choice.path,
    version: choice.version,
    symbol: steps2[step].symbol,
    count: steps2[step].count,
    start: steps2[step].focus?.[0],
    end: steps2[step].focus?.[1]
  }, record);
  if (!initialRender) {
    const heading = root.querySelector("#guide-title");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  initialRender = false;
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
  if (element.dataset.source !== undefined) {
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    const link = guideLinks[Number(element.dataset.source)];
    openFile(link.path, link);
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
    mode = element.dataset.mode;
    expandDiff = false;
    updateLocation();
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
      openFile(steps2[step].file, {
        label: "",
        path: steps2[step].file,
        symbol: steps2[step].symbol,
        count: steps2[step].count,
        start: steps2[step].focus?.[0],
        end: steps2[step].focus?.[1],
        version: steps2[step].version ?? "step"
      });
      break;
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
function restoreLocation() {
  if (!manifest) {
    return;
  }
  const state = parseLocation(location.hash);
  step = state.step;
  if (state.path === "" || state.path && files.has(state.path)) {
    path = state.path;
  } else {
    path = steps2[step].file;
  }
  version = state.version ?? "step";
  focus = state.focus;
  mode = state.mode ?? "file";
  reconcileSelection();
  renderTree();
  renderTabs();
  renderGuide();
  renderCode();
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
  path = initial.path ?? steps2[step].file;
  version = initial.version ?? "step";
  focus = initial.focus;
  mode = initial.mode ?? "file";
  files = new Map(manifest.files.map((file) => [file.path, file]));
  if (path && !files.has(path)) {
    path = steps2[step].file;
  }
  reconcileSelection();
  renderShell();
  renderTree();
  renderTabs();
  renderGuide();
  root.classList.toggle("hide-files", !showFiles);
  root.querySelector('[data-action="files"]').setAttribute("aria-pressed", String(showFiles));
  if (initial.path !== undefined) {
    await renderCode();
  } else {
    await goStep(step, false);
  }
}
root.addEventListener("click", handleClick);
window.addEventListener("hashchange", restoreLocation);
try {
  await initialize();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<p
    class="code-message"
    role="alert"
  >${escape(message)} Refresh to try again.</p>`;
}
