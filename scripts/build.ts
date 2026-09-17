import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const out = resolve(root, "assets/viewer");
await mkdir(out, { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(root, "viewer/src/app.ts")], outdir: out, target: "browser" });
if (!result.success) { console.error(result.logs); process.exit(1); }
await Promise.all(["index.html", "styles.css"].map(file => copyFile(resolve(root, "viewer", file), resolve(out, file))));
console.log("Built the reusable viewer.");
