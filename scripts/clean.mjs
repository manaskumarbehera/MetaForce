import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

await Promise.all([
  rm(path.join(root, "dist"), { recursive: true, force: true }),
  rm(path.join(root, "build"), { recursive: true, force: true }),
]);

console.log("Cleaned dist/ and build/");

