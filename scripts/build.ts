import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const viewerSource = resolve(repositoryRoot, "viewer");
const packagedViewer = resolve(repositoryRoot, "skills/code-walkthrough/assets/viewer");

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
