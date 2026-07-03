---
name: run-metaforce
description: >-
  Build, run, screenshot, and smoke-test the MetaForce browser extension. Use
  when asked to run, launch, start, build, screenshot, or visually check
  MetaForce — especially its in-page panel / All Data UI. MetaForce is a
  Manifest V3 extension (no `npm start`); this drives its UI headlessly via a
  committed driver.
---

# Run MetaForce

MetaForce is a Manifest V3 extension (Chrome + Edge). Its UI lives in a **closed
shadow root injected only on Salesforce pages**, so there is no `npm start` and
no window to open — and the popup/options pages need the live `chrome.*` runtime.
The reliable way to _see and verify the UI_ is the committed driver:
**`.claude/skills/run-metaforce/driver.mjs`** regenerates the real content-script
stylesheets into a standalone page (via `scripts/make-harness.mjs`) and
screenshots it in light + dark with headless Chrome — no Salesforce org, no
extension install.

All paths below are relative to the repo root.

## Prerequisites

- **Node** (built/tested here on v26; ≥18 is fine) — `npm install` once.
- **A Chrome/Chromium binary.** On macOS the driver auto-finds
  `/Applications/Google Chrome.app` (or Edge/Chromium). In a Linux container:
  `apt-get install -y chromium` and pass `CHROME_BIN=/usr/bin/chromium`.

## Run (agent path) — screenshot the UI

```bash
node .claude/skills/run-metaforce/driver.mjs
```

Output (≈3s, exits 0):

```
/Users/.../scripts/.harness.html
✓ /Users/.../scripts/.harness-shots/harness.png (339 KB)  [chrome: /Applications/Google Chrome.app/...]
```

The PNG lands at **`scripts/.harness-shots/harness.png`** (gitignored) — the
MetaForce panel + All Data table, light and dark, rendered from the _live_
`contentScript.js` stylesheets. Open/Read it to verify the UI. Override the
browser with `CHROME_BIN=/path/to/chromium node .claude/skills/run-metaforce/driver.mjs`.

## Build / package

```bash
npm run build          # dist/ + per-store zips in build/{chrome,edge}
```

Produces `dist/` (the unpacked extension) and
`build/{chrome,edge}/metaforce-v<ver>-<store>.zip`.

## Test

```bash
npm test               # jest — 52 tests across 7 suites
npm run validate       # check:versions + eslint + jest (the pre-push gate)
```

## Run (human path) — load the real extension

The driver renders the UI but not the live data path. To exercise the actual
extension end-to-end you need a real Salesforce org:

1. `npm run build`, then in Chrome/Edge open `chrome://extensions`, enable
   **Developer mode**, **Load unpacked** → select `dist/`.
2. Sign in to a Salesforce org and open any record
   (`.../lightning/r/Account/<id>/view`).
3. Toggle the panel: **Ctrl+Shift+M** (configurable in Options), or click the floating trigger button.

(Releasing to the stores is a separate concern — see the `store-release` skill.)

## Gotchas

- **`npm start` does not exist and would be meaningless** — the UI only exists as
  an injected shadow root on Salesforce domains (`host_permissions` in
  `manifest.json`). Don't look for a dev server.
- **popup/options pages hang headless Chrome.** `popup/popup.html` and
  `options/options.html` depend on `chrome.storage`/messaging; loaded as
  `file://` they never fire load and Chrome hangs. The driver deliberately
  screenshots only the harness. To see popup/options, use the human path
  (loaded extension).
- **Headless Chrome (macOS, `--headless=new`) often does not self-exit after
  `--screenshot`.** The driver polls for the PNG and `SIGKILL`s Chrome the moment
  it lands — that's why it returns in ~3s instead of hanging. If you call Chrome
  by hand, wrap it with your own timeout.
- **The harness tracks real UI changes** — `scripts/make-harness.mjs` extracts
  the three stylesheets by string-matching markers in `contentScript.js`
  (`STYLE_ELEMENT_ID`, `metaforce-theme-style`, `metaforce-alldata-style`). If
  you rename those markers, the harness build throws `marker not found` — update
  the script to match.

## Troubleshooting

- **`No Chrome/Chromium found`** → set `CHROME_BIN` to a real browser binary
  (`CHROME_BIN="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"`
  also works).
- **`marker not found: …`** from the harness step → a stylesheet marker in
  `contentScript.js` was renamed; fix the marker strings in
  `scripts/make-harness.mjs`.
- **`✗ screenshot failed`** → usually a stray headless Chrome holding the profile;
  `pkill -f "Chrome.*--headless"` and re-run.
