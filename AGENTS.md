# AGENTS Guide for MetaForce

## Project snapshot

- Browser extension (Manifest V3, compatible with **Chrome and Edge**) that shows Salesforce record metadata in-page.
- Runtime pieces are intentionally minimal: one background service worker, one content script, and one offscreen document (`offscreen.html` / `offscreen.js`) for clipboard support.
- Repo includes an npm workflow (`package.json`) with Node scripts for `clean`, `lint`, `test`, `build`, and `package`; extension runtime sources still live in repo root and are copied to `dist/` for packaging.

## Architecture and data flow

- Entry wiring lives in `manifest.json`:
  - `background.service_worker` -> `background.js`
  - `content_scripts[*].js` -> `contentScript.js` (`run_at: "document_idle"`)
  - `action.default_popup` -> `popup/popup.html`; `options_ui.page` -> `options/options.html`
  - permissions: `cookies`, `clipboardWrite`, `offscreen`, `storage` + Salesforce host patterns
  - `default_locale: "en"`; `name`/`description` are `__MSG_*__` tokens resolved from `_locales/en/messages.json`
- `contentScript.js` watches SPA navigation (`MutationObserver` on `document.body`), extracts `{ objectType, recordId }` from Lightning URLs, then requests metadata via `chrome.runtime.sendMessage`. An **initial bootstrap block** runs once after the observer is attached to handle the case where the page is already stable at `document_idle` (no DOM mutation would otherwise fire).
- `background.js` resolves Salesforce `sid` cookie for the active org (tries `salesforce.com`, then `cloudforce.com`), calls REST `describe` + record endpoints, and returns a field map.
- Content script converts response into table rows (`prepareTableData`) and renders a floating search UI (`createSearchBox`) for field/value lookup. The `filterRows` helper matches against **both field API name and stringified value** (case-insensitive).
- `mainLogic` brackets the async fetch with `showLoadingIndicator()` / `hideLoadingIndicator()` and shows `showStatusNotice(msg, kind)` on error or empty results (auto-dismisses after 8 s).
- All MetaForce UI elements live inside a **closed Shadow DOM** (`<mf-ext-root>` attached to `<html>`, not `<body>`). This isolates our DOM mutations from Salesforce's MutationObservers, preventing "Permissions policy violation: unload" warnings.
- UI includes **dark mode** support via `@media (prefers-color-scheme: dark)` in the injected `<style>`. When adding or modifying CSS, always include matching dark-mode overrides.
- UI elements carry **ARIA attributes** (`role="combobox"`, `role="listbox"`, `role="option"`, `aria-expanded`, `aria-activedescendant`) and support **keyboard navigation** (ArrowUp/Down to cycle results, Enter to select, Escape to close). Preserve these when modifying UI code.
- **Clipboard copy flow** (two-tier fallback):
  1. Content script `copyToClipboard()` first tries `navigator.clipboard.writeText()` (works when user gesture is active and page Permissions-Policy allows it).
  2. Delegates to the background service worker via `{ action: "copyToClipboard", text }`. Background always spins up an offscreen document (`offscreen.html` → `offscreen.js`) and delegates via `document.execCommand("copy")` there.
  - **Why not `execCommand` in the content script?** A failed `navigator.clipboard.writeText()` consumes the transient user activation, so a subsequent `execCommand("copy")` would return `false`. It also calls `textarea.focus()`, stealing focus from the shadow-DOM search input.
  - **Why not `navigator.clipboard` in the background service worker?** It can resolve without actually writing to the clipboard because service workers are never focused.

## Message contracts (keep stable)

- Actions handled in `background.js` listener:
  - `CONTENT_SCRIPT_LOADED` -> ack only
  - `fetchMetadata` and `handleUrlChange` -> invoke `handleFetchMetadata`
  - `updateField` -> `handleUpdateField` (PATCH a single field; gated on the `enableInlineEdit` setting)
  - `copyToClipboard` -> attempt `navigator.clipboard`, then fallback to offscreen document
  - Messages with `message.target === "offscreen"` are ignored by background (passed through to offscreen listener)
- Request payload shape used by content script:
  - `{ action, objectType, recordId, baseUrl }`
- Clipboard request from content script / background → offscreen:
  - `{ action: "copyToClipboard", text }` (content→background)
  - `{ target: "offscreen", action: "copyToClipboard", text }` (background→offscreen)
  - Response: `{ ok: true }` or `{ ok: false, error: string }`
- Update request from content script (inline edit):
  - `{ action: "updateField", objectType, recordId, fieldName, value, baseUrl }`
  - Response: `{ ok: true }` or `{ error: string }`
- Response shape expected by `prepareTableData`:
  - success: `{ data: { [fieldName]: { type, value, label, updateable, referenceTo, nillable } } }`
    (the All Data tab uses the enriched keys; the Search tab only needs `type`/`value`)
  - error: `{ error: string }` (or `null` in current cookie-miss branches)

## Project-specific conventions and gotchas

- API version is configurable via the options page and defaults to `DEFAULT_API_VERSION = "v67.0"` in `background.js` (read from `chrome.storage.sync["metaforceSettings"].apiVersion`).
- The floating panel is **tabbed**: a **Search** tab (the original field/value search) and an **All Data** tab (full field table with filter, hide-empty, reference navigation, and optional inline edit). The All Data tab is gated on `enableAllData`; inline edit on `enableInlineEdit` (default off — it writes to live records). All Data styles live in their own `<style>` (`ensureAllDataStyles`, id `metaforce-alldata-style`).
- Settings/favorites/helpers live in **`mf_shared.js`** (global `MF`), the single source of truth shared by every context: it is listed first in `content_scripts` (sets `self.MF`), pulled into the service worker via `importScripts("mf_shared.js")` at the top of `background.js`, and loaded via `<script src="../mf_shared.js">` in the popup/options pages. Settings (`metaforceSettings` in `chrome.storage.sync`): `theme`, `density`, `apiVersion`, `enableAllData`, `enableInlineEdit`.
- Theme/density are applied as classes on the shadow host (`applyHostTheme`); the token stylesheet (`ensureThemeStyles`, `:host` design tokens) is the single source of visual design — light by default, dark via `prefers-color-scheme` (unless forced) and `:host(.mf-theme-dark)`. There is no hardcoded dark `@media` block anymore.
- All Data extras: color-coded type chips (`MF.fieldKind`), pin/favorite fields (`metaforceFavorites`, persisted per object, sorted to top), per-row copy, and JSON/CSV export (`MF.recordToJson`/`recordToCsv`; CSV downloads via a temporary `<a download>` on `document.documentElement`, same shadow-DOM constraint as the clipboard textarea).
- Keyboard command `toggle-panel` (Ctrl/Cmd+Shift+M): `background` `chrome.commands.onCommand` → `tabs.sendMessage({action:"togglePanel"})` → content script clicks the trigger / header-close.
- URL parsing is Lightning-specific: `/lightning/r/<Object>/<15-18 char id>/view` (`extractObjectTypeFromURL`).
- UI state is global in content script (`globalTableData`, `lastUrl`, `lastRecordId`); URL changes must call `removeSearchBox()` and reset globals.
- `detachOutsideCloseHandler` holds a cleanup function for the outside-click listener; `statusTimerId` holds the auto-dismiss timer for status notices. Both are cleared inside `removeSearchBox()` — always call it on route changes.
- CSS ID constants (`STYLE_ELEMENT_ID`, `STATUS_ELEMENT_ID`, `LOADER_ELEMENT_ID`) guard against duplicate style/status/loader elements in the shadow root; never bypass these checks.
- Background async messaging relies on `return true` in the listener for metadata actions; do not remove.
- Cookie lookup depends on `sender.tab.cookieStoreId`; it is threaded through `handleFetchMetadata` → `fetchObjectMetadata` → `getAuthToken`. Preserve this when refactoring cookie access.
- `requestToken` in content script guards against stale responses after rapid SPA navigation; always increment before async calls and check before rendering.
- `_creatingOffscreen` in `background.js` is a singleton guard to prevent duplicate offscreen document creation; do not remove.
- `navigator.clipboard.writeText()` does **not** work in offscreen documents (never focused); `document.execCommand("copy")` is the only mechanism there.
- `document.execCommand("copy")` cannot see selections inside a closed Shadow DOM — never place the copy textarea in `mfRoot`; attach it to `document.documentElement` instead.
- `chrome.runtime.getContexts()` (Chrome/Edge 116+) and `chrome.offscreen` (Chrome/Edge 109+) are guarded with availability checks in `ensureOffscreenDocument()` for cross-browser safety; keep those guards when refactoring.

## Working and debugging workflow

- Load as an unpacked extension from project root for direct source iteration, or from `dist/` after `npm run build`.
- Run `npm test` after changes; it runs the jest suite in `tests/*.test.js` (jsdom). Each test mirrors a pure slice of the runtime logic.
- Run `npm run lint` (ESLint 9 flat config) and `npm run format` (Prettier). `npm run validate` runs lint + test and is the pre-push hook.
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
- If adding or removing runtime files, update `requiredFiles` (flat files) or `requiredDirs` (directories: `icons`, `popup`, `options`, `_locales`) in `scripts/build.mjs` so they are included in `dist/`.
- `build.sh` wraps `scripts/build.mjs` and produces per-store zips (`build/chrome`, `build/edge`). MetaForce has **no bundler step** — runtime sources are plain scripts copied verbatim.
