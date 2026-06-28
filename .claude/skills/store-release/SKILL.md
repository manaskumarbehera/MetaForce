---
name: store-release
description: >-
  Release MetaForce to the Chrome Web Store and Microsoft Edge Add-ons, and
  handle certification rejections. Use when the user mentions publishing,
  releasing, store submission, certification, a rejected/failed review, Partner
  Center, the Edge/Chrome listing, reviewer test login, or "Notes for
  certification".
---

# MetaForce store release & certification

MetaForce ships to two stores. Releases are script-driven; **listing metadata
and certification fixes are mostly manual in the store dashboards.** Know the
boundary before promising to "fix" a listing — agents cannot edit Partner
Center or the Chrome dev console.

## Commands

```bash
npm run build                  # dist/ + per-store zips in build/{chrome,edge}
npm run release:edge:dry       # build + upload package to Edge draft, stop
npm run release:edge:publish   # build + upload + submit Edge for certification
# Chrome: see scripts/release-chrome.mjs (OAuth creds in .env)
```

Credentials live in `.env` (gitignored): `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`,
`EDGE_API_KEY`, and the `CHROME_*` set. Setup: `DOCUMENTATION/EDGE_ADDONS_RELEASE.md`.

## What the Edge Add-ons API can / cannot do

The Update API (v1.1) **only**: uploads the package to the draft, and submits
the draft for certification with a `notes` field. It **cannot** edit listing
metadata. **Website URL, screenshots, description, privacy/support links, and
the "Notes for certification" listing field are all manual in Partner Center.**
Same boundary for Chrome (the API publishes; the listing is edited in the dev
console).

## Certification notes (reviewer test login)

MetaForce only works **inside a logged-in Salesforce org on a record page**, so
every review needs a Salesforce test account + steps, or **1.3.1 Product is
Testable** fails. The panel opens via **Ctrl/Cmd+Shift+M** or a floating in-page
trigger button.

- Paste-ready template: `DOCUMENTATION/certification-notes.template.md`.
- `release-edge.mjs` sends notes from `EDGE_CERT_NOTES` env or
  `.edge-certification-notes.txt` (repo root, **gitignored** — the test password
  goes here, never in git).
- **Also** paste the same text into Partner Center → Availability → "Notes for
  certification" (the field the reviewer actually reads). Use both channels.

### Standing testable scenario (reuse every submission)

The live reviewer credentials (org login URL, username, **password**) are kept
**only** in `.edge-certification-notes.txt` — never in git, because this repo is
public. That file is the single source of truth; read it to find the current
test org. Before each submission: confirm the account still logs in (password
not expired, no blocking MFA), then resubmit.

The scenario the notes must walk the reviewer through (org-independent):

1. Install in Edge → sign in to the Salesforce test org (login URL from the
   notes file).
2. Open any record (App Launcher → Accounts → open one;
   URL `.../lightning/r/Account/<id>/view`).
3. Toggle the MetaForce panel: **Ctrl/Cmd+Shift+M** or the floating trigger
   button.
4. Confirm the panel lists field metadata (type, label, value, updateable,
   referenceTo); the **All Data** tab + search box exercise core functionality.
5. Note inline editing is **off by default**, gated behind the Options toggle —
   not needed to review core function.

## Handling a rejection report

Read the report; it names the failed policy. Map it, then act:

- **1.1.3 (URLs did not resolve)** — a Website/Support/Privacy URL is dead. Verify
  with `curl -IL <url>` and `nslookup <domain>` (no A record = dead). Fix in the
  store dashboard (manual). Use the public repo as the website URL:
  `https://github.com/manaskumarbehera/MetaForce`. The Website field is optional —
  leave it blank rather than point it at a domain that doesn't resolve.
- **1.3.1 (Product is Testable)** — supply/refresh the reviewer test login + steps
  (above). Confirm the account still logs in (no expired password / blocking MFA).

## Agent boundaries

- Never run `release:*:publish` unless the user explicitly asks — publishing is
  outward-facing and opt-in by design.
- Never commit `.env` or `.edge-certification-notes.txt` (real credentials).
- Agents can edit scripts/docs and verify URLs; they **cannot** edit Partner
  Center / the Chrome dev console. Give the user precise click-paths for those.
