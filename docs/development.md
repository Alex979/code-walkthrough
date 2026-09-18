# Development

The installable package lives in `skills/code-walkthrough/`. It contains the skill instructions, references, TypeScript types, prebuilt Node tools, viewer assets, and a synthetic example. Copy or link the whole directory when installing; copied installations should be updated as a complete package.

The repository root holds the viewer source, build tooling, and tests. Runtime tools resolve resources relative to the skill so copied and symlinked installations work from other directories. The distributed package must remain self-contained and free of third-party runtime dependencies.

The agent authors lesson data for the bundled viewer. It does not generate or build a new website for each walkthrough. See [manual usage](manual-usage.md) for capture and serving commands, and the [authoring contract](../skills/code-walkthrough/references/authoring.md) for the lesson format.

## Build and check

Maintainers need Bun 1.3 or newer for builds, formatting, and tests, plus Node.js 22 or newer to verify the distributed tools.

```sh
bun install --frozen-lockfile
bun run format
bun run check
```

`check` verifies formatting, rebuilds the packaged viewer and Node tools, and runs the tests. Prettier is installed only for development; the standalone skill still needs no package installation. Generated assets, Node bundles, and captured example files are excluded from formatting.

Run maintenance commands from the repository root. Edit the TypeScript source, then build after changing the runtime tools or viewer. The build writes the Node ESM bundles to `skills/code-walkthrough/scripts/*.mjs` and the viewer to `skills/code-walkthrough/assets/viewer/`; commit these generated outputs with their source changes. Installations do not need the root `package.json`, viewer source, tests, or the build script. Tests and examples should use synthetic repositories. Keep the shared schema, validator, viewer, and authoring documentation aligned; see [AGENTS.md](../AGENTS.md) for maintenance invariants.

## GitHub Pages demo

The demo uses the bundled greeting lesson and the same viewer as local walkthroughs. Package it from the repository root:

```sh
bun run build
bun run build:demo
```

The packaging command validates the example and assembles the static site in `dist/demo/`. This generated directory is ignored by Git. The site needs no backend: it contains the viewer, lesson and manifest JSON, and captured text blobs. Relative resource URLs let it run under a repository subpath.

To enable deployment, open the repository's **Settings → Pages** and select **GitHub Actions** as the source. GitHub Pages requires a public repository on GitHub Free, or a plan that supports Pages for private repositories. See [GitHub's availability documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

The [Pages workflow](../.github/workflows/pages.yml) publishes the committed viewer assets and bundled example on relevant pushes to `main`, or through its manual **Run workflow** action. Rebuild and commit viewer assets with source changes so deployments stay current. Only the packaged demo directory is uploaded.

For `Alex979/code-walkthrough`, the demo URL is `https://alex979.github.io/code-walkthrough/`. Add it to the README once the first deployment succeeds.
