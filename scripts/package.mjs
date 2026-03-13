import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const buildDir = path.join(root, "build");

try {
  await stat(distDir);
} catch {
  throw new Error("dist/ not found. Run npm run build first.");
}

const manifestRaw = await readFile(path.join(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestRaw);
const version = manifest.version || "0.0.0";
const zipPath = path.join(buildDir, `metaforce-v${version}.zip`);

await mkdir(buildDir, { recursive: true });
await rm(zipPath, { force: true });

await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", resolve);
  archive.on("error", reject);

  archive.pipe(output);
  archive.directory(distDir, false);
  archive.finalize();
});

console.log(`Package complete: ${zipPath}`);

