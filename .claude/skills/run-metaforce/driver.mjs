#!/usr/bin/env node
// driver.mjs — the agent "run" path for MetaForce's in-page UI.
//
// MetaForce is a Manifest V3 extension whose UI lives in a closed shadow root,
// injected only on Salesforce pages. You cannot `npm start` it. This driver
// renders the real content-script stylesheets (extracted live from
// contentScript.js by scripts/make-harness.mjs) into a standalone page and
// screenshots it in light + dark — no Salesforce org, no chrome.* runtime.
//
// Usage:
//   node .claude/skills/run-metaforce/driver.mjs           # harness -> PNG
//   CHROME_BIN=/path/to/chromium node .../driver.mjs        # override browser
//
// Output: scripts/.harness-shots/harness.png  (gitignored)
// Exit 0 + prints the PNG path on success; non-zero on failure.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", ".."); // .claude/skills/run-metaforce -> repo root
const SHOTS = path.join(ROOT, "scripts", ".harness-shots");
const HARNESS = path.join(ROOT, "scripts", ".harness.html");
const OUT = path.join(SHOTS, "harness.png");

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const fixed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  for (const c of fixed) if (existsSync(c)) return c;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execFileSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8" }).trim();
      if (p && existsSync(p)) return p;
    } catch {
      /* not on PATH */
    }
  }
  throw new Error("No Chrome/Chromium found. Install one or set CHROME_BIN=/path/to/chromium.");
}

// 1. (Re)generate the harness from the live stylesheets in contentScript.js.
execFileSync("node", [path.join(ROOT, "scripts", "make-harness.mjs")], { stdio: "inherit" });
if (!existsSync(HARNESS)) throw new Error(`harness not generated: ${HARNESS}`);

// 2. Screenshot it headless. Kill Chrome the moment the PNG lands — headless
//    Chrome on macOS often does not self-exit after --screenshot.
mkdirSync(SHOTS, { recursive: true });
const chrome = findChrome();
const profile = mkdtempSync(path.join(tmpdir(), "mf-chrome-"));
const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  "--virtual-time-budget=5000",
  `--user-data-dir=${profile}`,
  "--window-size=980,840",
  `--screenshot=${OUT}`,
  `file://${HARNESS}`,
];

const ok = await new Promise((resolve) => {
  const cp = spawn(chrome, args, { stdio: "ignore" });
  let done = false;
  const finish = (val) => {
    if (done) return;
    done = true;
    clearInterval(poll);
    clearTimeout(hard);
    try {
      cp.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    resolve(val);
  };
  const poll = setInterval(() => {
    if (existsSync(OUT) && statSync(OUT).size > 5000) finish(true);
  }, 500);
  const hard = setTimeout(() => finish(existsSync(OUT)), 45000);
  cp.on("error", () => finish(false));
});
rmSync(profile, { recursive: true, force: true });

if (!ok || !existsSync(OUT)) {
  console.error("✗ screenshot failed — no PNG produced");
  process.exit(1);
}
console.log(`✓ ${OUT} (${Math.round(statSync(OUT).size / 1024)} KB)  [chrome: ${chrome}]`);
