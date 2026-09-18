# Manual usage

The skill normally handles capture, lesson authoring, validation, and serving for you. These commands are for trying the bundled example, troubleshooting, or working with the tools directly.

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

Author `ARTIFACT/lesson.json` using [the authoring contract](../skills/code-walkthrough/references/authoring.md), [the writing guide](../skills/code-walkthrough/references/writing.md), and the exact [TypeScript types](../skills/code-walkthrough/scripts/types.ts). Capture produces `manifest.json` and source blobs; lesson authoring supplies the explanation and intermediate source states.

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
