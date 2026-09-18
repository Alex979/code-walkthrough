import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve symlinks on both sides so copied and linked installations behave alike. */
export function isMainModule(moduleUrl: string, entryPath = process.argv[1]): boolean {
  if (!entryPath) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

export function requireSupportedRuntime(version = process.versions.node): void {
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(
      `Node.js 22 or newer is required (found ${version}). Install a supported Node.js LTS release from https://nodejs.org/ and retry. No npm install is needed.`,
    );
  }
}
