import { cp, mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");

// Flat runtime files copied verbatim into dist/.
const requiredFiles = [
  "manifest.json",
  "mf_shared.js",
  "background.js",
  "contentScript.js",
  "offscreen.html",
  "offscreen.js",
];

// Directories copied recursively into dist/ (extension pages, locales, icons).
const requiredDirs = ["icons", "popup", "options", "_locales"];

for (const file of [...requiredFiles, ...requiredDirs]) {
  try {
    await access(path.join(root, file));
  } catch {
    throw new Error(`Missing required path: ${file}`);
  }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of requiredFiles) {
  await cp(path.join(root, file), path.join(distDir, file));
}

for (const dir of requiredDirs) {
  await cp(path.join(root, dir), path.join(distDir, dir), { recursive: true });
}

console.log("Build complete: dist/");
