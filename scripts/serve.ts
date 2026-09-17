import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { Manifest } from "../viewer/src/types";

// Only captured data and the packaged viewer are served; never the source checkout.
export function createServer(directory: string, port = 4317) {
  const root = resolve(directory);
  const assets = resolve(import.meta.dir, "../assets/viewer");
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as Manifest;
  const blobs = new Set(manifest.files.flatMap(file => [file.base, file.head])
    .filter(info => info?.kind === "text").map(info => info!.oid));
  const allowed = new Map([
    ["/", [resolve(assets, "index.html"), "text/html; charset=utf-8"]],
    ["/index.html", [resolve(assets, "index.html"), "text/html; charset=utf-8"]],
    ["/styles.css", [resolve(assets, "styles.css"), "text/css; charset=utf-8"]],
    ["/app.js", [resolve(assets, "app.js"), "text/javascript; charset=utf-8"]],
    ["/manifest.json", [resolve(root, "manifest.json"), "application/json"]],
    ["/lesson.json", [resolve(root, "lesson.json"), "application/json"]],
  ]);
  return Bun.serve({
    hostname: "127.0.0.1", port,
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      const path = new URL(request.url).pathname;
      let entry = allowed.get(path);
      const match = path.match(/^\/blobs\/([0-9a-f]{40}|[0-9a-f]{64})\.txt$/);
      if (match && blobs.has(match[1])) entry = [resolve(root, "blobs", match[1] + ".txt"), "text/plain; charset=utf-8"];
      if (!entry || !await Bun.file(entry[0]).exists()) return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : Bun.file(entry[0]), { headers: {
        "Content-Type": entry[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      }});
    },
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (!args[0] || args.length > 3 || args.length > 1 && args[1] !== "--port") {
    console.error("Usage: bun scripts/serve.ts ARTIFACT_DIR [--port 4317]"); process.exit(1);
  }
  const port = Number(args[2] ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535.");
  // Refuse incomplete or inconsistent content before opening a viewer.
  const check = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "validate.ts"), resolve(args[0])], { stdout: "inherit", stderr: "inherit" });
  if (check.exitCode) process.exit(check.exitCode);
  const server = createServer(args[0], port);
  console.log(`Local: http://${server.hostname}:${server.port}`);
}
