import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Manifest } from "../skills/code-walkthrough/scripts/types";

test("demo packaging publishes only validated example data and portable viewer assets", async () => {
  const repositoryRoot = resolve(import.meta.dir, "..");
  const fixtureRoot = await mkdtemp(join(tmpdir(), "walkthrough-demo-"));
  const skillPath = "skills/code-walkthrough";
  const exampleRoot = join(fixtureRoot, skillPath, "examples/greeting");
  const outputRoot = join(fixtureRoot, "dist/demo");

  try {
    // A copied checkout with no dependencies also proves paths do not depend on cwd.
    for (const path of [
      "scripts/package-demo.ts",
      `${skillPath}/scripts/validate.mjs`,
      `${skillPath}/assets/viewer`,
      `${skillPath}/examples/greeting`,
    ]) {
      await cp(join(repositoryRoot, path), join(fixtureRoot, path), { recursive: true });
    }
    await mkdir(outputRoot, { recursive: true });
    await writeFile(join(outputRoot, "stale.txt"), "Old output must not be published.");
    await writeFile(join(exampleRoot, "notes.txt"), "Author notes must not be published.");
    await writeFile(join(exampleRoot, "blobs/unreferenced.txt"), "Unreferenced data.");

    const run = () =>
      spawnSync(process.execPath, [join(fixtureRoot, "scripts/package-demo.ts")], {
        cwd: repositoryRoot,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      });
    const result = run();
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Presentation checked:");
    expect((await readdir(outputRoot)).sort()).toEqual([
      "app.js",
      "blobs",
      "index.html",
      "lesson.json",
      "manifest.json",
      "styles.css",
    ]);

    const manifest = JSON.parse(
      await readFile(join(outputRoot, "manifest.json"), "utf8"),
    ) as Manifest;
    const expectedBlobs = new Set(
      manifest.files.flatMap((file) =>
        [file.base, file.head]
          .filter((snapshot) => snapshot?.kind === "text")
          .map((snapshot) => snapshot!.oid + ".txt"),
      ),
    );
    expect((await readdir(join(outputRoot, "blobs"))).sort()).toEqual([...expectedBlobs].sort());

    const html = await readFile(join(outputRoot, "index.html"), "utf8");
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !path.startsWith("data:"));
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      const url = new URL(asset, "https://example.invalid/code-walkthrough/");
      expect(url.pathname).toStartWith("/code-walkthrough/");
      expect(
        await readFile(join(outputRoot, url.pathname.slice("/code-walkthrough/".length))),
      ).not.toHaveLength(0);
    }

    // Invalid teaching data must stop deployment before replacing the previous output.
    const previousLesson = await readFile(join(outputRoot, "lesson.json"), "utf8");
    await writeFile(join(exampleRoot, "lesson.json"), "{}");
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("The bundled example failed validation");
    expect(await readFile(join(outputRoot, "lesson.json"), "utf8")).toBe(previousLesson);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
