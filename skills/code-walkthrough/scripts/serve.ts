import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Manifest } from "./types";

interface ServedFile {
  path: string;
  contentType: string;
}

/** Only captured data and packaged assets are exposed, never the source checkout. */
export function createServer(directory: string, port = 4317) {
  const artifactRoot = resolve(directory);
  const viewerRoot = resolve(import.meta.dir, "../assets/viewer");
  const manifestPath = resolve(artifactRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const textBlobIds = new Set<string>();

  for (const file of manifest.files) {
    for (const snapshot of [file.base, file.head]) {
      if (snapshot?.kind === "text") {
        textBlobIds.add(snapshot.oid);
      }
    }
  }

  const routes = new Map<string, ServedFile>([
    ["/", { path: resolve(viewerRoot, "index.html"), contentType: "text/html; charset=utf-8" }],
    [
      "/index.html",
      { path: resolve(viewerRoot, "index.html"), contentType: "text/html; charset=utf-8" },
    ],
    [
      "/styles.css",
      { path: resolve(viewerRoot, "styles.css"), contentType: "text/css; charset=utf-8" },
    ],
    [
      "/app.js",
      { path: resolve(viewerRoot, "app.js"), contentType: "text/javascript; charset=utf-8" },
    ],
    ["/manifest.json", { path: manifestPath, contentType: "application/json" }],
    [
      "/lesson.json",
      { path: resolve(artifactRoot, "lesson.json"), contentType: "application/json" },
    ],
  ]);

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }

      const requestedPath = new URL(request.url).pathname;
      let file = routes.get(requestedPath);
      const blobMatch = requestedPath.match(/^\/blobs\/([0-9a-f]{40}|[0-9a-f]{64})\.txt$/);

      // An object ID must belong to this capture; URL paths never become arbitrary disk paths.
      if (blobMatch && textBlobIds.has(blobMatch[1])) {
        file = {
          path: resolve(artifactRoot, "blobs", blobMatch[1] + ".txt"),
          contentType: "text/plain; charset=utf-8",
        };
      }

      if (!file || !(await Bun.file(file.path).exists())) {
        return new Response("Not found", { status: 404 });
      }

      const body = request.method === "HEAD" ? null : Bun.file(file.path);
      return new Response(body, {
        headers: {
          "Content-Type": file.contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    },
  });
}

function startFromCommandLine(): void {
  const args = process.argv.slice(2);
  const hasUnexpectedArguments = args.length > 3 || (args.length > 1 && args[1] !== "--port");

  if (!args[0] || hasUnexpectedArguments) {
    console.error("Usage: bun scripts/serve.ts ARTIFACT_DIR [--port 4317]");
    process.exit(1);
  }

  const directory = resolve(args[0]);
  const port = Number(args[2] ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }

  // Validate before listening so the user cannot open an incomplete lesson.
  const validation = Bun.spawnSync(
    [process.execPath, resolve(import.meta.dir, "validate.ts"), directory],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (validation.exitCode) {
    process.exit(validation.exitCode);
  }

  const server = createServer(directory, port);
  console.log("Local: http://" + server.hostname + ":" + server.port);
}

if (import.meta.main) {
  startFromCommandLine();
}
