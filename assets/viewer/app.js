// viewer/src/model.ts
var steps = [];
function configureLesson(value) {
  steps = value;
}
function changeAt(path, index) {
  for (let i = Math.min(index, steps.length - 1);i >= 0; i--) {
    if (Object.hasOwn(steps[i].changes ?? {}, path))
      return steps[i].changes[path];
  }
  return;
}
function fileExists(file, index, version) {
  if (version !== "step")
    return Boolean(file[version]);
  const change = changeAt(file.path, index);
  return change === null ? false : change === undefined ? Boolean(file.base) : ("text" in change) ? true : Boolean(file.head);
}
function fileStatus(file, index, version) {
  if (!fileExists(file, index, version) || version === "base")
    return "";
  if (version === "head")
    return file.status;
  const change = changeAt(file.path, index);
  if (change === undefined)
    return "";
  if (change && "use" in change)
    return file.status;
  return file.base ? "M" : "A";
}
var normalize = (text) => text.replaceAll(`\r
`, `
`);
function sourceAtStep(path, index, before, after) {
  const change = changeAt(path, index);
  const value = change === null ? undefined : change === undefined ? before : ("text" in change) ? change.text : after;
  return value === undefined ? undefined : normalize(value);
}
function resolveFocus(text, target) {
  const lines = normalize(text).split(`
`);
  if (target.symbol) {
    const match = lines.findIndex((line) => line.includes(target.symbol));
    if (match < 0)
      return;
    return [match + 1, Math.min(lines.length, match + (target.count ?? 1))];
  }
  if (target.focus)
    return target.focus;
  return target.start ? [target.start, target.end ?? target.start] : undefined;
}
function parseLocation(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const id = params.get("step");
  const step = Math.max(0, steps.findIndex((item) => item.id === id));
  const version = params.get("view");
  const line = Number(params.get("line"));
  const end = Number(params.get("end"));
  return {
    step,
    path: params.get("file") ?? undefined,
    version: ["base", "step", "head"].includes(version ?? "") ? version : undefined,
    focus: line > 0 ? [line, end >= line ? end : line] : undefined,
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
  const a = normalize(before).replace(/\n$/, "").split(`
`);
  const b = normalize(after).replace(/\n$/, "").split(`
`);
  if (!before)
    a.length = 0;
  if (!after)
    b.length = 0;
  if (a.length * b.length > 3000000)
    throw new RangeError("This diff is too large for an inline comparison. Use Full file to read either version.");
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i2 = a.length - 1;i2 >= 0; i2--)
    for (let j2 = b.length - 1;j2 >= 0; j2--) {
      table[i2 * width + j2] = a[i2] === b[j2] ? table[(i2 + 1) * width + j2 + 1] + 1 : Math.max(table[(i2 + 1) * width + j2], table[i2 * width + j2 + 1]);
    }
  const result = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ kind: "same", text: a[i], old: i + 1, next: j + 1 });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || table[i * width + j + 1] > table[(i + 1) * width + j])) {
      result.push({ kind: "add", text: b[j], next: j + 1 });
      j++;
    } else {
      result.push({ kind: "remove", text: a[i], old: i + 1 });
      i++;
    }
  }
  return result;
}
function defaultSelection(step) {
  return { path: step.file, version: step.version ?? "step" };
}

// viewer/src/app.ts
var root = document.querySelector("#app");
var escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
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
function highlight(text, file) {
  if (!/\.(?:cs|ts|js|json|shader|hlsl|cginc|yaml|yml|asmdef)$/.test(file))
    return escape(text);
  const re = /\/\/.*$|"(?:\\.|[^"\\])*"|\b(?:public|private|internal|static|readonly|sealed|abstract|record|struct|class|namespace|using|return|yield|break|if|else|new|var|double|int|bool|null|true|false|try|finally|foreach|in|continue|throw|out|is|not|switch)\b|\b\d+(?:\.\d+)?\b/g;
  let output = "", offset = 0;
  for (const match of text.matchAll(re)) {
    output += escape(text.slice(offset, match.index));
    const kind = match[0].startsWith("//") ? "comment" : match[0].startsWith('"') ? "string" : /^\d/.test(match[0]) ? "number" : "keyword";
    output += `<span class="${kind}">${escape(match[0])}</span>`;
    offset = match.index + match[0].length;
  }
  return output + escape(text.slice(offset));
}
async function read(filePath, view, at = step) {
  const file = files.get(filePath);
  if (!file)
    return;
  async function blob(which) {
    const info = file[which];
    if (!info || info.kind !== "text")
      return;
    if (!textCache.has(info.oid))
      textCache.set(info.oid, fetch(`/blobs/${info.oid}.txt`).then(async (response) => {
        if (!response.ok)
          throw new Error(`Could not read ${filePath} (${response.status}).`);
        return normalize(await response.text());
      }).catch((error) => {
        textCache.delete(info.oid);
        throw error;
      }));
    return textCache.get(info.oid);
  }
  if (view !== "step")
    return blob(view);
  const [base, head] = await Promise.all([blob("base"), blob("head")]);
  return sourceAtStep(filePath, at, base, head);
}
function revealPath(filePath) {
  const bits = filePath.split("/");
  for (let i = 1;i < bits.length; i++)
    openFolders.add(bits.slice(0, i).join("/"));
  if (!tabs.includes(filePath))
    tabs.push(filePath);
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
  if (path)
    revealPath(path);
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
function shell() {
  root.innerHTML = `
    <a class="skip" href="#guide-title">Skip to walkthrough</a>
    <header class="topbar"><div class="repo-title"><strong>${escape(manifest.repo.split(/[\\/]/).at(-1) ?? manifest.repo)}</strong></div><span class="page-title">${escape(lesson.title)}</span><div class="layout-controls"><button type="button" data-action="files" aria-pressed="true">Files</button><button type="button" data-action="guide" aria-pressed="true">Walkthrough</button></div></header>
    <div class="workspace">
      <aside class="files-pane" aria-label="Repository files"><div class="files-heading"><strong>Files</strong><span id="file-count"></span></div><div class="snapshot-picker"><label for="version">Repository version</label><select id="version"><option value="base">Before change</option><option value="step">At this step</option><option value="head">Final change</option></select></div><div class="file-filters"><input id="filter" type="search" placeholder="Find a file…" aria-label="Filter repository files" /><label><input type="checkbox" id="changed-only" /><span id="changed-label">Changed so far</span><span id="changed-count"></span></label></div><div class="file-tree" id="file-tree"></div><div class="tree-foot" id="tree-foot"></div></aside>
      <main class="code-pane" aria-label="Source code"><div class="tabs" id="tabs"></div><div class="file-bar"><span id="file-path"></span><button type="button" class="text-button" data-action="return">Return to step’s code</button></div><div class="code-toolbar"><div class="view-buttons"><button type="button" data-mode="file">Full file</button><button type="button" data-mode="diff">${step === 0 ? "Changes" : "Step diff"}</button></div><a id="github-source" target="_blank" rel="noreferrer">GitHub ↗</a></div><div class="version-note" id="version-note"></div><div class="code-body" id="code-body"><p class="loading">Loading source…</p></div><div class="code-status" id="code-status"></div></main>
      <aside class="guide-pane" aria-label="Step-by-step walkthrough"><div class="guide-top"><span>Walkthrough</span><label><span class="sr-only">Choose a step</span><select id="step-select">${steps2.map((item, index) => `<option value="${index}">${index + 1}. ${escape(item.title)}</option>`).join("")}</select></label></div><div class="guide-content" id="guide-content"></div><div class="guide-footer"><button type="button" data-action="back">← Back</button><span id="step-count"></span><button type="button" data-action="next">Next →</button></div></aside>
    </div><div class="sr-only" id="announcement" aria-live="polite"></div>`;
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
function renderTree() {
  const tree = { name: "", path: "", children: new Map };
  const available = manifest.files.filter((file) => fileExists(file, step, version));
  root.querySelector("#version").value = version;
  root.querySelector('#version option[value="step"]').textContent = `At this step (${step + 1})`;
  root.querySelector("#file-count").textContent = String(available.length);
  root.querySelector("#changed-count").textContent = String(available.filter((file) => fileStatus(file, step, version)).length);
  root.querySelector("#changed-label").textContent = version === "step" ? "Changed so far" : "Changed in change";
  root.querySelector("#tree-foot").textContent = version === "step" ? `Files present at step ${step + 1}` : version === "base" ? "Files before this change" : "Files in the completed change";
  const changedCheckbox = root.querySelector("#changed-only");
  changedCheckbox.disabled = version === "base";
  if (version === "base") {
    onlyChanged = false;
    changedCheckbox.checked = false;
  }
  const matches = available.filter((file) => (!onlyChanged || fileStatus(file, step, version)) && file.path.toLowerCase().includes(filter.toLowerCase()));
  for (const file of matches) {
    let node = tree;
    const bits = file.path.split("/");
    bits.forEach((name, index) => {
      if (!node.children.has(name))
        node.children.set(name, { name, path: bits.slice(0, index + 1).join("/"), children: new Map });
      node = node.children.get(name);
      if (index === bits.length - 1)
        node.file = file;
    });
  }
  const nodes = (node, depth = 0) => [...node.children.values()].sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name)).map((child) => {
    const indent = '<span class="indent" aria-hidden="true"></span>'.repeat(depth);
    if (child.file) {
      const status = fileStatus(child.file, step, version);
      return `<button type="button" class="file-row ${child.path === path ? "selected" : ""}" data-file="${escape(child.path)}" title="${escape(child.path)}${status ? ` · ${status === "A" ? "Added" : "Modified"} ${version === "step" ? "so far" : "in change"}` : ""}" ${child.path === path ? 'aria-current="true"' : ""}>${indent}<span class="file-symbol" aria-hidden="true">▤</span><span class="file-name">${escape(child.name)}</span><span class="file-status ${status}">${status}</span></button>`;
    }
    const expanded = Boolean(filter) || openFolders.has(child.path);
    return `<div class="folder"><button type="button" class="folder-row" data-folder="${escape(child.path)}" aria-expanded="${expanded}">${indent}<span class="chevron" aria-hidden="true">${expanded ? "⌄" : "›"}</span><span>${escape(child.name)}</span></button>${expanded ? nodes(child, depth + 1) : ""}</div>`;
  }).join("");
  root.querySelector("#file-tree").innerHTML = matches.length ? nodes(tree) : '<p class="empty-tree">No matching files.</p>';
}
function renderTabs() {
  root.querySelector("#tabs").innerHTML = tabs.filter(existsInView).map((tab) => `<div class="tab ${tab === path ? "active" : ""}"><button type="button" class="tab-label" data-file="${escape(tab)}" title="${escape(tab)}" ${tab === path ? 'aria-current="page"' : ""}>${escape(tab.split("/").at(-1))}</button><button type="button" class="tab-close" data-close-file="${escape(tab)}" aria-label="Close ${escape(tab.split("/").at(-1))}" title="Close ${escape(tab)}">×</button></div>`).join("");
}
async function closeTab(filePath) {
  const visible = tabs.filter(existsInView);
  const visibleIndex = visible.indexOf(filePath);
  const index = tabs.indexOf(filePath);
  if (index < 0)
    return;
  tabs.splice(index, 1);
  if (filePath !== path) {
    renderTabs();
    return;
  }
  const remaining = visible.filter((tab) => tab !== filePath);
  const adjacent = remaining[Math.min(visibleIndex, remaining.length - 1)];
  if (adjacent)
    await openFile(adjacent);
  else {
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
  if (typeof part === "string")
    return escape(part);
  const index = guideLinks.push(part) - 1;
  const hash = makeLocation(step, part.path, part.version ?? "step");
  return `<a href="${escape(hash)}" data-source="${index}" title="${escape(part.path)}${part.version === "head" ? " · final change" : ""}">${escape(part.label)}</a>`;
}
function renderGuide() {
  guideLinks = [];
  root.querySelector("#guide-content").innerHTML = `<h1 id="guide-title">${escape(steps2[step].title)}</h1>${steps2[step].paragraphs.map((paragraph) => `<p>${paragraph.map(renderPart).join("")}</p>`).join("")}`;
  root.querySelector("#guide-content").scrollTop = 0;
  root.querySelector("#step-select").value = String(step);
  root.querySelector("#step-count").textContent = `${step + 1} of ${steps2.length}`;
  root.querySelector('[data-action="back"]').disabled = step === 0;
  const next = root.querySelector('[data-action="next"]');
  next.textContent = step === steps2.length - 1 ? "Start again" : "Next →";
  root.querySelector("#announcement").textContent = `Step ${step + 1}: ${steps2[step].title}`;
}
function renderRows(rows, isDiff) {
  let previousEnd = -1;
  const changed = rows.flatMap((row, index) => row.kind !== "same" ? [index] : []);
  const keep = new Set;
  if (isDiff && !expandDiff)
    for (const index of changed)
      for (let j = Math.max(0, index - 3);j <= Math.min(rows.length - 1, index + 3); j++)
        keep.add(j);
  const selected = rows.flatMap((row, index) => !isDiff || expandDiff || keep.has(index) ? [{ row, index }] : []);
  let html = "";
  if (!selected.length && isDiff)
    return '<p class="code-message">No changes to this file in this step. <button type="button" class="text-button" data-mode="file">Read the full file</button></p>';
  for (const { row, index } of selected) {
    if (index > previousEnd + 1)
      html += `<button type="button" class="diff-gap" data-action="expand-diff">Show ${index - previousEnd - 1} unchanged lines</button>`;
    previousEnd = index;
    const selectedLine = row.next !== undefined && focus && row.next >= focus[0] && row.next <= focus[1];
    html += `<div class="code-line ${row.kind} ${selectedLine ? "line-focus" : ""}" ${row.next ? `data-line="${row.next}"` : ""}>${isDiff ? `<span class="line-number old" aria-hidden="true">${row.old ?? ""}</span>` : ""}<span class="line-number" aria-hidden="true">${row.next ?? ""}</span><span class="change-sign" aria-hidden="true">${row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}</span><code>${highlight(row.text, path) || " "}</code></div>`;
  }
  if (isDiff && previousEnd < rows.length - 1)
    html += `<button type="button" class="diff-gap" data-action="expand-diff">Show ${rows.length - previousEnd - 1} unchanged lines</button>`;
  return html;
}
async function renderCode() {
  const ticket = ++requestId;
  root.querySelector(".code-pane").classList.toggle("no-file", !path);
  if (!path) {
    root.querySelector("#code-body").innerHTML = '<p class="code-message">Select a file in the browser, or <button type="button" class="text-button" data-action="return">return to this step’s code</button>.</p>';
    root.querySelector("#code-status").textContent = "";
    return;
  }
  const selectedFile = files.get(path);
  root.querySelector("#file-path").textContent = path;
  root.querySelector("#version").value = version;
  root.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  root.querySelector('[data-mode="diff"]').textContent = version === "step" ? "Step diff" : "Change diff";
  const versionName = version === "base" ? `Before change · ${manifest.base.slice(0, 12)}` : version === "head" ? `Final change · ${manifest.head.slice(0, 12)}` : `At step ${step + 1} · ${steps2[step].title}`;
  root.querySelector("#version-note").textContent = versionName;
  const github = root.querySelector("#github-source");
  github.hidden = !manifest.sourceUrl;
  if (manifest.sourceUrl)
    github.href = manifest.sourceUrl;
  github.textContent = "Change source ↗";
  root.querySelector("#code-status").textContent = "";
  const body = root.querySelector("#code-body");
  body.innerHTML = '<p class="loading">Loading source…</p>';
  try {
    const currentText = await read(path, version);
    if (ticket !== requestId)
      return;
    if (currentText === undefined) {
      const change = changeAt(path, step);
      const info = version === "base" || version === "step" && change === undefined ? selectedFile?.base : selectedFile?.head;
      const absent = !selectedFile || !fileExists(selectedFile, step, version);
      body.innerHTML = `<div class="file-placeholder"><h2>${absent ? version === "step" ? "This file hasn’t been introduced yet." : "This file does not exist in this version." : info?.kind === "large" ? "This file is too large to display." : "This is a binary asset."}</h2><p>${absent ? "Choose Final change to read the completed file." : `${escape(path)}${info ? ` · ${(info.size / 1024).toFixed(1)} KB` : ""}`}</p>${version !== "head" && selectedFile?.head ? '<button type="button" data-action="final-file">View final change file</button>' : ""}</div>`;
      return;
    }
    if (!focus && version === "step" && path === steps2[step].file) {
      focus = resolveFocus(currentText, steps2[step]);
    }
    const previous = version === "step" ? step > 0 ? await read(path, "step", step - 1) : await read(path, "base") : await read(path, "base");
    if (ticket !== requestId)
      return;
    const sourceLines = currentText.split(`
`);
    let rows;
    if (mode === "diff")
      rows = diffLines(previous ?? "", currentText);
    else {
      let added = new Set;
      if (version === "step" && path === steps2[step].file) {
        try {
          added = new Set(diffLines(previous ?? "", currentText).filter((row) => row.kind === "add").map((row) => row.next));
        } catch (error) {
          if (!(error instanceof RangeError))
            throw error;
        }
      }
      rows = sourceLines.map((text, i) => ({ text, next: i + 1, kind: added.has(i + 1) ? "add" : "same" }));
    }
    body.innerHTML = renderRows(rows, mode === "diff");
    root.querySelector("#code-status").textContent = `${sourceLines.length} lines${focus ? ` · Selected ${focus[0]}${focus[1] > focus[0] ? `–${focus[1]}` : ""}` : ""}${mode === "diff" ? ` · Compared with ${version === "step" ? "previous step" : "change base"}` : ""}`;
    body.scrollTop = 0;
    requestAnimationFrame(() => {
      if (ticket !== requestId || !focus)
        return;
      const target = body.querySelector(`[data-line="${focus[0]}"]`) ?? body.querySelector(".line-focus");
      if (target) {
        const lineTop = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        body.scrollTop = Math.max(0, lineTop - 48);
      }
    });
  } catch (error) {
    if (ticket !== requestId)
      return;
    body.innerHTML = `<p class="code-message" role="alert">${escape(error instanceof Error ? error.message : String(error))} <button type="button" class="text-button" data-action="retry">Retry</button></p>`;
  }
}
async function openFile(filePath, target, record = true) {
  path = filePath;
  if (target)
    version = target.version ?? "step";
  mode = "file";
  focus = undefined;
  expandDiff = false;
  reconcileSelection();
  if (onlyChanged && (!files.get(path) || !fileStatus(files.get(path), step, version))) {
    onlyChanged = false;
    root.querySelector("#changed-only").checked = false;
  }
  renderTree();
  renderTabs();
  if (target) {
    const pending = ++requestId;
    try {
      const text = await read(path, version);
      if (pending !== requestId)
        return;
      if (text !== undefined)
        focus = resolveFocus(text, target);
    } catch {}
  }
  if (record)
    updateLocation();
  await renderCode();
}
async function goStep(index, record = true) {
  step = Math.max(0, Math.min(steps2.length - 1, index));
  const choice = defaultSelection(steps2[step]);
  version = choice.version;
  renderGuide();
  await openFile(choice.path, { label: "", path: choice.path, version: choice.version, symbol: steps2[step].symbol, count: steps2[step].count, start: steps2[step].focus?.[0], end: steps2[step].focus?.[1] }, record);
  if (!initialRender) {
    const heading = root.querySelector("#guide-title");
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  initialRender = false;
}
root.addEventListener("click", (event) => {
  const element = event.target.closest("button, a[data-source]");
  if (!element || element.disabled)
    return;
  if (element.dataset.closeFile) {
    closeTab(element.dataset.closeFile);
    return;
  }
  if (element.dataset.source !== undefined) {
    if (event.ctrlKey || event.metaKey)
      return;
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
    if (openFolders.has(folder))
      openFolders.delete(folder);
    else
      openFolders.add(folder);
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
      openFile(steps2[step].file, { label: "", path: steps2[step].file, symbol: steps2[step].symbol, count: steps2[step].count, start: steps2[step].focus?.[0], end: steps2[step].focus?.[1], version: steps2[step].version ?? "step" });
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
});
window.addEventListener("hashchange", () => {
  if (!manifest)
    return;
  const state = parseLocation(location.hash);
  step = state.step;
  path = state.path === "" || state.path && files.has(state.path) ? state.path : steps2[step].file;
  version = state.version ?? "step";
  focus = state.focus;
  mode = state.mode ?? "file";
  reconcileSelection();
  renderTree();
  renderTabs();
  renderGuide();
  renderCode();
});
try {
  const response = await fetch("/manifest.json");
  if (!response.ok)
    throw new Error(`Could not load the repository snapshot (${response.status}).`);
  manifest = await response.json();
  const lessonResponse = await fetch("/lesson.json");
  if (!lessonResponse.ok)
    throw new Error("Could not load lesson.json.");
  lesson = await lessonResponse.json();
  if (lesson.schemaVersion !== 1 || manifest.schemaVersion !== 1 || !lesson.steps.length)
    throw new Error("Unsupported or empty walkthrough. Run the validator.");
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
  if (path && !files.has(path))
    path = steps2[step].file;
  reconcileSelection();
  shell();
  renderTree();
  renderTabs();
  renderGuide();
  root.classList.toggle("hide-files", !showFiles);
  root.querySelector('[data-action="files"]').setAttribute("aria-pressed", String(showFiles));
  if (initial.path !== undefined)
    await renderCode();
  else
    await goStep(step, false);
} catch (error) {
  root.innerHTML = `<p class="code-message" role="alert">${escape(error instanceof Error ? error.message : String(error))} Refresh to try again.</p>`;
}
