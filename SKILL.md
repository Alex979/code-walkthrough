---
name: code-walkthrough
description: Create a guided, source-linked code walkthrough of a Git change using a reusable local viewer. Use for lessons about a PR, branch, commit, revision range, or uncommitted changes; ordinary code questions and code reviews do not require a walkthrough artifact.
---

# Code walkthrough

Turn a complete change into a lesson that explains its behavior, existing context, and incremental design. Use the bundled GitHub-style viewer: full captured repository tree, source tabs, guide panel, system dark mode, and fixed navigation. **Author lesson data only. Never rebuild or redesign the UI for an individual walkthrough.**

Resolve scripts and references relative to this skill's root, regardless of the current working directory. Bun runs the dependency-free tools; Git supplies source snapshots. PR capture also requires an authenticated `gh` CLI.

## Workflow

1. Establish the target repository and requested scope. Preserve the entire scope: divide a large change into coherent chapters within one lesson rather than silently selecting a subset.
2. Choose an artifact directory outside the target repository. Prefer the harness's task-artifact directory; otherwise use a task-specific directory under the user's cache. Do not place captures or lessons in the repository being taught.
3. Capture once with the appropriate command below. Read the resulting `manifest.json` and captured blobs to understand both endpoints and the existing code around the change. Do not edit these snapshots to accommodate the story.
4. Read [the authoring contract](references/authoring.md) and [the writing guide](references/writing.md). The [synthetic example](examples/greeting/lesson.json) demonstrates the expected prose and links. Treat `viewer/src/types.ts` as the exact schema. Plan a baseline followed by useful conceptual steps; author `ARTIFACT/lesson.json` using cumulative changes and links to exact source versions.
5. Explain the behavior first, then the existing context and a plausible human design order. Teach what the code supports, without inventing the author's historical thoughts. Introduce future constraints when they first affect a decision. Cover every changed file, including supporting changes.
6. Run `bun scripts/validate.ts ARTIFACT` from the skill root. Fix failures until the lesson validates and every changed file reaches its exact captured head state at the final step. Validation is not proof that the explanation is accurate; also read each step against its linked source.
7. Run `bun scripts/serve.ts ARTIFACT` (optionally `--port 4317`). Open or provide the returned localhost URL using the harness's supported browser/link mechanism. Deliver the artifact location, scope, and any concrete limitation. Keep the server available while the user reads.

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

The repository root is itself an installable skill. Installation means symlinking or copying the **entire repository**, including scripts, types, references, and bundled assets, into the chosen harness's skills directory. Install only when the user requests or authorizes it. Creating a lesson does not authorize global installation or publication.
