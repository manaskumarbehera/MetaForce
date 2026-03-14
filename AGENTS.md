# AGENTS Guide for MetaForce

## Project snapshot
- Browser extension (Manifest V3, compatible with **Chrome and Edge**) that shows Salesforce record metadata in-page.
- Runtime pieces are intentionally minimal: one background service worker, one content script, and one offscreen document (`offscreen.html` / `offscreen.js`) for clipboard support.
- Repo includes an npm workflow (`package.json`) with Node scripts for `clean`, `lint`, `test`, `build`, and `package`; extension runtime sources still live in repo root and are copied to `dist/` for packaging.

## Architecture and data flow
- Entry wiring lives in `manifest.json`:
  - `background.service_worker` -> `background.js`
  - `content_scripts[*].js` -> `contentScript.js`
  - permissions: `cookies`, `clipboardWrite`, `offscreen` + Salesforce host patterns
- `contentScript.js` watches SPA navigation (`MutationObserver` on `document.body`), extracts `{ objectType, recordId }` from Lightning URLs, then requests metadata via `chrome.runtime.sendMessage`.
- `background.js` resolves Salesforce `sid` cookie for the active org (tries `salesforce.com`, then `cloudforce.com`), calls REST `describe` + record endpoints, and returns a field map.
- Content script converts response into table rows (`prepareTableData`) and renders a floating search UI (`createSearchBox`) for field/value lookup.
- All MetaForce UI elements live inside a **closed Shadow DOM** (`<mf-ext-root>` attached to `<html>`, not `<body>`). This isolates our DOM mutations from Salesforce's MutationObservers, preventing "Permissions policy violation: unload" warnings.
- **Clipboard copy flow** (three-tier fallback):
  1. Content script `copyToClipboard()` first tries `navigator.clipboard.writeText()` (works when user gesture is active and page Permissions-Policy allows it).
  2. Falls back to `document.execCommand("copy")` with a hidden textarea on `document.documentElement` (**not** the closed shadow root — `execCommand` cannot see selections inside closed shadow DOM; **not** `document.body` — avoids triggering Salesforce's body MutationObservers).
  3. Delegates to the background service worker via `{ action: "copyToClipboard", text }`. Background tries `navigator.clipboard.writeText()` (Chrome 121+); if unavailable, spins up an offscreen document (`offscreen.html` → `offscreen.js`) and delegates via `document.execCommand("copy")` there.

## Message contracts (keep stable)
- Actions handled in `background.js` listener:
  - `CONTENT_SCRIPT_LOADED` -> ack only
  - `fetchMetadata` and `handleUrlChange` -> invoke `handleFetchMetadata`
  - `copyToClipboard` -> attempt `navigator.clipboard`, then fallback to offscreen document
  - Messages with `message.target === "offscreen"` are ignored by background (passed through to offscreen listener)
- Request payload shape used by content script:
  - `{ action, objectType, recordId, baseUrl }`
- Clipboard request from content script / background → offscreen:
  - `{ action: "copyToClipboard", text }` (content→background)
  - `{ target: "offscreen", action: "copyToClipboard", text }` (background→offscreen)
  - Response: `{ ok: true }` or `{ ok: false, error: string }`
- Response shape expected by `prepareTableData`:
  - success: `{ data: { [fieldName]: { type, value } } }`
  - error: `{ error: string }` (or `null` in current cookie-miss branches)

## Project-specific conventions and gotchas
- API version is hardcoded in `background.js` as `API_VERSION = "v58.0"`; update intentionally if Salesforce API changes.
- URL parsing is Lightning-specific: `/lightning/r/<Object>/<15-18 char id>/view` (`extractObjectTypeFromURL`).
- UI state is global in content script (`globalTableData`, `lastUrl`, `lastRecordId`); URL changes must call `removeSearchBox()` and reset globals.
- Background async messaging relies on `return true` in the listener for metadata actions; do not remove.
- Cookie lookup depends on `sender.tab.cookieStoreId`; preserve this when refactoring cookie access.
- `requestToken` in content script guards against stale responses after rapid SPA navigation; always increment before async calls and check before rendering.
- `_creatingOffscreen` in `background.js` is a singleton guard to prevent duplicate offscreen document creation; do not remove.
- `navigator.clipboard.writeText()` does **not** work in offscreen documents (never focused); `document.execCommand("copy")` is the only mechanism there.
- `document.execCommand("copy")` cannot see selections inside a closed Shadow DOM — never place the copy textarea in `mfRoot`; attach it to `document.documentElement` instead.
- `chrome.runtime.getContexts()` (Chrome/Edge 116+) and `chrome.offscreen` (Chrome/Edge 109+) are guarded with availability checks in `ensureOffscreenDocument()` for cross-browser safety; keep those guards when refactoring.

## Working and debugging workflow
- Load as an unpacked extension from project root for direct source iteration, or from `dist/` after `npm run build`.
- Run `npm run test` after changes; it executes both `test/UrlParserTest.js` and `test/ClipboardCopyTest.js`.
- Run `npm run lint` to syntax-check all JS sources via `node --check`.
- Validate on Salesforce Lightning record pages; verify search icon appears and field lookup works.
- Useful debug points:
  - Content script logs around URL detection and message send failures (`chrome.runtime.lastError`).
  - Service worker console for cookie resolution and REST failures.
- Use `npm run build` to stage files into `dist/`, then `npm run package` to create `build/metaforce-v<manifest.version>.zip`.
- Use `npm run clean` to remove `dist/` and `build/` directories.

## Safe change boundaries
- If editing `manifest.json`, keep host permissions aligned with cookie lookup domains.
- If editing `background.js`, keep response schema compatible with `prepareTableData`.
- If editing `contentScript.js`, avoid creating duplicate UI roots (`mainContainer`, `searchContainer`), keep all UI inside the shadow root (`mfRoot`), and never append MetaForce elements directly to `document.body`.
- If adding or removing runtime files, update the `requiredFiles` list in `scripts/build.mjs` so they are included in `dist/`.
