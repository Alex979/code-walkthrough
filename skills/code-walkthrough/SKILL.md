---
name: code-walkthrough
description: Create a guided, source-linked code walkthrough of a Git change using a reusable local viewer. Use for lessons about a PR, branch, commit, revision range, or uncommitted changes; ordinary code questions and code reviews do not require a walkthrough artifact.
metadata:
  compatibility: Requires Node.js 22+, Git, and permission to run a localhost server. GitHub PR capture also requires authenticated gh.
---

# Code walkthrough

Teach a complete change by building it from the captured baseline, as if the reader were watching someone write and explain the code. Each construction step introduces a small, coherent edit and explains it while it appears. The reader should understand the whole change by advancing through the lesson. Source links can point precisely into the code already being taught or open optional supporting context; they must not hide essential edits.

Use the bundled GitHub-style viewer: full captured repository tree, source tabs, guide panel, system dark mode, and fixed navigation. **Author lesson data only. Never rebuild or redesign the UI for an individual walkthrough.**

Resolve scripts and references relative to this skill's root, regardless of the current working directory. Node.js 22+ runs the prebuilt `.mjs` tools; Git supplies source snapshots. Users need no Bun, package installation, TypeScript runner, or build step. PR capture also requires an authenticated `gh` CLI.

Before capturing, run `node --version` and `git --version` in the agent's execution environment; for PR capture also run `gh auth status`. Do not assume the coding agent provides Node. If Node is missing or older than 22, explain that it is required and provide [Node installation instructions](https://nodejs.org/en/download) or the user's usual version-manager command, then have them reopen the shell and retry. If Git or PR authentication is missing, identify that prerequisite and its setup step. Do not silently install runtimes or continue with a missing prerequisite.

## Workflow

1. Establish the target repository and requested scope. Preserve the entire scope: divide a large change into coherent chapters within one lesson rather than silently selecting a subset.
2. Choose an artifact directory outside the target repository. Prefer the harness's task-artifact directory; otherwise use a task-specific directory under the user's cache. Do not place captures or lessons in the repository being taught.
3. Capture once with the appropriate command below. Read the resulting `manifest.json` and captured blobs to understand both endpoints and the existing code around the change. Do not edit these snapshots to accommodate the story.
4. Read [the authoring contract](references/authoring.md) and [the writing guide](references/writing.md). The [synthetic example](examples/greeting/lesson.json) demonstrates incremental edits, precise code pointers, inline formatting, and optional references. Treat `scripts/types.ts` as the exact schema. Plan each construction step's concrete edit, the reason for it, and the code that the viewer will show automatically before writing `ARTIFACT/lesson.json`.
5. Establish behavior and the necessary existing context, then build in a plausible human order. Apply the code as it is explained, revisiting files with partial cumulative `text` changes when needed. Use `use: "head"` only when that step teaches all remaining edits in the file. Do not install a whole implementation and explain its pieces in later unchanged steps. Cover every changed file, including supporting changes, and keep essential work visible without paragraph links.
6. Explain each new design decision from the reader's need to the concrete operations, using the writing guide's before/after examples as a model. Add precise pointers to distinct claims that would otherwise require searching; a whole-method link does not locate every operation discussed afterward. Use `view: "changes"` for the current overview and ordinary file links for context. Include a method declaration where needed for orientation, and format identifiers with inline backticks.
7. Run `node scripts/validate.mjs ARTIFACT` from the skill root. Fix failures until every changed file reaches its exact captured head state. Then complete the writing guide's [learner read-through](references/writing.md#read-it-back-as-a-learner): follow the build without links, match explanatory claims to code, and edit the prose for concrete meaning. Revise the lesson from that pass; structural validation alone cannot establish teaching quality or factual accuracy.
8. Run `node scripts/serve.mjs ARTIFACT` (optionally `--port 4317`) using the harness's supported background-process mechanism. Retain its process/session identifier and verify that the printed localhost URL responds before opening or providing it with the harness's browser/link mechanism. Deliver the artifact location, scope, any concrete limitation, and how to stop the server or restart it with the same command. Keep the server available while the user reads.

## Capture commands

Run from the skill root, replacing uppercase placeholders and quoting paths or ranges as needed. Choose one scope form:

```sh
node scripts/capture.mjs --repo PATH --out ARTIFACT --pr URL_OR_NUMBER
node scripts/capture.mjs --repo PATH --out ARTIFACT --branch REF --base REF
node scripts/capture.mjs --repo PATH --out ARTIFACT --commit REF
node scripts/capture.mjs --repo PATH --out ARTIFACT --range 'A..B'
node scripts/capture.mjs --repo PATH --out ARTIFACT --range 'A...B'
node scripts/capture.mjs --repo PATH --out ARTIFACT --uncommitted
node scripts/capture.mjs --repo PATH --out ARTIFACT --uncommitted --staged
```

`A..B` compares the two endpoint trees directly. Branch scope and `A...B` use a merge base. Do not substitute one for the other. PR capture uses authenticated `gh` to resolve base/head identities and existing local Git objects; if objects are missing, follow the capture tool's specific fetch instructions and retry within the user's authorization. Do not substitute the current checkout or silently shrink the scope.

The server serves the bundled viewer assets on `127.0.0.1` only. A remote or container environment needs the harness's port forwarding or preview support so the reader can reach that localhost server. If the harness cannot keep background processes alive, provide the serve command for a persistent terminal; stop it there with Ctrl+C. Stop a background server through the harness's process/session controls. Do not expose the server publicly to work around these limits.

Building tools and viewer assets is a maintainer operation, not a lesson-generation step. If bundled `.mjs` tools or assets are missing or broken, report the packaging problem and request a complete installation; do not generate a replacement UI or build the package during lesson creation.

## Artifact and installation boundaries

Keep source capture, lesson data, and temporary authoring files in the artifact directory. Leave the target repository unchanged. Use the user's repository only for their requested walkthrough; reusable documentation and examples must be synthetic and contain no private project code.

This directory is the complete installable skill. Copy or link it as a whole into the chosen harness's skills directory as code-walkthrough; no file exclusions or files from the development repository are needed. Install only when the user requests or authorizes it. Creating a lesson does not authorize global installation or publication.
