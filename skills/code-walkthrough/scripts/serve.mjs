// skills/code-walkthrough/scripts/serve.ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// skills/code-walkthrough/scripts/runtime.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
function isMainModule(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}
function requireSupportedRuntime(version = process.versions.node) {
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error(`Node.js 22 or newer is required (found ${version}). Install a supported Node.js LTS release from https://nodejs.org/ and retry. No npm install is needed.`);
  }
}

// skills/code-walkthrough/scripts/serve.ts
var scriptDirectory = dirname(fileURLToPath2(import.meta.url));
var usage = "Usage: node scripts/serve.mjs ARTIFACT_DIR [--port 4317]";
async function createServer(directory, port = 4317) {
  const artifactRoot = resolve(directory);
  const viewerRoot = resolve(scriptDirectory, "../assets/viewer");
  const manifestPath = resolve(artifactRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const textBlobIds = new Set;
  for (const file of manifest.files) {
    for (const snapshot of [file.base, file.head]) {
      if (snapshot?.kind === "text") {
        textBlobIds.add(snapshot.oid);
      }
    }
  }
  const routes = new Map([
    ["/", { path: resolve(viewerRoot, "index.html"), contentType: "text/html; charset=utf-8" }],
    [
      "/index.html",
      { path: resolve(viewerRoot, "index.html"), contentType: "text/html; charset=utf-8" }
    ],
    [
      "/styles.css",
      { path: resolve(viewerRoot, "styles.css"), contentType: "text/css; charset=utf-8" }
    ],
    [
      "/app.js",
      { path: resolve(viewerRoot, "app.js"), contentType: "text/javascript; charset=utf-8" }
    ],
    ["/manifest.json", { path: manifestPath, contentType: "application/json" }],
    [
      "/lesson.json",
      { path: resolve(artifactRoot, "lesson.json"), contentType: "application/json" }
    ]
  ]);
  const hostname = "127.0.0.1";
  const server = createHttpServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }
    let requestedPath;
    try {
      requestedPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      response.writeHead(400);
      response.end("Invalid URL");
      return;
    }
    let file = routes.get(requestedPath);
    const blobMatch = requestedPath.match(/^\/blobs\/([0-9a-f]{40}|[0-9a-f]{64})\.txt$/);
    if (blobMatch && textBlobIds.has(blobMatch[1])) {
      file = {
        path: resolve(artifactRoot, "blobs", blobMatch[1] + ".txt"),
        contentType: "text/plain; charset=utf-8"
      };
    }
    if (!file) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    try {
      const body = await readFile(file.path);
      response.writeHead(200, {
        "Content-Type": file.contentType,
        "Content-Length": body.length
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      const code = error.code;
      const missing = code === "ENOENT" || code === "ENOTDIR";
      response.writeHead(missing ? 404 : 500);
      response.end(missing ? "Not found" : "Unable to read the requested file");
    }
  });
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.removeListener("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The local server did not receive a TCP address.");
  }
  return {
    hostname,
    port: address.port,
    stop(force = false) {
      return new Promise((resolveStopped, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
          } else {
            resolveStopped();
          }
        });
        if (force) {
          server.closeAllConnections();
        }
      });
    }
  };
}
async function startFromCommandLine() {
  requireSupportedRuntime();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(`${usage}
Use --port 0 to select a free port. Press Ctrl+C to stop.`);
    return;
  }
  const validArguments = args.length === 1 || args.length === 3 && args[1] === "--port";
  if (!validArguments || !args[0] || args[0].startsWith("--")) {
    throw new Error(usage);
  }
  const directory = resolve(args[0]);
  const port = Number(args[2] ?? 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Port must be between 0 and 65535 (0 selects a free port).");
  }
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "mjs";
  const validation = spawnSync(process.execPath, [resolve(scriptDirectory, `validate.${extension}`), directory], { stdio: "inherit", windowsHide: true });
  if (validation.error) {
    throw new Error(`Unable to start artifact validation: ${validation.error.message}`);
  }
  if (validation.status !== 0) {
    process.exitCode = validation.status ?? 1;
    return;
  }
  let server;
  try {
    server = await createServer(directory, port);
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use. Retry with --port 0 or another free port.`);
    }
    throw error;
  }
  console.log(`Local: http://${server.hostname}:${server.port}`);
  console.log("Press Ctrl+C to stop.");
  const stop = () => {
    server.stop(true).catch((error) => {
      console.error(`serve: ${error.message}`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
if (isMainModule(import.meta.url)) {
  try {
    await startFromCommandLine();
  } catch (error) {
    console.error(`serve: ${error.message}`);
    process.exitCode = 1;
  }
}
export {
  createServer
};
