import { cp, mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");

const requiredFiles = ["manifest.json", "background.js", "contentScript.js"];

for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    throw new Error(`Missing required file: ${file}`);
  }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of requiredFiles) {
  await cp(path.join(root, file), path.join(distDir, file));
}

await cp(path.join(root, "icons"), path.join(distDir, "icons"), {
  recursive: true,
});

console.log("Build complete: dist/");

