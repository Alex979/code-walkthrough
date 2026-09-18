import { expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import type { Lesson } from "../skills/code-walkthrough/scripts/types";

function waitForServer(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const timer = setTimeout(() => {
      reject(new Error(`Server did not become ready: ${output}\n${errors}`));
    }, 10000);

    child.stderr!.on("data", (chunk) => {
      errors += chunk.toString();
    });
    child.stdout!.on("data", (chunk) => {
      output += chunk.toString();
      const match = /Local: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited (${code}): ${errors}`));
    });
  });
}

test("copied and linked packages run the Node CLI without Bun, TypeScript or the development repo", async () => {
  const node = Bun.which("node");
  if (!node) {
    throw new Error("Package tests require Node.js 22+ on PATH.");
  }

  const root = await mkdtemp(join(tmpdir(), "walkthrough-package-"));
  try {
    const installed = join(root, "installed package", "code-walkthrough");
    await cp(resolve(import.meta.dir, "../skills/code-walkthrough"), installed, {
      recursive: true,
    });
    expect(existsSync(join(installed, "scripts/types.ts"))).toBe(true);
    // The schema and source travel with the skill, but executing the package must
    // not depend on TypeScript support or accidentally read maintained source.
    for (const entry of await readdir(join(installed, "scripts"))) {
      if (entry.endsWith(".ts")) {
        await unlink(join(installed, "scripts", entry));
      }
    }

    const linked = join(root, "linked package");
    await symlink(installed, linked, process.platform === "win32" ? "junction" : "dir");
    const source = join(root, "source");
    const elsewhere = join(root, "elsewhere");
    await mkdir(source);
    await mkdir(elsewhere);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Package Test",
      GIT_AUTHOR_EMAIL: "package@example.invalid",
      GIT_COMMITTER_NAME: "Package Test",
      GIT_COMMITTER_EMAIL: "package@example.invalid",
    };
    // Remove Bun from the actual child environment, including Windows' Path
    // spelling. Node is invoked by absolute path; Git retains its normal PATH.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "path") {
        env[key] = (env[key] ?? "")
          .split(delimiter)
          .filter(
            (entry) => !existsSync(join(entry, process.platform === "win32" ? "bun.exe" : "bun")),
          )
          .join(delimiter);
      }
    }
    const run = (executable: string, args: string[], cwd = elsewhere): string => {
      const result = spawnSync(executable, args, {
        cwd,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      });
      if (result.error || result.status !== 0) {
        throw new Error(result.error?.message || result.stderr || result.stdout);
      }
      return result.stdout;
    };
    const git = (...args: string[]) =>
      run(
        "git",
        ["-c", "core.hooksPath=" + join(root, "no-hooks"), "-c", "commit.gpgsign=false", ...args],
        source,
      );
    expect(spawnSync("bun", ["--version"], { cwd: elsewhere, env }).error).toBeDefined();
    git("init", "-b", "main");
    await writeFile(join(source, "greeting.ts"), 'export const greeting = "Hello";\n');
    git("add", ".");
    git("commit", "-m", "feat: add greeting");

    for (const [index, skillRoot] of [installed, linked].entries()) {
      const artifact = join(root, "artifact " + index);
      run(node, [
        join(skillRoot, "scripts/capture.mjs"),
        "--repo",
        source,
        "--out",
        artifact,
        "--commit",
        "HEAD",
      ]);
      const lesson: Lesson = {
        schemaVersion: 1,
        title: "Add a greeting",
        chapters: [{ id: "greeting", title: "Build the greeting", start: "greeting" }],
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
      };
      await writeFile(join(artifact, "lesson.json"), JSON.stringify(lesson));
      expect(run(node, [join(skillRoot, "scripts/validate.mjs"), artifact])).toContain(
        "Valid artifact:",
      );
      expect(
        run(node, [join(skillRoot, "scripts/validate.mjs"), artifact, "--presentation"]),
      ).toContain("Presentation checked: 1 text comparisons; 0 coarse comparisons.");
      expect(run(node, [join(skillRoot, "scripts/review.mjs"), artifact])).toContain("greeting");
      const teachingReview = run(node, [
        join(skillRoot, "scripts/review.mjs"),
        artifact,
        "--step",
        "greeting",
        "--all",
      ]);
      expect(teachingReview).toContain("The new module exports the greeting.");
      expect(teachingReview).toContain('export const greeting = "Hello";');
      expect(existsSync(join(skillRoot, "package.json"))).toBe(false);
      expect(existsSync(join(skillRoot, "node_modules"))).toBe(false);
      expect(existsSync(join(skillRoot, "viewer"))).toBe(false);

      const server = spawn(node, [join(skillRoot, "scripts/serve.mjs"), artifact, "--port", "0"], {
        cwd: elsewhere,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      try {
        const base = await waitForServer(server);
        const manifest = await (await fetch(base + "/manifest.json")).json();
        for (const route of [
          "/",
          "/app.js",
          "/styles.css",
          "/lesson.json",
          "/blobs/" + manifest.files[0].head.oid + ".txt",
        ]) {
          const response = await fetch(base + route);
          expect(response.status).toBe(200);
          expect((await response.text()).length).toBeGreaterThan(0);
        }
        const head = await fetch(base + "/app.js", { method: "HEAD" });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe("");
        expect((await fetch(base + "/private.txt")).status).toBe(404);
      } finally {
        if (server.exitCode === null && server.signalCode === null) {
          const exited = once(server, "exit");
          server.kill("SIGTERM");
          await exited;
        }
      }

      // Serving must fail before listening when authored state doesn't reach head.
      lesson.steps[0].changes!["greeting.ts"] = { text: "incorrect" };
      await writeFile(join(artifact, "lesson.json"), JSON.stringify(lesson));
      const rejected = spawnSync(
        node,
        [join(skillRoot, "scripts/serve.mjs"), artifact, "--port", "0"],
        {
          cwd: elsewhere,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
        },
      );
      expect(rejected.error).toBeUndefined();
      expect(rejected.status).toBe(1);
      expect(rejected.stdout).not.toContain("Local:");
      expect(rejected.stderr).toContain("head");
    }
  } finally {
    if (dirname(root) !== tmpdir() || !basename(root).startsWith("walkthrough-package-")) {
      throw new Error("Unsafe cleanup path");
    }
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}, 40000);
