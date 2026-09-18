import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule, requireSupportedRuntime } from "../skills/code-walkthrough/scripts/runtime";

test("runtime checks accept the minimum Node version and explain unsupported versions", () => {
  expect(() => requireSupportedRuntime("22.0.0")).not.toThrow();
  expect(() => requireSupportedRuntime("24.0.0")).not.toThrow();
  expect(() => requireSupportedRuntime("20.19.0")).toThrow("Node.js 22 or newer");
  expect(() => requireSupportedRuntime("20.19.0")).toThrow("https://nodejs.org/");
});

test("entrypoint detection follows linked installations and ignores imported modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "walkthrough-runtime-"));
  try {
    const installed = join(directory, "installed skill");
    const linked = join(directory, "linked skill");
    await mkdir(installed);
    const entrypoint = join(installed, "serve.mjs");
    const importedModule = join(installed, "runtime.mjs");
    await writeFile(entrypoint, "");
    await writeFile(importedModule, "");
    await symlink(installed, linked, process.platform === "win32" ? "junction" : "dir");
    expect(isMainModule(pathToFileURL(entrypoint).href, join(linked, "serve.mjs"))).toBe(true);
    expect(isMainModule(pathToFileURL(importedModule).href, entrypoint)).toBe(false);
    expect(isMainModule(pathToFileURL(entrypoint).href, join(directory, "missing.mjs"))).toBe(
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
