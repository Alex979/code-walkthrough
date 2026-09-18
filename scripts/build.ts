import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const viewerSource = resolve(repositoryRoot, "viewer");
const packagedViewer = resolve(repositoryRoot, "skills/code-walkthrough/assets/viewer");
const runtimeScripts = resolve(repositoryRoot, "skills/code-walkthrough/scripts");

// Build directly into the installable skill, which must work without the source tree.
await mkdir(packagedViewer, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(viewerSource, "src/app.ts")],
  outdir: packagedViewer,
  target: "browser",
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

await Promise.all(
  ["index.html", "styles.css"].map((file) =>
    copyFile(resolve(viewerSource, file), resolve(packagedViewer, file)),
  ),
);

console.log("Built the reusable viewer.");

// Ship JavaScript so users need only Node, with no compiler or package installation.
const runtime = await Bun.build({
  entrypoints: ["capture", "validate", "serve"].map((name) =>
    resolve(runtimeScripts, name + ".ts"),
  ),
  outdir: runtimeScripts,
  naming: "[name].mjs",
  target: "node",
  format: "esm",
});

if (!runtime.success) {
  console.error(runtime.logs);
  process.exit(1);
}

console.log("Built the Node runtime.");
