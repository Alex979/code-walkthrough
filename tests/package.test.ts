import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";

test("a whole-directory installation captures, validates and serves without the development repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "walkthrough-package-"));
  try {
    const installed = join(root, "installed", "code-walkthrough");
    await cp(resolve(import.meta.dir, "../skills/code-walkthrough"), installed, {
      recursive: true,
    });
    const source = join(root, "source"),
      artifact = join(root, "artifact"),
      elsewhere = join(root, "elsewhere");
    await mkdir(source);
    await mkdir(elsewhere);
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Package Test",
      GIT_AUTHOR_EMAIL: "package@example.invalid",
      GIT_COMMITTER_NAME: "Package Test",
      GIT_COMMITTER_EMAIL: "package@example.invalid",
    };
    const run = (args: string[], cwd = elsewhere): string => {
      const result = Bun.spawnSync(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString() || result.stdout.toString());
      }
      return result.stdout.toString();
    };
    const git = (...args: string[]) =>
      run(
        [
          "git",
          "-c",
          "core.hooksPath=" + join(root, "no-hooks"),
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        source,
      );
    git("init", "-b", "main");
    await Bun.write(join(source, "greeting.ts"), 'export const greeting = "Hello";\n');
    git("add", ".");
    git("commit", "-m", "feat: add greeting");
    run([
      process.execPath,
      join(installed, "scripts/capture.ts"),
      "--repo",
      source,
      "--out",
      artifact,
      "--commit",
      "HEAD",
    ]);
    await Bun.write(
      join(artifact, "lesson.json"),
      JSON.stringify({
        schemaVersion: 1,
        title: "Add a greeting",
        steps: [
          {
            id: "greeting",
            title: "Define the greeting",
            file: "greeting.ts",
            focus: [1, 1],
            paragraphs: [["The new module exports the greeting."]],
            changes: { "greeting.ts": { use: "head" } },
          },
        ],
      }),
    );
    expect(run([process.execPath, join(installed, "scripts/validate.ts"), artifact])).toContain(
      "Valid artifact:",
    );
    expect(existsSync(join(installed, "package.json"))).toBe(false);
    expect(existsSync(join(installed, "viewer"))).toBe(false);
    expect(existsSync(join(installed, "scripts/types.ts"))).toBe(true);
    // Run the HTTP check in a separate Bun process so imports cannot reuse repo modules.
    const check = `
      const { createServer } = await import(${JSON.stringify(pathToFileURL(join(installed, "scripts/serve.ts")).href)});
      const server = createServer(${JSON.stringify(artifact)}, 0);
      try {
        const base = "http://127.0.0.1:" + server.port;
        const manifest = await (await fetch(base + "/manifest.json")).json();
        const routes = [
          "/",
          "/app.js",
          "/styles.css",
          "/lesson.json",
          "/blobs/" + manifest.files[0].head.oid + ".txt",
        ];
        for (const route of routes) {
          const response = await fetch(base + route);
          if (!response.ok || !(await response.text()).length) {
            throw new Error("Failed: " + route);
          }
        }
        console.log("Independent package served successfully");
      } finally {
        server.stop(true);
      }
    `;
    expect(run([process.execPath, "-e", check])).toContain(
      "Independent package served successfully",
    );
  } finally {
    if (dirname(root) !== tmpdir() || !basename(root).startsWith("walkthrough-package-")) {
      throw new Error("Unsafe cleanup path");
    }
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}, 20000);
