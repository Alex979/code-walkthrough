import { configureLesson, changeAt, defaultSelection, diffLines, fileExists, fileStatus, makeLocation, normalize, parseLocation, resolveFocus, sourceAtStep, type DiffLine } from "./model";
import type { FileInfo, Manifest, Part, SourceLink, Version, Step, Lesson } from "./types";

const root = document.querySelector<HTMLDivElement>("#app")!;
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const textCache = new Map<string, Promise<string>>();
const openFolders = new Set<string>();
const tabs: string[] = [];
let steps: Step[] = [];
let lesson: Lesson;
let manifest: Manifest;
let files: Map<string, FileInfo>;
let step = 0;
let path = "";
let version: Version = "step";
let focus: [number, number] | undefined;
let mode: "file" | "diff" = "file";
let filter = "";
let onlyChanged = false;
let expandDiff = false;
let requestId = 0;
let guideLinks: SourceLink[] = [];
let showFiles = window.innerWidth > 560;
let showGuide = true;
let initialRender = true;

function highlight(text: string, file: string): string {
  if (!/\.(?:cs|ts|js|json|shader|hlsl|cginc|yaml|yml|asmdef)$/.test(file)) return escape(text);
  const re = /\/\/.*$|"(?:\\.|[^"\\])*"|\b(?:public|private|internal|static|readonly|sealed|abstract|record|struct|class|namespace|using|return|yield|break|if|else|new|var|double|int|bool|null|true|false|try|finally|foreach|in|continue|throw|out|is|not|switch)\b|\b\d+(?:\.\d+)?\b/g;
  let output = "", offset = 0;
  for (const match of text.matchAll(re)) {
    output += escape(text.slice(offset, match.index));
    const kind = match[0].startsWith("//") ? "comment" : match[0].startsWith('"') ? "string" : /^\d/.test(match[0]) ? "number" : "keyword";
    output += `<span class="${kind}">${escape(match[0])}</span>`;
    offset = match.index! + match[0].length;
  }
  return output + escape(text.slice(offset));
}

async function read(filePath: string, view: Version, at = step): Promise<string | undefined> {
  const file = files.get(filePath);
  if (!file) return undefined;
  async function blob(which: "base" | "head"): Promise<string | undefined> {
    const info = file![which];
    if (!info || info.kind !== "text") return undefined;
    if (!textCache.has(info.oid)) textCache.set(info.oid, fetch(`/blobs/${info.oid}.txt`).then(async response => {
      if (!response.ok) throw new Error(`Could not read ${filePath} (${response.status}).`);
      return normalize(await response.text());
    }).catch(error => { textCache.delete(info.oid); throw error; }));
    return textCache.get(info.oid)!;
  }
  if (view !== "step") return blob(view);
  const [base, head] = await Promise.all([blob("base"), blob("head")]);
  return sourceAtStep(filePath, at, base, head);
}

function revealPath(filePath: string): void {
  const bits = filePath.split("/");
  for (let i = 1; i < bits.length; i++) openFolders.add(bits.slice(0, i).join("/"));
  if (!tabs.includes(filePath)) tabs.push(filePath);
}

function updateLocation(): void {
  history.pushState(null, "", makeLocation(step, path, version, focus, mode));
}

function existsInView(filePath: string): boolean {
  const file = files.get(filePath);
  return Boolean(file && fileExists(file, step, version));
}

function reconcileSelection(): void {
  if (path && !existsInView(path)) {
    path = existsInView(steps[step].file) ? steps[step].file : tabs.findLast(existsInView) ?? "";
    focus = undefined;
  }
  if (path) revealPath(path);
}

function changeVersion(next: Version): void {
  version = next;
  focus = undefined; expandDiff = false;
  reconcileSelection(); renderTree(); renderTabs(); updateLocation(); void renderCode();
}

function shell(): void {
  root.innerHTML = `
    <a class="skip" href="#guide-title">Skip to walkthrough</a>
    <header class="topbar"><div class="repo-title"><strong>${escape(manifest.repo.split(/[\\/]/).at(-1) ?? manifest.repo)}</strong></div><span class="page-title">${escape(lesson.title)}</span><div class="layout-controls"><button type="button" data-action="files" aria-pressed="true">Files</button><button type="button" data-action="guide" aria-pressed="true">Walkthrough</button></div></header>
    <div class="workspace">
      <aside class="files-pane" aria-label="Repository files"><div class="files-heading"><strong>Files</strong><span id="file-count"></span></div><div class="snapshot-picker"><label for="version">Repository version</label><select id="version"><option value="base">Before change</option><option value="step">At this step</option><option value="head">Final change</option></select></div><div class="file-filters"><input id="filter" type="search" placeholder="Find a file…" aria-label="Filter repository files" /><label><input type="checkbox" id="changed-only" /><span id="changed-label">Changed so far</span><span id="changed-count"></span></label></div><div class="file-tree" id="file-tree"></div><div class="tree-foot" id="tree-foot"></div></aside>
      <main class="code-pane" aria-label="Source code"><div class="tabs" id="tabs"></div><div class="file-bar"><span id="file-path"></span><button type="button" class="text-button" data-action="return">Return to step’s code</button></div><div class="code-toolbar"><div class="view-buttons"><button type="button" data-mode="file">Full file</button><button type="button" data-mode="diff">${step === 0 ? "Changes" : "Step diff"}</button></div><a id="github-source" target="_blank" rel="noreferrer">GitHub ↗</a></div><div class="version-note" id="version-note"></div><div class="code-body" id="code-body"><p class="loading">Loading source…</p></div><div class="code-status" id="code-status"></div></main>
      <aside class="guide-pane" aria-label="Step-by-step walkthrough"><div class="guide-top"><span>Walkthrough</span><label><span class="sr-only">Choose a step</span><select id="step-select">${steps.map((item, index) => `<option value="${index}">${index + 1}. ${escape(item.title)}</option>`).join("")}</select></label></div><div class="guide-content" id="guide-content"></div><div class="guide-footer"><button type="button" data-action="back">← Back</button><span id="step-count"></span><button type="button" data-action="next">Next →</button></div></aside>
    </div><div class="sr-only" id="announcement" aria-live="polite"></div>`;
  root.querySelector<HTMLInputElement>("#filter")!.addEventListener("input", event => {
    filter = (event.target as HTMLInputElement).value; renderTree();
  });
  root.querySelector<HTMLInputElement>("#changed-only")!.addEventListener("change", event => {
    onlyChanged = (event.target as HTMLInputElement).checked; renderTree();
  });
  root.querySelector<HTMLSelectElement>("#version")!.addEventListener("change", event => {
    changeVersion((event.target as HTMLSelectElement).value as Version);
  });
  root.querySelector<HTMLSelectElement>("#step-select")!.addEventListener("change", event => {
    void goStep(Number((event.target as HTMLSelectElement).value));
  });
}

interface TreeNode { name: string; path: string; children: Map<string, TreeNode>; file?: FileInfo }
function renderTree(): void {
  const tree: TreeNode = { name: "", path: "", children: new Map() };
  const available = manifest.files.filter(file => fileExists(file, step, version));
  root.querySelector<HTMLSelectElement>("#version")!.value = version;
  root.querySelector<HTMLOptionElement>('#version option[value="step"]')!.textContent = `At this step (${step + 1})`;
  root.querySelector("#file-count")!.textContent = String(available.length);
  root.querySelector("#changed-count")!.textContent = String(available.filter(file => fileStatus(file, step, version)).length);
  root.querySelector("#changed-label")!.textContent = version === "step" ? "Changed so far" : "Changed in change";
  root.querySelector("#tree-foot")!.textContent = version === "step" ? `Files present at step ${step + 1}` : version === "base" ? "Files before this change" : "Files in the completed change";
  const changedCheckbox = root.querySelector<HTMLInputElement>("#changed-only")!;
  changedCheckbox.disabled = version === "base";
  if (version === "base") { onlyChanged = false; changedCheckbox.checked = false; }
  const matches = available.filter(file => (!onlyChanged || fileStatus(file, step, version)) && file.path.toLowerCase().includes(filter.toLowerCase()));
  for (const file of matches) {
    let node = tree;
    const bits = file.path.split("/");
    bits.forEach((name, index) => {
      if (!node.children.has(name)) node.children.set(name, { name, path: bits.slice(0, index + 1).join("/"), children: new Map() });
      node = node.children.get(name)!;
      if (index === bits.length - 1) node.file = file;
    });
  }
  const nodes = (node: TreeNode, depth = 0): string => [...node.children.values()]
    .sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name))
    .map(child => {
      const indent = "<span class=\"indent\" aria-hidden=\"true\"></span>".repeat(depth);
      if (child.file) {
        const status = fileStatus(child.file, step, version);
        return `<button type="button" class="file-row ${child.path === path ? "selected" : ""}" data-file="${escape(child.path)}" title="${escape(child.path)}${status ? ` · ${status === "A" ? "Added" : "Modified"} ${version === "step" ? "so far" : "in change"}` : ""}" ${child.path === path ? 'aria-current="true"' : ""}>${indent}<span class="file-symbol" aria-hidden="true">▤</span><span class="file-name">${escape(child.name)}</span><span class="file-status ${status}">${status}</span></button>`;
      }
      const expanded = Boolean(filter) || openFolders.has(child.path);
      return `<div class="folder"><button type="button" class="folder-row" data-folder="${escape(child.path)}" aria-expanded="${expanded}">${indent}<span class="chevron" aria-hidden="true">${expanded ? "⌄" : "›"}</span><span>${escape(child.name)}</span></button>${expanded ? nodes(child, depth + 1) : ""}</div>`;
    }).join("");
  root.querySelector("#file-tree")!.innerHTML = matches.length ? nodes(tree) : '<p class="empty-tree">No matching files.</p>';
}

function renderTabs(): void {
  root.querySelector("#tabs")!.innerHTML = tabs.filter(existsInView).map(tab => `<div class="tab ${tab === path ? "active" : ""}"><button type="button" class="tab-label" data-file="${escape(tab)}" title="${escape(tab)}" ${tab === path ? 'aria-current="page"' : ""}>${escape(tab.split("/").at(-1)!)}</button><button type="button" class="tab-close" data-close-file="${escape(tab)}" aria-label="Close ${escape(tab.split("/").at(-1)!)}" title="Close ${escape(tab)}">×</button></div>`).join("");
}

async function closeTab(filePath: string): Promise<void> {
  const visible = tabs.filter(existsInView);
  const visibleIndex = visible.indexOf(filePath);
  const index = tabs.indexOf(filePath);
  if (index < 0) return;
  tabs.splice(index, 1);
  if (filePath !== path) { renderTabs(); return; }
  const remaining = visible.filter(tab => tab !== filePath);
  const adjacent = remaining[Math.min(visibleIndex, remaining.length - 1)];
  if (adjacent) await openFile(adjacent);
  else {
    path = ""; focus = undefined;
    renderTabs(); renderTree(); updateLocation(); await renderCode();
  }
  const active = root.querySelector<HTMLButtonElement>('.tab-label[aria-current="page"]')
    ?? root.querySelector<HTMLButtonElement>('#code-body [data-action="return"]');
  active?.focus({ preventScroll: true });
}

function renderPart(part: Part): string {
  if (typeof part === "string") return escape(part);
  const index = guideLinks.push(part) - 1;
  const hash = makeLocation(step, part.path, part.version ?? "step");
  return `<a href="${escape(hash)}" data-source="${index}" title="${escape(part.path)}${part.version === "head" ? " · final change" : ""}">${escape(part.label)}</a>`;
}

function renderGuide(): void {
  guideLinks = [];
  root.querySelector("#guide-content")!.innerHTML = `<h1 id="guide-title">${escape(steps[step].title)}</h1>${steps[step].paragraphs.map(paragraph => `<p>${paragraph.map(renderPart).join("")}</p>`).join("")}`;
  root.querySelector("#guide-content")!.scrollTop = 0;
  root.querySelector<HTMLSelectElement>("#step-select")!.value = String(step);
  root.querySelector("#step-count")!.textContent = `${step + 1} of ${steps.length}`;
  root.querySelector<HTMLButtonElement>('[data-action="back"]')!.disabled = step === 0;
  const next = root.querySelector<HTMLButtonElement>('[data-action="next"]')!;
  next.textContent = step === steps.length - 1 ? "Start again" : "Next →";
  root.querySelector("#announcement")!.textContent = `Step ${step + 1}: ${steps[step].title}`;
}

function renderRows(rows: DiffLine[], isDiff: boolean): string {
  let previousEnd = -1;
  const changed = rows.flatMap((row, index) => row.kind !== "same" ? [index] : []);
  const keep = new Set<number>();
  if (isDiff && !expandDiff) for (const index of changed) for (let j = Math.max(0, index - 3); j <= Math.min(rows.length - 1, index + 3); j++) keep.add(j);
  const selected = rows.flatMap((row, index) => !isDiff || expandDiff || keep.has(index) ? [{ row, index }] : []);
  let html = "";
  if (!selected.length && isDiff) return '<p class="code-message">No changes to this file in this step. <button type="button" class="text-button" data-mode="file">Read the full file</button></p>';
  for (const { row, index } of selected) {
    if (index > previousEnd + 1) html += `<button type="button" class="diff-gap" data-action="expand-diff">Show ${index - previousEnd - 1} unchanged lines</button>`;
    previousEnd = index;
    const selectedLine = row.next !== undefined && focus && row.next >= focus[0] && row.next <= focus[1];
    html += `<div class="code-line ${row.kind} ${selectedLine ? "line-focus" : ""}" ${row.next ? `data-line="${row.next}"` : ""}>${isDiff ? `<span class="line-number old" aria-hidden="true">${row.old ?? ""}</span>` : ""}<span class="line-number" aria-hidden="true">${row.next ?? ""}</span><span class="change-sign" aria-hidden="true">${row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}</span><code>${highlight(row.text, path) || " "}</code></div>`;
  }
  if (isDiff && previousEnd < rows.length - 1) html += `<button type="button" class="diff-gap" data-action="expand-diff">Show ${rows.length - previousEnd - 1} unchanged lines</button>`;
  return html;
}

async function renderCode(): Promise<void> {
  const ticket = ++requestId;
  root.querySelector(".code-pane")!.classList.toggle("no-file", !path);
  if (!path) {
    root.querySelector("#code-body")!.innerHTML = '<p class="code-message">Select a file in the browser, or <button type="button" class="text-button" data-action="return">return to this step’s code</button>.</p>';
    root.querySelector("#code-status")!.textContent = "";
    return;
  }
  const selectedFile = files.get(path);
  root.querySelector("#file-path")!.textContent = path;
  root.querySelector<HTMLSelectElement>("#version")!.value = version;
  root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  root.querySelector('[data-mode="diff"]')!.textContent = version === "step" ? "Step diff" : "Change diff";
  const versionName = version === "base" ? `Before change · ${manifest.base.slice(0, 12)}` : version === "head" ? `Final change · ${manifest.head.slice(0, 12)}` : `At step ${step + 1} · ${steps[step].title}`;
  root.querySelector("#version-note")!.textContent = versionName;
  const github = root.querySelector<HTMLAnchorElement>("#github-source")!;
  github.hidden = !manifest.sourceUrl;
  if (manifest.sourceUrl) github.href = manifest.sourceUrl;
  github.textContent = "Change source ↗";
  root.querySelector("#code-status")!.textContent = "";
  const body = root.querySelector<HTMLElement>("#code-body")!;
  body.innerHTML = '<p class="loading">Loading source…</p>';
  try {
    const currentText = await read(path, version);
    if (ticket !== requestId) return;
    if (currentText === undefined) {
      const change = changeAt(path, step);
      const info = version === "base" || version === "step" && change === undefined ? selectedFile?.base : selectedFile?.head;
      const absent = !selectedFile || !fileExists(selectedFile, step, version);
      body.innerHTML = `<div class="file-placeholder"><h2>${absent ? version === "step" ? "This file hasn’t been introduced yet." : "This file does not exist in this version." : info?.kind === "large" ? "This file is too large to display." : "This is a binary asset."}</h2><p>${absent ? "Choose Final change to read the completed file." : `${escape(path)}${info ? ` · ${(info.size / 1024).toFixed(1)} KB` : ""}`}</p>${version !== "head" && selectedFile?.head ? '<button type="button" data-action="final-file">View final change file</button>' : ""}</div>`;
      return;
    }
    // A saved step URL may name the file without a line selection. Restore the
    // lesson's selection before rendering, including on the initial page load.
    if (!focus && version === "step" && path === steps[step].file) {
      focus = resolveFocus(currentText, steps[step]);
    }
    const previous = version === "step" ? step > 0 ? await read(path, "step", step - 1) : await read(path, "base") : await read(path, "base");
    if (ticket !== requestId) return;
    const sourceLines = currentText.split("\n");
    let rows: DiffLine[];
    if (mode === "diff") rows = diffLines(previous ?? "", currentText);
    else {
      let added = new Set<number>();
      // Highlight changes only while reading the lesson's file at its current step.
      if (version === "step" && path === steps[step].file) {
        try {
          added = new Set(diffLines(previous ?? "", currentText).filter(row => row.kind === "add").map(row => row.next!));
        } catch (error) {
          // Full-file reading remains available when an inline diff exceeds its budget.
          if (!(error instanceof RangeError)) throw error;
        }
      }
      rows = sourceLines.map((text, i) => ({ text, next: i + 1, kind: added.has(i + 1) ? "add" : "same" }));
    }
    body.innerHTML = renderRows(rows, mode === "diff");
    root.querySelector("#code-status")!.textContent = `${sourceLines.length} lines${focus ? ` · Selected ${focus[0]}${focus[1] > focus[0] ? `–${focus[1]}` : ""}` : ""}${mode === "diff" ? ` · Compared with ${version === "step" ? "previous step" : "change base"}` : ""}`;
    body.scrollTop = 0;
    requestAnimationFrame(() => {
      if (ticket !== requestId || !focus) return;
      const target = body.querySelector<HTMLElement>(`[data-line="${focus[0]}"]`) ?? body.querySelector<HTMLElement>(".line-focus");
      if (target) {
        const lineTop = target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        body.scrollTop = Math.max(0, lineTop - 48);
      }
    });
  } catch (error) {
    if (ticket !== requestId) return;
    body.innerHTML = `<p class="code-message" role="alert">${escape(error instanceof Error ? error.message : String(error))} <button type="button" class="text-button" data-action="retry">Retry</button></p>`;
  }
}

async function openFile(filePath: string, target?: SourceLink, record = true): Promise<void> {
  path = filePath;
  if (target) version = target.version ?? "step";
  mode = "file"; focus = undefined; expandDiff = false;
  reconcileSelection();
  if (onlyChanged && (!files.get(path) || !fileStatus(files.get(path)!, step, version))) { onlyChanged = false; root.querySelector<HTMLInputElement>("#changed-only")!.checked = false; }
  renderTree(); renderTabs();
  if (target) {
    const pending = ++requestId;
    try {
      const text = await read(path, version);
      if (pending !== requestId) return;
      if (text !== undefined) focus = resolveFocus(text, target);
    } catch { /* renderCode presents a retryable read error. */ }
  }
  if (record) updateLocation();
  await renderCode();
}

async function goStep(index: number, record = true): Promise<void> {
  step = Math.max(0, Math.min(steps.length - 1, index));
  const choice = defaultSelection(steps[step]);
  version = choice.version;
  renderGuide();
  await openFile(choice.path, { label: "", path: choice.path, version: choice.version, symbol: steps[step].symbol, count: steps[step].count, start: steps[step].focus?.[0], end: steps[step].focus?.[1] }, record);
  if (!initialRender) {
    const heading = root.querySelector<HTMLElement>("#guide-title")!;
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
  }
  initialRender = false;
}

root.addEventListener("click", event => {
  const element = (event.target as Element).closest<HTMLElement>("button, a[data-source]");
  if (!element || (element as HTMLButtonElement).disabled) return;
  if (element.dataset.closeFile) { void closeTab(element.dataset.closeFile); return; }
  if (element.dataset.source !== undefined) {
    if ((event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) return;
    event.preventDefault(); const link = guideLinks[Number(element.dataset.source)]; void openFile(link.path, link); return;
  }
  if (element.dataset.file) { void openFile(element.dataset.file); return; }
  if (element.dataset.folder) { const folder = element.dataset.folder; if (openFolders.has(folder)) openFolders.delete(folder); else openFolders.add(folder); renderTree(); return; }
  if (element.dataset.mode) { mode = element.dataset.mode as typeof mode; expandDiff = false; updateLocation(); void renderCode(); return; }
  switch (element.dataset.action) {
    case "next": void goStep(step === steps.length - 1 ? 0 : step + 1); break;
    case "back": void goStep(step - 1); break;
    case "return": void openFile(steps[step].file, { label: "", path: steps[step].file, symbol: steps[step].symbol, count: steps[step].count, start: steps[step].focus?.[0], end: steps[step].focus?.[1], version: steps[step].version ?? "step" }); break;
    case "final-file": changeVersion("head"); break;
    case "expand-diff": expandDiff = true; void renderCode(); break;
    case "retry": void renderCode(); break;
    case "files": showFiles = !showFiles; root.classList.toggle("hide-files", !showFiles); element.setAttribute("aria-pressed", String(showFiles)); break;
    case "guide": showGuide = !showGuide; root.classList.toggle("hide-guide", !showGuide); element.setAttribute("aria-pressed", String(showGuide)); break;
  }
});

window.addEventListener("hashchange", () => {
  if (!manifest) return;
  const state = parseLocation(location.hash);
  step = state.step; path = state.path === "" || state.path && files.has(state.path) ? state.path : steps[step].file;
  version = state.version ?? "step"; focus = state.focus; mode = state.mode ?? "file";
  reconcileSelection();
  renderTree(); renderTabs(); renderGuide(); void renderCode();
});

try {
  const response = await fetch("/manifest.json");
  if (!response.ok) throw new Error(`Could not load the repository snapshot (${response.status}).`);
  manifest = await response.json() as Manifest;
  const lessonResponse = await fetch("/lesson.json");
  if (!lessonResponse.ok) throw new Error("Could not load lesson.json.");
  lesson = await lessonResponse.json() as Lesson;
  if (lesson.schemaVersion !== 1 || manifest.schemaVersion !== 1 || !lesson.steps.length) throw new Error("Unsupported or empty walkthrough. Run the validator.");
  steps = lesson.steps;
  configureLesson(steps);
  document.title = lesson.title + " · Code walkthrough";
  const initial = parseLocation(location.hash);
  step = initial.step; path = initial.path ?? steps[step].file;
  version = initial.version ?? "step"; focus = initial.focus; mode = initial.mode ?? "file";
  files = new Map(manifest.files.map(file => [file.path, file]));
  if (path && !files.has(path)) path = steps[step].file;
  reconcileSelection();
  shell(); renderTree(); renderTabs(); renderGuide();
  root.classList.toggle("hide-files", !showFiles);
  root.querySelector('[data-action="files"]')!.setAttribute("aria-pressed", String(showFiles));
  if (initial.path !== undefined) await renderCode();
  else await goStep(step, false);
} catch (error) {
  root.innerHTML = `<p class="code-message" role="alert">${escape(error instanceof Error ? error.message : String(error))} Refresh to try again.</p>`;
}
