# MetaForce

MetaForce is a Manifest V3 browser extension (Chrome + Edge) that displays
Salesforce record metadata directly on Lightning record pages. Open the floating
panel on any record to:

- **Search** every field by API name or value, and copy values.
- Switch to the **All Data** tab for a full field table (label, API name, type,
  value) with filtering, hide-empty, reference navigation, and optional inline
  editing.

A toolbar **popup** shows status and quick toggles; an **options** page holds
settings (theme, API version, All Data / inline-edit toggles).

## NPM workflow

```bash
npm install
npm run lint        # ESLint 9
npm run format      # Prettier
npm test            # Jest (tests/*.test.js)
npm run validate    # lint + test (pre-push hook)
npm run build       # ./build.sh -> dist/ + build/{chrome,edge} zips
```

## Scripts

- `npm test` — runs the jest suite in `tests/`.
- `npm run build` — stages runtime files into `dist/` and zips per-store packages.
- `npm run build:staging` — `dist/` only (no zip).
- `npm run package:chrome` / `package:edge` — single-target build + zip.
- `npm run clean` — removes `dist/` and `build/`.

## Load extension locally

1. Open Chromium extension settings and enable developer mode.
2. Load unpacked from this project root for development, or from `dist/` after
   `npm run build`.

## Documentation

See [DOCUMENTATION/](./DOCUMENTATION/), [AGENTS.md](./AGENTS.md), and
[CLAUDE.md](./CLAUDE.md).

> **Note on inline editing:** the All Data tab can write field changes back to
> live Salesforce records via PATCH. It is **off by default** and gated behind an
> options toggle.
