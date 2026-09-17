---
name: code-walkthrough
description: Create a guided, source-linked code walkthrough of a Git change using a reusable local viewer. Use for lessons about a PR, branch, commit, revision range, or uncommitted changes; ordinary code questions and code reviews do not require a walkthrough artifact.
---

# Code walkthrough

Teach a complete change by building it from the captured baseline, as if the reader were watching someone write and explain the code. Each construction step introduces a small, coherent edit and explains it while it appears. The reader should understand the whole change by advancing through the lesson. Source links can point precisely into the code already being taught or open optional supporting context; they must not hide essential edits.

Use the bundled GitHub-style viewer: full captured repository tree, source tabs, guide panel, system dark mode, and fixed navigation. **Author lesson data only. Never rebuild or redesign the UI for an individual walkthrough.**

Resolve scripts and references relative to this skill's root, regardless of the current working directory. Bun runs the dependency-free tools; Git supplies source snapshots. PR capture also requires an authenticated `gh` CLI.

## Workflow

1. Establish the target repository and requested scope. Preserve the entire scope: divide a large change into coherent chapters within one lesson rather than silently selecting a subset.
2. Choose an artifact directory outside the target repository. Prefer the harness's task-artifact directory; otherwise use a task-specific directory under the user's cache. Do not place captures or lessons in the repository being taught.
3. Capture once with the appropriate command below. Read the resulting `manifest.json` and captured blobs to understand both endpoints and the existing code around the change. Do not edit these snapshots to accommodate the story.
4. Read [the authoring contract](references/authoring.md) and [the writing guide](references/writing.md). The [synthetic example](examples/greeting/lesson.json) demonstrates incremental edits, precise code pointers, inline formatting, and optional references. Treat `scripts/types.ts` as the exact schema. Plan each construction step's concrete edit, the reason for it, and the code that the viewer will show automatically before writing `ARTIFACT/lesson.json`.
5. Establish behavior and the necessary existing context, then build in a plausible human order. Apply the code as it is explained, revisiting files with partial cumulative `text` changes when needed. Use `use: "head"` only when that step teaches all remaining edits in the file. Do not install a whole implementation and explain its pieces in later unchanged steps. Cover every changed file, including supporting changes, and keep essential work visible without paragraph links.
6. Add precise pointers where a reader would otherwise have to hunt for the lines behind a claim. Use `view: "changes"` links to highlight locations within the current step's overview, including a method declaration in the target when needed to orient the reader. Ordinary file links can narrow a context step's focus or open supporting source. Format identifiers with inline backticks. These reading aids supplement the automatically displayed work.
7. Run `bun scripts/validate.ts ARTIFACT` from the skill root. Fix failures until the lesson validates and every changed file reaches its exact captured head state at the final step. Then read through using only the main walkthrough navigation: each construction step must show and explain its new work, with no required hyperlink detours. Check prose and locations against the cumulative source at that step; structural validation cannot establish teaching quality or factual accuracy. Also inspect the pointers: each should identify the specific code its sentence describes, and overview targets should include enough context to recognize it.
8. Run `bun scripts/serve.ts ARTIFACT` (optionally `--port 4317`). Open or provide the returned localhost URL using the harness's supported browser/link mechanism. Deliver the artifact location, scope, and any concrete limitation. Keep the server available while the user reads.

## Capture commands

Run from the skill root, replacing uppercase placeholders and quoting paths or ranges as needed. Choose one scope form:

```sh
bun scripts/capture.ts --repo PATH --out ARTIFACT --pr URL_OR_NUMBER
bun scripts/capture.ts --repo PATH --out ARTIFACT --branch REF --base REF
bun scripts/capture.ts --repo PATH --out ARTIFACT --commit REF
bun scripts/capture.ts --repo PATH --out ARTIFACT --range 'A..B'
bun scripts/capture.ts --repo PATH --out ARTIFACT --range 'A...B'
bun scripts/capture.ts --repo PATH --out ARTIFACT --uncommitted
bun scripts/capture.ts --repo PATH --out ARTIFACT --uncommitted --staged
```

`A..B` compares the two endpoint trees directly. Branch scope and `A...B` use a merge base. Do not substitute one for the other. PR capture uses authenticated `gh` to resolve base/head identities and existing local Git objects; if objects are missing, follow the capture tool's specific fetch instructions and retry within the user's authorization. Do not substitute the current checkout or silently shrink the scope.

The server serves the bundled viewer assets on localhost only. Building the viewer is a maintainer operation, not a lesson-generation step. If bundled assets are missing or broken, report the packaging problem; do not generate a replacement UI.

## Artifact and installation boundaries

Keep source capture, lesson data, and temporary authoring files in the artifact directory. Leave the target repository unchanged. Use the user's repository only for their requested walkthrough; reusable documentation and examples must be synthetic and contain no private project code.

This directory is the complete installable skill. Copy or link it as a whole into the chosen harness's skills directory as code-walkthrough; no file exclusions or files from the development repository are needed. Install only when the user requests or authorizes it. Creating a lesson does not authorize global installation or publication.
