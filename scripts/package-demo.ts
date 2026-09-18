import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Manifest } from "../skills/code-walkthrough/scripts/types";

const repositoryRoot = resolve(import.meta.dir, "..");
const skillRoot = resolve(repositoryRoot, "skills/code-walkthrough");
const exampleRoot = resolve(skillRoot, "examples/greeting");
const viewerRoot = resolve(skillRoot, "assets/viewer");
const outputRoot = resolve(repositoryRoot, "dist/demo");

// Use the shipped validator so deployment checks the same contract as an installed skill.
const validation = spawnSync(
  "node",
  [resolve(skillRoot, "scripts/validate.mjs"), exampleRoot, "--presentation"],
  { stdio: "inherit", windowsHide: true },
);
if (validation.error) {
  throw validation.error;
}
if (validation.status !== 0) {
  throw new Error("The bundled example failed validation; the demo was not packaged.");
}

const manifest = JSON.parse(
  await readFile(resolve(exampleRoot, "manifest.json"), "utf8"),
) as Manifest;
const textBlobIds = new Set<string>();
for (const file of manifest.files) {
  for (const snapshot of [file.base, file.head]) {
    if (snapshot?.kind === "text") {
      textBlobIds.add(snapshot.oid);
    }
  }
}

// Recreate only this fixed build directory so stale files cannot enter a later deployment.
await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, "blobs"), { recursive: true });

// Deliberately copy an allowlist, never the repository or even the entire example folder.
await Promise.all([
  ...["index.html", "styles.css", "app.js"].map((file) =>
    copyFile(resolve(viewerRoot, file), resolve(outputRoot, file)),
  ),
  ...["manifest.json", "lesson.json"].map((file) =>
    copyFile(resolve(exampleRoot, file), resolve(outputRoot, file)),
  ),
  ...Array.from(textBlobIds, (oid) =>
    copyFile(
      resolve(exampleRoot, "blobs", oid + ".txt"),
      resolve(outputRoot, "blobs", oid + ".txt"),
    ),
  ),
]);

console.log(`Packaged the greeting demo in ${outputRoot}`);
