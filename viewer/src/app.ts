import {
  configureLesson,
  changeAt,
  defaultSelection,
  focusScrollTop,
  fileExists,
  fileStatus,
  makeLocation,
  normalize,
  parseLocation,
  resolveFocus,
  type DiffLine,
  type DisplayMode,
} from "./model";
import { prepareStepChanges, type FileChange } from "./changes";
import { animateScroll, minimalRevealScrollTop, reserveScrollSpace } from "./scroll";
import { compareLines, type LineComparison } from "../../skills/code-walkthrough/scripts/diff";
import { renderInline } from "./prose";
import { fullFileFocus, isFocusRendered, ReadingMemory, type ReadingPosition } from "./navigation";
import { chapterAt, chapterRanges, type ChapterRange } from "./chapters";
import { clearResume, loadResume, resumeStorageKey, saveResume, shouldResume } from "./resume";
import type {
  FileInfo,
  Manifest,
  Part,
  SourceLink,
  Version,
  Step,
  Lesson,
} from "../../skills/code-walkthrough/scripts/types";

const root = document.querySelector<HTMLDivElement>("#app")!;
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
let mode: DisplayMode = "file";

let filter = "";
let onlyChanged = false;
let expandDiff = false;
// Only the latest source request may update the view after an asynchronous read.
let requestId = 0;
let guideLinks: SourceLink[] = [];
let showFiles = window.innerWidth > 560;
let showGuide = true;
let initialRender = true;
let renderedSource = "";
const readingMemory = new ReadingMemory();
let chapters: ChapterRange[] = [];
let contentsOpen = false;
let guideScrollTop = 0;
let resumeKey = "";
let resumeStorage: Storage | undefined;
let resumeReady = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let cancelCodeScroll: (() => void) | undefined;

function currentPosition(): ReadingPosition {
  const body = root.querySelector<HTMLElement>("#code-body")!;
  return {
    path,
    version,
    mode,
    focus,
    expandDiff,
    scrollTop: body.scrollTop,
    scrollLeft: body.scrollLeft,
  };
}

function persistResume(): void {
  if (!resumeReady || !resumeStorage || renderedSource !== sourceIdentity()) {
    return;
  }
  rememberPosition();
  const positions = tabs.flatMap((filePath) => {
    const position = readingMemory.file(steps[step].id, filePath);
    return position ? [position] : [];
  });
  const overview = readingMemory.overview(steps[step].id);
  if (overview) {
    positions.push(overview);
  }
  if (!contentsOpen && showGuide) {
    guideScrollTop = root.querySelector<HTMLElement>("#guide-content")!.scrollTop;
  }
  saveResume(resumeStorage, resumeKey, {
    stepId: steps[step].id,
    position: currentPosition(),
    guideScrollTop,
    tabs: [...tabs],
    positions,
    showFiles,
    showGuide,
  });
}

function scheduleResumeSave(): void {
  if (!resumeReady) {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistResume, 200);
}

interface RenderPosition {
  scrollTop?: number;
  scrollLeft?: number;
  reveal?: boolean;
  continuation?: ContinuationPosition;
}

interface ContinuationPosition {
  anchors: { path: string; line: number; screenTop: number }[];
  scrollLeft: number;
  backward: boolean;
}

function sourceIdentity(): string {
  return JSON.stringify([step, version, mode, mode === "changes" ? "" : path, expandDiff]);
}

function rememberPosition(): void {
  if (renderedSource !== sourceIdentity() || (!path && mode !== "changes")) {
    return;
  }
  const body = root.querySelector<HTMLElement>("#code-body")!;
  readingMemory.save(steps[step].id, {
    path,
    version,
    mode,
    focus,
    expandDiff,
    scrollTop: body.scrollTop,
    scrollLeft: body.scrollLeft,
  });
}

function applyPosition(position: ReadingPosition): void {
  path = position.path;
  version = position.version;
  mode = position.mode;
  focus = position.focus;
  expandDiff = position.expandDiff;
}

interface ChangeRegion {
  id: string;
  path: string;
  label: string;
}

let changeRegions: ChangeRegion[] = [];
interface PreparedOverview {
  html: string;
  regions: ChangeRegion[];
  files: FileChange[];
  retryable: boolean;
}

const stepChangesCache = new Map<number, Promise<PreparedOverview>>();

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlight(text: string, file: string): string {
  if (!/\.(?:cs|ts|js|json|shader|hlsl|cginc|yaml|yml|asmdef)$/.test(file)) {
    return escape(text);
  }

  const tokenPattern =
    /\/\/.*$|"(?:\\.|[^"\\])*"|\b(?:public|private|internal|static|readonly|sealed|abstract|record|struct|class|namespace|using|return|yield|break|if|else|new|var|double|int|bool|null|true|false|try|finally|foreach|in|continue|throw|out|is|not|switch)\b|\b\d+(?:\.\d+)?\b/g;
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
    offset = match.index! + token.length;
  }

  return output + escape(text.slice(offset));
}

async function readBlob(file: FileInfo, version: "base" | "head"): Promise<string | undefined> {
  const info = file[version];
  if (!info || info.kind !== "text") {
    return undefined;
  }

  if (!textCache.has(info.oid)) {
    const pendingText = fetch(`./blobs/${info.oid}.txt`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Could not read ${file.path} (${response.status}).`);
        }
        return normalize(await response.text());
      })
      .catch((error) => {
        // Share in-flight reads, but do not cache a failure that Retry must fetch again.
        textCache.delete(info.oid);
        throw error;
      });
    textCache.set(info.oid, pendingText);
  }

  return textCache.get(info.oid)!;
}

async function read(filePath: string, view: Version, at = step): Promise<string | undefined> {
  const file = files.get(filePath);
  if (!file) {
    return undefined;
  }
  if (view !== "step") {
    return readBlob(file, view);
  }

  const change = changeAt(filePath, at);
  if (change === null) {
    return undefined;
  }
  if (change && "text" in change) {
    return normalize(change.text);
  }
  return readBlob(file, change ? "head" : "base");
}

function revealPath(filePath: string): void {
  const segments = filePath.split("/");
  for (let depth = 1; depth < segments.length; depth++) {
    openFolders.add(segments.slice(0, depth).join("/"));
  }
  if (!tabs.includes(filePath)) {
    tabs.push(filePath);
  }
}

function updateLocation(): void {
  // pushState records reader navigation without replaying the hashchange handler.
  history.pushState(null, "", makeLocation(step, path, version, focus, mode));
}

function existsInView(filePath: string): boolean {
  const file = files.get(filePath);
  return Boolean(file && fileExists(file, step, version));
}

function reconcileSelection(): void {
  // Keep a requested deleted/absent file selected so its diff or placeholder is
  // honest about this version instead of silently substituting a different file.
  if (path && mode !== "changes") {
    revealPath(path);
  }
}

function changeVersion(next: Version): void {
  rememberPosition();
  if (mode === "changes") {
    path = steps[step].file ?? Object.keys(steps[step].changes ?? {})[0] ?? "";
    mode = "file";
  }
  version = next;
  focus = undefined;
  expandDiff = false;

  reconcileSelection();
  renderTree();
  renderTabs();
  updateLocation();
  void renderCode();
}

function renderShell(): void {
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

  root.querySelector<HTMLInputElement>("#filter")!.addEventListener("input", (event) => {
    filter = (event.target as HTMLInputElement).value;
    renderTree();
  });
  root.querySelector<HTMLInputElement>("#changed-only")!.addEventListener("change", (event) => {
    onlyChanged = (event.target as HTMLInputElement).checked;
    renderTree();
  });
  root.querySelector<HTMLSelectElement>("#version")!.addEventListener("change", (event) => {
    changeVersion((event.target as HTMLSelectElement).value as Version);
  });
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  file?: FileInfo;
}

function renderTreeFile(node: TreeNode, indent: string): string {
  const status = fileStatus(node.file!, step, version);
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

function compareTreeNodes(left: TreeNode, right: TreeNode): number {
  const folderOrder = Number(Boolean(left.file)) - Number(Boolean(right.file));
  return folderOrder || left.name.localeCompare(right.name);
}

function renderTreeChildren(node: TreeNode, depth = 0): string {
  const children = [...node.children.values()].sort(compareTreeNodes);
  const indent = '<span class="indent" aria-hidden="true"></span>'.repeat(depth);
  const rendered: string[] = [];

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

function renderTree(): void {
  const tree: TreeNode = { name: "", path: "", children: new Map() };
  const available = manifest.files.filter((file) => fileExists(file, step, version));

  root.querySelector<HTMLSelectElement>("#version")!.value = version;
  root.querySelector<HTMLOptionElement>('#version option[value="step"]')!.textContent =
    `At this step (${step + 1})`;
  root.querySelector("#file-count")!.textContent = String(available.length);
  root.querySelector("#changed-count")!.textContent = String(
    available.filter((file) => fileStatus(file, step, version)).length,
  );
  root.querySelector("#changed-label")!.textContent =
    version === "step" ? "Changed so far" : "Changed in change";

  let treeNote = "Files in the completed change";
  if (version === "step") {
    treeNote = `Files present at step ${step + 1}`;
  } else if (version === "base") {
    treeNote = "Files before this change";
  }
  root.querySelector("#tree-foot")!.textContent = treeNote;

  const changedCheckbox = root.querySelector<HTMLInputElement>("#changed-only")!;
  changedCheckbox.disabled = version === "base";
  if (version === "base") {
    onlyChanged = false;
    changedCheckbox.checked = false;
  }

  const matches = available.filter(
    (file) =>
      (!onlyChanged || fileStatus(file, step, version)) &&
      file.path.toLowerCase().includes(filter.toLowerCase()),
  );

  for (const file of matches) {
    let node = tree;
    const segments = file.path.split("/");
    segments.forEach((name, index) => {
      if (!node.children.has(name)) {
        node.children.set(name, {
          name,
          path: segments.slice(0, index + 1).join("/"),
          children: new Map(),
        });
      }
      node = node.children.get(name)!;
      if (index === segments.length - 1) {
        node.file = file;
      }
    });
  }

  root.querySelector("#file-tree")!.innerHTML = matches.length
    ? renderTreeChildren(tree)
    : '<p class="empty-tree">No matching files.</p>';
}

function renderTab(filePath: string): string {
  const active = mode !== "changes" && filePath === path;
  const escapedPath = escape(filePath);
  const fileName = escape(filePath.split("/").at(-1)!);

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

function renderTabs(): void {
  const overview = Object.keys(steps[step].changes ?? {}).length
    ? `<div class="tab ${mode === "changes" ? "active" : ""}"><button type="button" class="tab-label" data-action="overview" ${mode === "changes" ? 'aria-current="page"' : ""}>This step’s changes</button></div>`
    : "";
  root.querySelector("#tabs")!.innerHTML =
    overview +
    tabs
      .filter(
        (filePath) =>
          existsInView(filePath) ||
          filePath === path ||
          readingMemory.file(steps[step].id, filePath),
      )
      .map(renderTab)
      .join("");
}

async function closeTab(filePath: string): Promise<void> {
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

  const active =
    root.querySelector<HTMLButtonElement>('.tab-label[aria-current="page"]') ??
    root.querySelector<HTMLButtonElement>('#code-body [data-action="return"]');
  active?.focus({ preventScroll: true });
}

function renderPart(part: Part): string {
  if (typeof part === "string") {
    return renderInline(part);
  }

  const index = guideLinks.push(part) - 1;
  const range: [number, number] | undefined = part.start
    ? [part.start, part.end ?? part.start]
    : undefined;
  const hash = makeLocation(
    step,
    part.path,
    part.version ?? "step",
    range,
    part.view === "changes" ? "changes" : "file",
    part,
  );
  const title = escape(part.path) + (part.version === "head" ? " · final change" : "");
  // Attribute line breaks leave the authored spacing between paragraph parts intact.
  return `<a
    href="${escape(hash)}"
    data-source="${index}"
    title="${title}"
  >${renderInline(part.label)}</a>`;
}

function contentsStep(index: number): string {
  return `<li><button type="button" data-step="${index}"
    ${index === step ? 'aria-current="step"' : ""}>
    <span class="contents-number">${index + 1}</span>
    <span>${escape(steps[index].title)}</span>
  </button></li>`;
}

function renderContents(): void {
  const current = chapterAt(chapters, step);
  const outline = chapters.length
    ? chapters
        .map((chapter, index) => {
          const chapterSteps = Array.from(
            { length: chapter.end - chapter.start + 1 },
            (_, offset) => contentsStep(chapter.start + offset),
          ).join("");
          return `<details ${current?.id === chapter.id ? "open" : ""}>
          <summary><span>${index + 1}. ${escape(chapter.title)}</span>
            <small>${chapter.start === chapter.end ? `Step ${chapter.start + 1}` : `Steps ${chapter.start + 1}–${chapter.end + 1}`}</small>
          </summary>
          <button type="button" class="chapter-start" data-step="${chapter.start}"
            aria-label="Start chapter ${index + 1}: ${escape(chapter.title)}">Start chapter →</button>
          <ol>${chapterSteps}</ol>
        </details>`;
        })
        .join("")
    : `<ol>${steps.map((_, index) => contentsStep(index)).join("")}</ol>`;
  root.querySelector("#lesson-contents")!.innerHTML = `
    <div class="contents-heading"><strong>Walkthrough contents</strong>
      <button type="button" class="text-button" data-action="start-over">Start over</button>
    </div>${outline}`;
}

function toggleContents(open = !contentsOpen): void {
  const guide = root.querySelector<HTMLElement>("#guide-content")!;
  const outline = root.querySelector<HTMLElement>("#lesson-contents")!;
  if (open && !contentsOpen) {
    guideScrollTop = guide.scrollTop;
    renderContents();
  }
  contentsOpen = open;
  guide.hidden = open;
  outline.hidden = !open;
  const button = root.querySelector<HTMLButtonElement>('[data-action="contents"]')!;
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "← Back to reading" : "☰ Contents";
  if (open) {
    const current = outline.querySelector<HTMLElement>('[aria-current="step"]');
    const chapterHeading = current?.closest("details")?.querySelector("summary");
    const target = chapterHeading ?? current;
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  } else {
    guide.scrollTop = guideScrollTop;
    button.focus({ preventScroll: true });
  }
}

function renderGuide(): void {
  if (contentsOpen) {
    toggleContents(false);
  }
  guideScrollTop = 0;
  guideLinks = [];
  const paragraphs = steps[step].paragraphs
    .map((paragraph) => `<p>${paragraph.map(renderPart).join("")}</p>`)
    .join("");

  root.querySelector("#guide-content")!.innerHTML = `
    <h1 id="guide-title">${escape(steps[step].title)}</h1>
    ${paragraphs}
  `;
  root.querySelector("#guide-content")!.scrollTop = 0;

  const chapter = chapterAt(chapters, step);
  const chapterIndex = chapters.findIndex((item) => item === chapter);
  root.querySelector("#chapter-title")!.textContent = chapter
    ? `${chapterIndex + 1}. ${chapter.title}`
    : "Walkthrough";
  root.querySelector("#chapter-progress")!.textContent = chapter
    ? `Step ${step - chapter.start + 1} of ${chapter.end - chapter.start + 1} in this chapter · ${step + 1} of ${steps.length} overall`
    : `Step ${step + 1} of ${steps.length}`;
  root.querySelector("#step-count")!.textContent = `${step + 1} of ${steps.length}`;
  root.querySelector<HTMLButtonElement>('[data-action="back"]')!.disabled = step === 0;
  const next = root.querySelector<HTMLButtonElement>('[data-action="next"]')!;
  const nextChapter = chapter && step === chapter.end ? chapters[chapterIndex + 1] : undefined;
  next.textContent =
    step === steps.length - 1 ? "Start again" : nextChapter ? "Next chapter →" : "Next →";
  const transition = root.querySelector<HTMLElement>("#next-chapter")!;
  transition.hidden = !nextChapter;
  transition.textContent = nextChapter ? `Up next: ${nextChapter.title}` : "";
  root.querySelector("#announcement")!.textContent = `Step ${step + 1}: ${steps[step].title}`;
}

function renderCodeRow(
  row: DiffLine,
  isDiff: boolean,
  filePath = path,
  selection: [number, number] | undefined | null = focus,
): string {
  const selectedLine =
    row.next !== undefined && selection && row.next >= selection[0] && row.next <= selection[1];
  const lineAttribute = `${row.next ? `data-line="${row.next}"` : ""} ${row.old ? `data-old-line="${row.old}"` : ""}`;
  const oldNumber = isDiff
    ? `<span class="line-number old" aria-hidden="true">${row.old ?? ""}</span>`
    : "";

  let changeSign = "";
  if (row.kind === "add") {
    changeSign = "+";
  } else if (row.kind === "remove") {
    changeSign = "−";
  }

  // Join without separators: indentation in the markup must never become source
  // whitespace. Empty source lines still get the original single-space placeholder.
  return [
    `<div
      class="code-line ${row.kind} ${selectedLine ? "line-focus" : ""}"
      ${lineAttribute}
    >`,
    oldNumber,
    `<span class="line-number" aria-hidden="true">${row.next ?? ""}</span>`,
    `<span class="change-sign" aria-hidden="true">${changeSign}</span>`,
    `<code>${highlight(row.text, filePath) || " "}</code>`,
    "</div>",
  ].join("");
}

function renderDiffGap(lineCount: number): string {
  return `<button
    type="button"
    class="diff-gap"
    data-action="expand-diff"
  >Show ${lineCount} unchanged lines</button>`;
}

function renderRows(rows: DiffLine[], isDiff: boolean): string {
  const contextRows = new Set<number>();
  if (isDiff && !expandDiff) {
    // Merge overlapping three-line context windows before inserting gap buttons.
    for (let index = 0; index < rows.length; index++) {
      if (rows[index].kind === "same") {
        continue;
      }

      const firstContextRow = Math.max(0, index - 3);
      const lastContextRow = Math.min(rows.length - 1, index + 3);
      for (let contextIndex = firstContextRow; contextIndex <= lastContextRow; contextIndex++) {
        contextRows.add(contextIndex);
      }
    }
  }

  const selected = rows.flatMap((row, index) =>
    !isDiff || expandDiff || contextRows.has(index) ? [{ row, index }] : [],
  );
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

function versionDescription(): string {
  if (version === "base") {
    return `Before change · ${manifest.base.slice(0, 12)}`;
  }
  if (version === "head") {
    return `Final change · ${manifest.head.slice(0, 12)}`;
  }

  return `At step ${step + 1} · ${steps[step].title}`;
}

function renderFilePlaceholder(selectedFile: FileInfo | undefined): string {
  const change = changeAt(path, step);
  const usesBaseline = version === "base" || (version === "step" && change === undefined);
  const info = usesBaseline ? selectedFile?.base : selectedFile?.head;
  const absent = !selectedFile || !fileExists(selectedFile, step, version);

  let heading: string;
  if (absent) {
    heading =
      version === "step"
        ? "This file hasn’t been introduced yet."
        : "This file does not exist in this version.";
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

function fullFileRows(sourceLines: string[], comparisonRows: DiffLine[]): DiffLine[] {
  const addedLines = new Set<number>();
  // Every file introduced by this step keeps its additions when opened through
  // a reference, tree entry, or tab; the default target is not a special case.
  if (version === "step") {
    for (const row of comparisonRows) {
      if (row.kind === "add" && row.next !== undefined) {
        addedLines.add(row.next);
      }
    }
  }

  return sourceLines.map((text, index) => ({
    text,
    next: index + 1,
    kind: addedLines.has(index + 1) ? "add" : "same",
  }));
}

function coarseComparisonNote(): string {
  return '<p class="code-message">Some large sections are shown as complete replacements. All source lines are preserved; unchanged lines inside those sections may also be marked as removed and added.</p>';
}

function codeStatus(lineCount: number): string {
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

function regionLabel(rows: DiffLine[]): string {
  const changed = rows.filter((row) => row.kind !== "same");
  const added = changed.flatMap((row) => (row.next === undefined ? [] : [row.next]));
  const removed = changed.flatMap((row) => (row.old === undefined ? [] : [row.old]));
  const context = rows.flatMap((row) => (row.next === undefined ? [] : [row.next]));
  const numbers = added.length ? added : removed.length ? removed : context;
  const range = numbers.length > 1 ? `${numbers[0]}–${numbers.at(-1)}` : `${numbers[0]}`;
  return `${added.length ? "Lines" : removed.length ? "Removed lines" : "Context lines"} ${range}`;
}

function loadStepChanges(at: number): Promise<PreparedOverview> {
  const cached = stepChangesCache.get(at);
  if (cached) {
    return cached;
  }

  let retryable = false;
  const pending = (async () => {
    const paths = Object.keys(steps[at].changes ?? {});
    let previous: FileChange[] = [];
    // Derive context from lesson order, not browsing history. A direct link and
    // sequential Next therefore render the same growing excerpt. Stop at a step
    // that does not touch any of these files, avoiding an unrelated history walk.
    if (at > 0 && paths.some((filePath) => Object.hasOwn(steps[at - 1].changes ?? {}, filePath))) {
      const predecessor = await loadStepChanges(at - 1);
      previous = predecessor.files;
      retryable = predecessor.retryable;
    }
    return prepareStepChanges(
      paths,
      at,
      async (filePath, index) => ({
        exists: fileExists(files.get(filePath)!, index, "step"),
        text: await read(filePath, "step", index),
      }),
      steps[at].paragraphs
        .flat()
        .filter((part): part is SourceLink => typeof part !== "string" && part.view === "changes"),
      previous,
    );
  })()
    .then((changes) => {
      // A healthy current comparison may still lack context because an earlier
      // read failed. Do not permanently cache that incomplete excerpt either.
      retryable ||= changes.some((change) => change.failed);
      if (retryable) {
        stepChangesCache.delete(at);
      }
      const entries = changes.map((change, fileIndex) => {
        const filePath = change.path;
        const readingVersion = change.kind === "deleted" ? "base" : "step";
        const regions: ChangeRegion[] = [];
        let content = "";

        if (change.notice) {
          const retry = change.failed
            ? '<button type="button" data-action="retry">Retry</button>'
            : "";
          content = `<p class="code-message">${escape(change.notice)} ${retry}</p>`;
        } else {
          content = change.regions
            .map((region, regionIndex) => {
              const id = `change-${fileIndex}-${regionIndex}`;
              const label = regionLabel(region.rows);
              regions.push({ id, path: filePath, label });
              return `<section class="change-region" id="${id}" ${region.continued ? 'data-continued="true"' : ""} tabindex="-1" aria-label="${escape(filePath + ": " + label)}">
            <div class="region-heading">${escape(label)}</div>
            ${region.rows.map((row) => renderCodeRow(row, true, filePath, null)).join("")}
          </section>`;
            })
            .join("");
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
        </header>${content}</article>`,
        };
      });
      return {
        files: changes,
        retryable,
        html: entries.map((entry) => entry.html).join(""),
        regions: entries.flatMap((entry) => entry.regions),
      };
    })
    .catch((error) => {
      stepChangesCache.delete(at);
      throw error;
    });
  stepChangesCache.set(at, pending);
  return pending;
}

function renderChangeNavigation(): void {
  const nav = root.querySelector<HTMLElement>("#change-nav")!;
  nav.hidden = changeRegions.length === 0;
  const fileCount = new Set(changeRegions.map((region) => region.path)).size;
  nav.innerHTML = `<span class="change-summary">This step: ${fileCount} ${fileCount === 1 ? "file" : "files"} · ${changeRegions.length} ${changeRegions.length === 1 ? "region" : "regions"}</span>
    <div class="change-targets">${changeRegions.map((region, index) => `<button type="button" data-region="${index}" title="${escape(region.path + ": " + region.label)}">${escape(region.path.split("/").at(-1)!)} · ${escape(region.label)}</button>`).join("")}</div>`;
}

function revealFocus(body: HTMLElement, animate = false): void {
  if (!focus) {
    return;
  }
  const source = mode === "changes" ? changeArticle(path) : body;
  const selected = Array.from(source?.querySelectorAll<HTMLElement>("[data-line]") ?? []).filter(
    (row) => {
      const line = Number(row.dataset.line);
      return line >= focus![0] && line <= focus![1];
    },
  );
  const first = selected[0];
  const last = selected.at(-1);
  if (!first || !last) {
    return;
  }
  // The sticky filename header occupies part of the viewport in the overview.
  const inset =
    mode === "changes"
      ? source!.querySelector<HTMLElement>(".change-file-heading")!.offsetHeight
      : 0;
  const bodyTop = body.getBoundingClientRect().top + body.clientTop;
  const top = first.getBoundingClientRect().top - bodyTop + body.scrollTop;
  const bottom = last.getBoundingClientRect().bottom - bodyTop + body.scrollTop;
  const destination = Math.max(
    0,
    focusScrollTop(body.scrollTop + inset, body.clientHeight - inset, top, bottom) - inset,
  );
  if (animate) {
    cancelCodeScroll = animateScroll(body, destination, scheduleResumeSave);
  } else {
    body.scrollTop = destination;
  }
}

function changeArticle(filePath: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-change-path]")).find(
    (article) => article.dataset.changePath === filePath,
  );
}

function markOverviewFocus(): void {
  root
    .querySelectorAll("#code-body .line-focus")
    .forEach((line) => line.classList.remove("line-focus"));
  if (!focus || !path) {
    return;
  }
  changeArticle(path)
    ?.querySelectorAll<HTMLElement>("[data-line]")
    .forEach((line) => {
      const number = Number(line.dataset.line);
      line.classList.toggle("line-focus", number >= focus![0] && number <= focus![1]);
    });
}

function captureContinuation(backward: boolean): ContinuationPosition {
  const body = root.querySelector<HTMLElement>("#code-body")!;
  const bounds = body.getBoundingClientRect();
  const candidates: {
    anchor: ContinuationPosition["anchors"][number];
    priority: number;
    distance: number;
  }[] = [];
  for (const article of body.querySelectorAll<HTMLElement>("[data-change-path]")) {
    const inset = article.querySelector<HTMLElement>(".change-file-heading")!.offsetHeight;
    // On Back, the outgoing comparison maps surviving lines directly into the
    // preceding step. Retain offscreen anchors too: all visible additions may
    // disappear, while the unchanged setup immediately above them still exists.
    const selector = backward
      ? "[data-continued] .code-line.same[data-old-line]"
      : ".code-line[data-line]";
    const visibleTop = bounds.top + inset;
    for (const row of article.querySelectorAll<HTMLElement>(selector)) {
      const rect = row.getBoundingClientRect();
      const visible = rect.top >= visibleTop && rect.top < bounds.bottom;
      if (backward || visible) {
        let priority = 0;
        if (!visible) {
          priority = rect.top < visibleTop ? 1 : 2;
        }
        candidates.push({
          anchor: {
            path: article.dataset.changePath!,
            line: Number(backward ? row.dataset.oldLine : row.dataset.line),
            screenTop: rect.top,
          },
          priority,
          distance: Math.abs(rect.top - visibleTop),
        });
      }
    }
  }
  if (backward) {
    candidates.sort(
      (left, right) => left.priority - right.priority || left.distance - right.distance,
    );
  }
  const anchors = candidates.map((candidate) => candidate.anchor);
  return { anchors, scrollLeft: body.scrollLeft, backward };
}

function revealContinuation(body: HTMLElement, previous?: ContinuationPosition): void {
  const backward = previous?.backward === true;
  let target = backward ? null : body.querySelector<HTMLElement>('[data-continued="true"]');
  if (!backward && !target) {
    return;
  }
  let space: ReturnType<typeof reserveScrollSpace> | undefined;

  // Match unchanged source lines through the new diff's old coordinates. Pixel
  // offsets alone cannot preserve orientation when preceding content changes.
  for (const anchor of previous?.anchors ?? []) {
    const article = changeArticle(anchor.path);
    const row = article?.querySelector<HTMLElement>(
      backward
        ? `.change-region .code-line[data-line="${anchor.line}"]`
        : `[data-continued] .code-line.same[data-old-line="${anchor.line}"]`,
    );
    if (row) {
      const anchoredTop = Math.max(
        0,
        body.scrollTop + row.getBoundingClientRect().top - anchor.screenTop,
      );
      if (backward) {
        space = reserveScrollSpace(body, anchoredTop);
      }
      body.scrollTop = anchoredTop;
      target = row.closest<HTMLElement>(".change-region")!;
      break;
    }
  }
  if (!target) {
    return;
  }
  if (previous) {
    body.scrollLeft = previous.scrollLeft;
  }

  const edits = target.querySelectorAll<HTMLElement>(".code-line.add, .code-line.remove");
  const first = edits[0];
  const last = edits[edits.length - 1];
  if (!first || !last) {
    space?.dispose();
    return;
  }
  const article = target.closest<HTMLElement>(".change-file")!;
  const inset = article.querySelector<HTMLElement>(".change-file-heading")!.offsetHeight;
  const bodyTop = body.getBoundingClientRect().top + body.clientTop;
  const top = first.getBoundingClientRect().top - bodyTop + body.scrollTop;
  const bottom = last.getBoundingClientRect().bottom - bodyTop + body.scrollTop;
  const bottomContext = 2 * Number.parseFloat(getComputedStyle(last).lineHeight);
  let destination = Math.max(
    0,
    minimalRevealScrollTop(
      body.scrollTop + inset,
      body.clientHeight - inset,
      top,
      bottom,
      bottomContext,
    ) - inset,
  );
  if (space) {
    // Settle inside the restored content before removing its temporary space.
    destination = Math.min(destination, space.maxScrollTop);
  }
  if (previous) {
    const finish = (): void => {
      space?.release();
      scheduleResumeSave();
    };
    const cancel = animateScroll(body, destination, finish, () => space?.release());
    cancelCodeScroll = () => {
      cancel();
      space?.dispose();
    };
  } else {
    // Direct navigation has no prior screen position to animate from.
    body.scrollTop = destination;
  }
}

async function renderCode(position: RenderPosition = {}): Promise<void> {
  cancelCodeScroll?.();
  cancelCodeScroll = undefined;
  const ticket = ++requestId;
  const body = root.querySelector<HTMLElement>("#code-body")!;
  const sourceKey = sourceIdentity();
  // A new selection in the same rendered source keeps its scroll position.
  // Animate the reveal only on that continuous surface, not across different
  // files, source versions, or compact/full-file layouts.
  const animateFocus = renderedSource === sourceKey;
  const savedScroll = position.scrollTop ?? (renderedSource === sourceKey ? body.scrollTop : 0);
  const savedHorizontal =
    position.scrollLeft ?? (renderedSource === sourceKey ? body.scrollLeft : 0);
  const overview = mode === "changes";
  root.querySelector<HTMLButtonElement>('[data-action="step-file"]')!.hidden =
    !overview || !steps[step].file;
  root.querySelector(".code-pane")!.classList.toggle("no-file", !path && !overview);
  root.querySelector(".code-pane")!.classList.toggle("show-changes", overview);
  root.querySelector<HTMLSelectElement>("#version")!.value = version;
  root.querySelector("#code-status")!.textContent = "";
  if (!path && !overview) {
    body.innerHTML =
      '<p class="code-message">Open a source reference or choose a file to explore.</p>';
    changeRegions = [];
    renderChangeNavigation();
    renderedSource = sourceKey;
    scheduleResumeSave();
    return;
  }

  const selectedFile = files.get(path);
  root.querySelector("#file-path")!.textContent = overview
    ? "Changes introduced in this step"
    : path;
  root
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  root.querySelector('[data-mode="diff"]')!.textContent =
    version === "step" ? "Step diff" : "Change diff";
  root.querySelector("#version-note")!.textContent = versionDescription();

  const github = root.querySelector<HTMLAnchorElement>("#github-source")!;
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
      const renderedLines = Array.from(
        changeArticle(path)?.querySelectorAll<HTMLElement>("[data-line]") ?? [],
        (row) => Number(row.dataset.line),
      );
      if (focus && path && !isFocusRendered(focus, renderedLines)) {
        // Deep links and restored history pass through this renderer too. A
        // compact view must never report a selection that it cannot reveal.
        // Keep the same cumulative source and resolved range in the full file.
        readingMemory.save(steps[step].id, {
          path: "",
          version: "step",
          mode: "changes",
          scrollTop: savedScroll,
          scrollLeft: savedHorizontal,
          expandDiff: false,
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
      root.querySelector("#code-status")!.textContent =
        "All changes in this step · Compared with the preceding state" +
        (focus && path ? ` · Selected ${path}:${focus[0]}–${focus[1]}` : "");
      if (position.reveal !== false) {
        if (focus) {
          revealFocus(body, animateFocus);
        } else {
          revealContinuation(body, position.continuation);
        }
      }
      return;
    }

    // Optional browsing must not wait for unrelated files in the step overview.
    void pendingChanges
      .then((changes) => {
        if (ticket === requestId) {
          changeRegions = changes.regions;
          renderChangeNavigation();
        }
      })
      .catch(() => {
        // The overview itself presents its retryable errors when opened.
      });

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

    let previous: string | undefined;
    if (version === "step" && step > 0) {
      previous = await read(path, "step", step - 1);
    } else {
      previous = await read(path, "base");
    }
    if (ticket !== requestId) {
      return;
    }

    const sourceLines = (currentText ?? "").split("\n");
    let comparison: LineComparison = { rows: [], coarse: false };
    let comparisonUnavailable = false;
    if (mode === "diff" || version === "step") {
      try {
        comparison = compareLines(previous ?? "", currentText ?? "");
      } catch (error) {
        if (mode === "diff") {
          throw error;
        }
        // Opening source is the recovery path for an unavailable comparison.
        // A failure to calculate coloring must not also hide the captured file.
        comparisonUnavailable = true;
      }
    }
    let rows: DiffLine[];
    if (mode === "diff") {
      rows = comparison.rows;
    } else {
      rows = fullFileRows(sourceLines, comparison.rows);
    }

    let comparisonNote = comparison.coarse ? coarseComparisonNote() : "";
    if (comparisonUnavailable) {
      comparisonNote =
        '<p class="code-message">Change highlighting is unavailable. The captured source is shown below.</p>';
    }
    body.innerHTML = comparisonNote + renderRows(rows, mode === "diff");
    root.querySelector("#code-status")!.textContent = codeStatus(sourceLines.length);
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

async function openFile(filePath: string, target?: SourceLink, record = true): Promise<void> {
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
    root.querySelector<HTMLInputElement>("#changed-only")!.checked = false;
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
    } catch {
      // renderCode presents a retryable read error.
    }
    if (pending !== requestId) {
      return;
    }
  }

  if (record) {
    updateLocation();
  }
  await renderCode();
}

async function openTab(filePath: string, remember = true): Promise<void> {
  if (remember) {
    rememberPosition();
  }
  const position = readingMemory.file(steps[step].id, filePath);
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

async function openOverview(): Promise<void> {
  rememberPosition();
  const position = readingMemory.overview(steps[step].id);
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

async function openPointer(target: SourceLink): Promise<void> {
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
  } catch {
    // Overview preparation keeps a failed source explicit and retryable.
  }
  if (pending !== requestId) {
    return;
  }
  renderTree();
  renderTabs();
  updateLocation();
  await renderCode();
}

async function openFullFile(button: HTMLElement): Promise<void> {
  const filePath = button.dataset.changeFile!;
  const selectedVersion = button.dataset.view as Version;
  const article = changeArticle(filePath);
  const body = root.querySelector<HTMLElement>("#code-body")!;
  const header = article?.querySelector<HTMLElement>(".change-file-heading");
  const visibleTop = Math.max(
    body.getBoundingClientRect().top,
    header?.getBoundingClientRect().bottom ?? 0,
  );
  const visibleBottom = body.getBoundingClientRect().bottom;
  const visibleRows = Array.from(
    article?.querySelectorAll<HTMLElement>(".code-line[data-line]") ?? [],
  ).filter(
    (row) =>
      row.getBoundingClientRect().bottom > visibleTop &&
      row.getBoundingClientRect().top < visibleBottom,
  );
  const first = visibleRows.find((row) => row.classList.contains("add")) ?? visibleRows[0];
  // Current diff coordinates belong to the cumulative source, never to base.
  const line = selectedVersion === "step" && first ? Number(first.dataset.line) : undefined;
  const targetFocus = fullFileFocus(filePath, selectedVersion, line, { path, version, focus });
  await openFile(filePath, {
    label: "",
    path: filePath,
    version: selectedVersion,
    start: targetFocus?.[0],
    end: targetFocus?.[1],
  });
}

async function goStep(index: number, record = true): Promise<void> {
  cancelCodeScroll?.();
  cancelCodeScroll = undefined;
  const continuation =
    Math.abs(index - step) === 1 && mode === "changes" && renderedSource === sourceIdentity()
      ? captureContinuation(index < step)
      : undefined;
  rememberPosition();
  root.querySelector<HTMLElement>("#resume-notice")!.hidden = true;
  step = Math.max(0, Math.min(steps.length - 1, index));
  // Returning to the authored start is distinct from returning to a reader tab.
  renderedSource = "";
  const choice = defaultSelection(steps[step]);
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
    await openFile(
      choice.path,
      {
        label: "",
        path: choice.path,
        version: choice.version,
        symbol: steps[step].symbol,
        count: steps[step].count,
        start: steps[step].focus?.[0],
        end: steps[step].focus?.[1],
      },
      record,
    );
  }

  if (!initialRender) {
    const heading = root.querySelector<HTMLElement>("#guide-title")!;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  initialRender = false;
}

async function startOver(): Promise<void> {
  clearTimeout(saveTimer);
  if (resumeStorage) {
    clearResume(resumeStorage, resumeKey);
  }
  root.querySelector<HTMLElement>("#resume-notice")!.hidden = true;
  // Clear exploration before returning to the first authored view. Navigation
  // remains in history so Start over is reversible with the browser Back button.
  tabs.length = 0;
  readingMemory.clear();
  renderedSource = "";
  await goStep(0);
  persistResume();
}

async function openRegion(index: number): Promise<void> {
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
  const body = root.querySelector<HTMLElement>("#code-body")!;
  focus = undefined;
  path = "";
  markOverviewFocus();
  updateLocation();
  const target = document.getElementById(region.id);
  if (target) {
    const inset =
      target.closest(".change-file")?.querySelector<HTMLElement>(".change-file-heading")
        ?.offsetHeight ?? 0;
    const top =
      target.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const destination = Math.max(
      0,
      focusScrollTop(
        body.scrollTop + inset,
        body.clientHeight - inset,
        top,
        top + target.offsetHeight,
      ) - inset,
    );
    if (animate) {
      cancelCodeScroll = animateScroll(body, destination, scheduleResumeSave);
    } else {
      body.scrollTop = destination;
    }
    target.focus({ preventScroll: true });
  }
}

function handleClick(event: MouseEvent): void {
  const element = (event.target as Element).closest<HTMLElement>("button, a[data-source]");
  if (!element || (element as HTMLButtonElement).disabled) {
    return;
  }
  cancelCodeScroll?.();
  cancelCodeScroll = undefined;

  if (element.dataset.step !== undefined) {
    void goStep(Number(element.dataset.step));
    return;
  }
  if (element.dataset.closeFile) {
    void closeTab(element.dataset.closeFile);
    return;
  }
  if (element.dataset.region !== undefined) {
    void openRegion(Number(element.dataset.region));
    return;
  }
  if (element.dataset.changeFile) {
    void openFullFile(element);
    return;
  }
  if (element.dataset.source !== undefined) {
    if (event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    const link = guideLinks[Number(element.dataset.source)];
    void openPointer(link);
    return;
  }
  if (element.dataset.tab) {
    void openTab(element.dataset.tab);
    return;
  }
  if (element.dataset.file) {
    void openFile(element.dataset.file);
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
    mode = element.dataset.mode as typeof mode;
    expandDiff = false;
    updateLocation();
    renderTabs();
    void renderCode();
    return;
  }

  switch (element.dataset.action) {
    case "contents":
      toggleContents();
      break;
    case "start-over":
      void startOver();
      break;
    case "dismiss-resume":
      root.querySelector<HTMLElement>("#resume-notice")!.hidden = true;
      break;
    case "next":
      if (step === steps.length - 1) {
        void startOver();
      } else {
        void goStep(step + 1);
      }
      break;
    case "back":
      void goStep(step - 1);
      break;
    case "return":
      void goStep(step);
      break;
    case "overview":
      void openOverview();
      break;
    case "step-file": {
      const target = steps[step];
      if (target.file) {
        void openFile(target.file, {
          label: "",
          path: target.file,
          version: target.version ?? "step",
          start: target.focus?.[0],
          end: target.focus?.[1],
          symbol: target.symbol,
          count: target.count,
        });
      }
      break;
    }
    case "final-file":
      changeVersion("head");
      break;
    case "expand-diff":
      expandDiff = true;
      void renderCode();
      break;
    case "retry":
      void renderCode();
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
        root.querySelector<HTMLElement>("#guide-content")!.scrollTop = guideScrollTop;
      }
      scheduleResumeSave();
      break;
  }
}

async function resolveLocationAnchor(target: {
  symbol?: string;
  count?: number;
}): Promise<boolean> {
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
  } catch {
    // The source renderer supplies the retryable loading error.
  }
  return pending === requestId;
}

async function restoreLocation(): Promise<void> {
  if (!manifest) {
    return;
  }

  root.querySelector<HTMLElement>("#resume-notice")!.hidden = true;

  const state = parseLocation(location.hash);
  rememberPosition();
  step = state.step;
  if (state.path === undefined && state.mode === undefined) {
    await goStep(step, false);
    history.replaceState(null, "", makeLocation(step, path, version, focus, mode));
    return;
  }
  const choice = defaultSelection(steps[step]);

  // An explicit empty path restores no selected file; missing or unknown paths
  // use the lesson's file. Rendering can restore lesson focus when none was saved.
  if (state.path === "" || (state.path && files.has(state.path))) {
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

async function initialize(): Promise<void> {
  const response = await fetch("./manifest.json");
  if (!response.ok) {
    throw new Error(`Could not load the repository snapshot (${response.status}).`);
  }
  manifest = (await response.json()) as Manifest;

  const lessonResponse = await fetch("./lesson.json");
  if (!lessonResponse.ok) {
    throw new Error("Could not load lesson.json.");
  }
  lesson = (await lessonResponse.json()) as Lesson;
  if (lesson.schemaVersion !== 1 || manifest.schemaVersion !== 1 || !lesson.steps.length) {
    throw new Error("Unsupported or empty walkthrough. Run the validator.");
  }

  steps = lesson.steps;
  chapters = chapterRanges(lesson);
  configureLesson(steps);
  document.title = lesson.title + " · Code walkthrough";
  files = new Map(manifest.files.map((file) => [file.path, file]));

  try {
    resumeKey = await resumeStorageKey(manifest, lesson);
    resumeStorage = window.localStorage;
  } catch {
    // Browser privacy settings may disable storage. Reading still works normally.
  }
  const saved = resumeStorage
    ? loadResume(resumeStorage, resumeKey, lesson, new Set(files.keys()))
    : undefined;
  const savedStep = saved ? steps.findIndex((item) => item.id === saved.stepId) : 0;
  const savedHash = saved
    ? makeLocation(
        savedStep,
        saved.position.path,
        saved.position.version,
        saved.position.focus,
        saved.position.mode,
      )
    : "";
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const resumed =
    saved && shouldResume(location.hash, savedHash, navigation?.type) ? saved : undefined;

  const initial = parseLocation(location.hash);
  step = initial.step;
  const choice = defaultSelection(steps[step]);
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
  root.querySelector('[data-action="files"]')!.setAttribute("aria-pressed", String(showFiles));
  root.querySelector('[data-action="guide"]')!.setAttribute("aria-pressed", String(showGuide));
  if (resumed) {
    root.querySelector<HTMLElement>("#resume-notice")!.hidden = false;
    root.querySelector("#resume-message")!.textContent = `Resumed at step ${step + 1}`;
    guideScrollTop = resumed.guideScrollTop;
    root.querySelector<HTMLElement>("#guide-content")!.scrollTop = guideScrollTop;
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
  // A shortened step link or a symbol anchor may resolve to a different URL
  // spelling. Record that resolved target so refreshing can match its saved
  // scroll, while opening the original link still reveals its authored target.
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
  void restoreLocation();
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
