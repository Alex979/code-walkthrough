# Code walkthrough

A portable skill for turning a Git change into a guided code lesson. It captures source once and opens a consistent local viewer with a full repository tree, source tabs, a guide panel, system dark mode, and fixed navigation.

The agent writes `lesson.json`. It does not generate a new website for each walkthrough. Each lesson starts from the captured baseline, introduces small changes while explaining them, and finishes at the exact captured head. Files can be revisited as the implementation grows.

Build steps open a compact comparison with the preceding step, showing every changed file and region. A persistent region index and sticky filename headers make separated edits visible. Guide pointers can highlight exact lines inside those diffs, including authored context such as an enclosing method declaration. Full files, source tabs, and the repository tree remain available for exploration.

Context steps can start with an empty code pane or a selected source passage. Guide text supports inline code, bold, and emphasis. Links can point precisely at code already on screen or open optional references; the main walkthrough remains complete using Next alone. Tabs remember their source version, selection, and scroll position within each step. **Return to step** restores the authored starting view, while **Full file** opens near the diff currently being read.

## Quickstart

Requirements: Node.js 22 or newer and Git. For pull requests, also install GitHub CLI (`gh`) and authenticate it for the repository. The skill ships prebuilt JavaScript and viewer assets: users do not need Bun, `npm install`, a TypeScript runner, or a build step.

Before starting, check `node --version` and `git --version`; for PR capture, also check `gh auth status`. Run these checks in the environment where the agent executes commands. If Node is missing or older than 22, install a supported version from [nodejs.org](https://nodejs.org/en/download) or through your usual version manager, reopen the shell, and retry. An installed coding agent does not necessarily provide a usable `node` command.

To try the bundled synthetic example immediately:

```sh
node skills/code-walkthrough/scripts/serve.mjs skills/code-walkthrough/examples/greeting --port 4318
```

The example demonstrates a blank introduction, partial edits, and returning to the same files to add behavior. Its repository label is portable; its source snapshots come from a tiny synthetic Git repository.

Run these commands from this repository's root. `PATH` is the repository to explain; `ARTIFACT` is a new output directory **outside that repository**.

```sh
node skills/code-walkthrough/scripts/capture.mjs --repo PATH --out ARTIFACT --branch feature --base main
```

Author `ARTIFACT/lesson.json` using [the authoring contract](skills/code-walkthrough/references/authoring.md), [the writing guide](skills/code-walkthrough/references/writing.md), and the exact [TypeScript types](skills/code-walkthrough/scripts/types.ts). Capture produces `manifest.json` and source blobs; lesson authoring supplies the explanation and intermediate source states.

```sh
node skills/code-walkthrough/scripts/validate.mjs ARTIFACT
node skills/code-walkthrough/scripts/serve.mjs ARTIFACT --port 4317
```

Open the localhost URL printed by the server. The viewer is bundled with the skill, and the runtime has no third-party dependencies. Serving a lesson does not require rebuilding the viewer.

For a quick HTTP check, request `/`, `/app.js`, `/styles.css`, `/manifest.json`, and `/lesson.json` on that URL. Captured text is available at `/blobs/<oid>.txt`. These checks confirm delivery, not browser layout or interaction. Keep the terminal open, or use your agent's supported background-process mechanism and retain its process/session identifier. Stop a foreground server with Ctrl+C; stop a background server through that mechanism. Restart it with the same serve command and artifact directory.

The server listens on `127.0.0.1` only. If the agent runs in WSL, a remote machine, or a container, the reader's browser needs access to that environment's localhost through the platform's localhost integration or port forwarding. Agents that cannot keep a local server running need a different execution environment for this viewer.

## Choose the change

All capture commands start with `node skills/code-walkthrough/scripts/capture.mjs --repo PATH --out ARTIFACT`:

| Scope arguments           | Meaning                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `--pr URL_OR_NUMBER`      | Resolve the PR's base/head through authenticated `gh`, using local Git objects.              |
| `--branch REF --base REF` | Compare from the branch/base merge base.                                                     |
| `--commit REF`            | Compare the selected commit to its first parent; a root commit starts with an empty tree.    |
| `--range 'A..B'`          | Explicit endpoint-tree comparison of A and B.                                                |
| `--range 'A...B'`         | Compare the merge base of A and B to B.                                                      |
| `--uncommitted`           | Compare HEAD to working files, including staged, unstaged, and nonignored untracked changes. |
| `--uncommitted --staged`  | Limit the local change to staged content.                                                    |

If a PR's required objects are absent locally, capture reports how to fetch them. Fetch the named objects and retry; the current checkout is not a substitute for the PR head.

Captures preserve a full file tree for context. UTF-8 text up to 2 MiB is readable; binary and larger files appear as metadata placeholders. Uncommitted capture requires an existing HEAD and is not atomic across simultaneous edits, so finish editing before capturing.

Working text follows Git's CRLF normalization rules for displayed UTF-8 files. Custom clean filters, `ident`, and `working-tree-encoding` conversions are not executed; committed and staged scopes read the exact stored Git blobs. The manifest records capture limitations.

Use a task-artifact directory supplied by the harness, or a task-specific directory under the user's cache. Artifacts contain captured source, so keep them with the task rather than committing them to either the taught repository or this skill.

## Install as a skill

The complete installable skill is in `skills/code-walkthrough/`. Copy or link that entire directory as `code-walkthrough`; there is no exclusion list. Its scripts, references, schema, bundled viewer, and example travel together, with no dependencies on the surrounding development repository.

```text
code-walkthrough/
├── README.md, AGENTS.md, package.json
├── viewer/                         # UI source
├── scripts/build.ts                # Development tooling
├── tests/
└── skills/code-walkthrough/         # Install this entire directory
    ├── SKILL.md
    ├── references/
    ├── scripts/                    # Prebuilt Node tools, TypeScript source, and shared types
    ├── assets/viewer/              # Compiled UI
    └── examples/
```

With the user's permission, symlink or copy `skills/code-walkthrough/` into the chosen harness's skills directory as `code-walkthrough`. For Codex, that can be `$CODEX_HOME/skills/code-walkthrough` or `~/.codex/skills/code-walkthrough`; for Claude Code, `~/.claude/skills/code-walkthrough`. A copy of `SKILL.md` alone is insufficient: the runtime, bundled assets, types, and references must travel with it. When updating a copied installation, update the whole package together.

There is no automatic global installation or publication. Optional harness-specific agent metadata is not required.

## Maintain the viewer

Maintainers need Bun 1.3 or newer for builds, formatting, and tests, plus Node.js 22 or newer to verify the distributed tools.

```sh
bun install --frozen-lockfile
bun run format
bun run check
```

`check` verifies formatting, rebuilds the packaged viewer and Node tools, and runs the tests. Prettier is installed only for development; the standalone skill still needs no package installation. Generated assets, Node bundles, and captured example files are excluded from formatting.

Run maintenance commands from the repository root. Edit the TypeScript source, then build after changing the runtime tools or viewer. The build writes the Node ESM bundles to `skills/code-walkthrough/scripts/*.mjs` and the viewer to `skills/code-walkthrough/assets/viewer/`; commit these generated outputs with their source changes. Installations do not need the root `package.json`, viewer source, tests, or the build script. Tests and examples should use synthetic repositories. Keep the shared schema, validator, viewer, and authoring documentation aligned; see [AGENTS.md](AGENTS.md) for maintenance invariants.
