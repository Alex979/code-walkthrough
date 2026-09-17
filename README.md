# Code walkthrough

A portable skill for turning a Git change into a guided code lesson. It captures source once and opens a consistent local viewer with a full repository tree, source tabs, a guide panel, system dark mode, and fixed navigation.

The agent writes `lesson.json`. It does not generate a new website for each walkthrough. Each lesson starts from the captured baseline, introduces changes in a useful teaching order, and finishes at the exact captured head.

## Quickstart

Requirements: Bun 1.3 or newer and Git. For pull requests, also install GitHub CLI (`gh`) and authenticate it for the repository.

To try the bundled synthetic example immediately:

```sh
bun skills/code-walkthrough/scripts/serve.ts skills/code-walkthrough/examples/greeting --port 4318
```

The example also demonstrates the expected prose and source links. Its repository label is portable; its source snapshots come from a tiny synthetic Git repository.

Run these commands from this repository's root. `PATH` is the repository to explain; `ARTIFACT` is a new output directory **outside that repository**.

```sh
bun skills/code-walkthrough/scripts/capture.ts --repo PATH --out ARTIFACT --branch feature --base main
```

Author `ARTIFACT/lesson.json` using [the authoring contract](skills/code-walkthrough/references/authoring.md), [the writing guide](skills/code-walkthrough/references/writing.md), and the exact [TypeScript types](skills/code-walkthrough/scripts/types.ts). Capture produces `manifest.json` and source blobs; lesson authoring supplies the explanation and intermediate source states.

```sh
bun skills/code-walkthrough/scripts/validate.ts ARTIFACT
bun skills/code-walkthrough/scripts/serve.ts ARTIFACT --port 4317
```

Open the localhost URL printed by the server. The viewer is bundled with the skill, and the runtime has no third-party dependencies. Serving a lesson does not require rebuilding the viewer.

For a quick HTTP check, request `/`, `/app.js`, `/styles.css`, `/manifest.json`, and `/lesson.json` on that URL. Captured text is available at `/blobs/<oid>.txt`. These checks confirm delivery, not browser layout or interaction. Stop a foreground server with Ctrl+C.

## Choose the change

All capture commands start with `bun skills/code-walkthrough/scripts/capture.ts --repo PATH --out ARTIFACT`:

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
    ├── scripts/                    # Runtime tools and shared types
    ├── assets/viewer/              # Compiled UI
    └── examples/
```

With the user's permission, symlink or copy `skills/code-walkthrough/` into the chosen harness's skills directory as `code-walkthrough`. For Codex, that can be `$CODEX_HOME/skills/code-walkthrough` or `~/.codex/skills/code-walkthrough`. A copy of `SKILL.md` alone is insufficient: the runtime, bundled assets, types, and references must travel with it. When updating a copied installation, update the whole package together.

There is no automatic global installation or publication. Optional harness-specific agent metadata is not required.

## Maintain the viewer

```sh
bun install --frozen-lockfile
bun run format
bun run check
```

`check` verifies formatting, rebuilds the packaged viewer, and runs the tests. Prettier is installed only for development; the standalone skill still needs no package installation. Generated assets and captured example files are excluded from formatting.

Run maintenance commands from the repository root. Build after changing the viewer; the build writes directly to `skills/code-walkthrough/assets/viewer/`. Installations do not need `package.json`, viewer source, tests, or the build script. Tests and examples should use synthetic repositories. Keep the shared schema, validator, viewer, and authoring documentation aligned; see [AGENTS.md](AGENTS.md) for maintenance invariants.
