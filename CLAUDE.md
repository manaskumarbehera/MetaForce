# CLAUDE.md — MetaForce

Working notes for Claude Code in this repo. The authoritative architecture and
gotchas live in **[AGENTS.md](./AGENTS.md)** — read it first. This file is the
quick-start and the rules that are easy to forget.

## What this is

A Manifest V3 browser extension (Chrome + Edge) that shows Salesforce record
metadata in-page. Runtime pieces: one background service worker
(`background.js`), one content script (`contentScript.js`), and an offscreen
document (`offscreen.html` / `offscreen.js`) for clipboard. A popup
(`popup/`) and an options page (`options/`) provide status and settings.

## Commands

```bash
npm install        # install dev tooling (eslint, prettier, husky, jest)
npm run lint       # eslint (flat config)
npm run format     # prettier --write
npm test           # jest (tests/*.test.js)
npm run validate   # lint + test (also runs on pre-push)
npm run build      # ./build.sh -> dist/ + per-store zips in build/{chrome,edge}
npm run build:staging   # node scripts/build.mjs -> dist/ only (no zip)
```

Husky runs `lint-staged` on pre-commit and `npm run validate` on pre-push.

## Rules that bite (see AGENTS.md for the why)

- **All UI lives in the closed shadow root `mfRoot`.** Never append MetaForce
  elements to `document.body`. The one exception is the clipboard textarea,
  which must attach to `document.documentElement` (execCommand can't see
  selections inside a closed shadow root).
- **Every new CSS rule needs a matching dark-mode override**
  (`@media (prefers-color-scheme: dark)`).
- **New interactive UI needs ARIA + keyboard nav** (tabs, table rows, edit
  inputs) — match the existing combobox/listbox pattern.
- **Message contracts are stable** — see AGENTS.md "Message contracts". The
  background returns `{ data: { [field]: { type, value, label, updateable,
referenceTo, nillable } } }`; `prepareTableData` depends on that shape.
- API version is configurable via the options page and defaults to `v67.0`
  (`DEFAULT_API_VERSION` in `background.js`).
- If you add or remove a runtime file, update `requiredFiles` in
  `scripts/build.mjs` so it ships in `dist/`.
- Inline editing in the All Data tab **writes to live Salesforce records** via
  PATCH. It is off by default and gated behind an options toggle.

## Tests

`tests/*.test.js` (jest, jsdom). Each test mirrors a pure slice of the runtime
logic (URL parsing, search filter, error parsing, clipboard handler, metadata
enrichment, PATCH-body construction). The live write path can only be fully
verified against a real org — unit tests cover body construction, not the
round-trip.
