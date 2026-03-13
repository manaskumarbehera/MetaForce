# AGENTS Guide for MetaForce

## Project snapshot
- Browser extension (Manifest V3) that shows Salesforce record metadata in-page.
- Runtime pieces are intentionally minimal: one background service worker and one content script.
- Repo includes an npm workflow (`package.json`) with Node scripts for `test`, `build`, and `package`; extension runtime sources still live in repo root and are copied to `dist/` for packaging.

## Architecture and data flow
- Entry wiring lives in `manifest.json`:
  - `background.service_worker` -> `background.js`
  - `content_scripts[*].js` -> `contentScript.js`
  - permissions: `cookies` + Salesforce host patterns
- `contentScript.js` watches SPA navigation (`MutationObserver` on `document.body`), extracts `{ objectType, recordId }` from Lightning URLs, then requests metadata via `chrome.runtime.sendMessage`.
- `background.js` resolves Salesforce `sid` cookie for the active org (tries `salesforce.com`, then `cloudforce.com`), calls REST `describe` + record endpoints, and returns a field map.
- Content script converts response into table rows (`prepareTableData`) and renders a floating search UI (`createSearchBox`) for field/value lookup.

## Message contracts (keep stable)
- Actions handled in `background.js` listener:
  - `CONTENT_SCRIPT_LOADED` -> ack only
  - `fetchMetadata` and `handleUrlChange` -> invoke `handleFetchMetadata`
- Request payload shape used by content script:
  - `{ action, objectType, recordId, baseUrl }`
- Response shape expected by `prepareTableData`:
  - success: `{ data: { [fieldName]: { type, value } } }`
  - error: `{ error: string }` (or `null` in current cookie-miss branches)

## Project-specific conventions and gotchas
- API version is hardcoded in `background.js` as `API_VERSION = "v58.0"`; update intentionally if Salesforce API changes.
- URL parsing is Lightning-specific: `/lightning/r/<Object>/<15-18 char id>/view` (`extractObjectTypeFromURL`).
- UI state is global in content script (`globalTableData`, `lastUrl`, `lastRecordId`); URL changes must call `removeSearchBox()` and reset globals.
- Background async messaging relies on `return true` in the listener for metadata actions; do not remove.
- Cookie lookup depends on `sender.tab.cookieStoreId`; preserve this when refactoring cookie access.

## Working and debugging workflow
- Load as an unpacked extension from project root for direct source iteration, or from `dist/` after `npm run build`.
- Run `npm run test` (`test/UrlParserTest.js`) after URL parsing changes; this is the only automated coverage in the repo.
- Validate on Salesforce Lightning record pages; verify search icon appears and field lookup works.
- Useful debug points:
  - Content script logs around URL detection and message send failures (`chrome.runtime.lastError`).
  - Service worker console for cookie resolution and REST failures.
- Use `npm run build` to stage files into `dist/`, then `npm run package` to create `build/metaforce-v<manifest.version>.zip`.

## Safe change boundaries
- If editing `manifest.json`, keep host permissions aligned with cookie lookup domains.
- If editing `background.js`, keep response schema compatible with `prepareTableData`.
- If editing `contentScript.js`, avoid creating duplicate UI roots (`mainContainer`, `searchContainer`) and ensure observer cleanup on unload.
