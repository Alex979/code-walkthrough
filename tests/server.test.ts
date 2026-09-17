import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../scripts/serve";

test("local server exposes only packaged UI and captured files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "walkthrough-server-"));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const oid = "a".repeat(40);
    await mkdir(join(directory, "blobs"));
    await Bun.write(join(directory, "manifest.json"), JSON.stringify({ schemaVersion: 1, repo: "example", base: "before", head: "after",
      files: [{ path: "a.ts", status: "A", head: { oid, kind: "text", size: 5 } }] }));
    await Bun.write(join(directory, "lesson.json"), '{"schemaVersion":1,"steps":[]}');
    await Bun.write(join(directory, "blobs", oid + ".txt"), "hello");
    await Bun.write(join(directory, "private.txt"), "not served");
    server = createServer(directory, 0);
    const url = `http://127.0.0.1:${server.port}`;
    const home = await fetch(url);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('src="/app.js"');
    expect(home.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect((await fetch(url + "/app.js")).status).toBe(200);
    expect((await fetch(url + "/lesson.json")).status).toBe(200);
    expect(await (await fetch(url + "/blobs/" + oid + ".txt")).text()).toBe("hello");
    expect((await fetch(url + "/private.txt")).status).toBe(404);
    expect((await fetch(url + "/scripts/serve.ts")).status).toBe(404);
    expect((await fetch(url + "/blobs/" + "b".repeat(40) + ".txt")).status).toBe(404);
    expect((await fetch(url + "/lesson.json", { method: "POST", body: "{}" })).status).toBe(405);
  } finally {
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
