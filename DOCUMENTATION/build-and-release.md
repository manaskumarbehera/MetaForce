# Build & release

## Tooling

- **ESLint 9** (flat config, `eslint.config.js`) — `npm run lint`.
- **Prettier** (`.prettierrc`) — `npm run format` / `format:check`.
- **Jest** (`jest.config.cjs`, jsdom) — `npm test`. Babel (`babel.config.cjs`)
  transpiles any module syntax for the runner.
- **Husky + lint-staged** — pre-commit runs `lint-staged`; pre-push runs
  `npm run validate` (lint + test).

## Build

MetaForce's runtime sources are plain scripts with no npm imports, so there is
**no bundler step**. `scripts/build.mjs` copies the required files verbatim into
`dist/`; `build.sh` wraps that and produces per-store zips.

```bash
npm run build           # ./build.sh -> dist/ + build/chrome + build/edge zips
npm run build:staging   # dist/ only (no zip)
npm run package:chrome  # ./build.sh chrome
npm run package:edge    # ./build.sh edge
```

`requiredFiles` in `scripts/build.mjs` is the source of truth for what ships.
Add new runtime files (popup, options, locales) there or they won't be packaged.

## Versioning

`manifest.json` `version` is the single source of truth; `build.sh` reads it for
the zip filename. Keep `package.json` `version` aligned for clarity.
