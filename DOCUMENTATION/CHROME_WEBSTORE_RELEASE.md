# Chrome Web Store release

MetaForce publishes via the official Chrome Web Store API, driven by
`scripts/release-chrome.mjs` (same mechanism as the sibling Week Number /
TrackForcePro extensions). Publish is opt-in and never happens by accident.

## One-time setup

1. **Create the store item.** In the
   [Developer Dashboard](https://chrome.google.com/webstore/devconsole), create a
   new item (you can upload the first `build/chrome/metaforce-vX.Y-chrome.zip`
   manually to register it). Copy its **32-character item ID**.
2. **OAuth client.** In Google Cloud Console → APIs & Services → Credentials,
   create an OAuth 2.0 Client ID of type **Desktop app**. Note the client id and
   secret. (A single client can manage every item owned by the same developer
   account, so this is shared across sibling extensions.)
3. **Refresh token.** Complete the OAuth consent flow once for the scope
   `https://www.googleapis.com/auth/chromewebstore` to obtain a long-lived
   refresh token.
4. **Fill `.env`.** Copy `.env.example` → `.env` and set:
   - `CHROME_EXTENSION_ID` — **MetaForce's own** item ID (never another extension's).
   - `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`.
     `.env` is gitignored — never commit it.

## Releasing

```bash
# Bump the version in manifest.json AND package.json first (npm run check:versions).
npm run release:chrome:dry       # build + upload to the draft; no submit
npm run release:chrome:publish   # build + upload + submit for review
```

The script:

1. loads `.env`, validates credentials are present (values are never printed);
2. builds the Chrome ZIP (`./build.sh chrome`);
3. refuses to re-upload a version equal to the last git tag (unless
   `--skip-version-check`);
4. verifies `manifest.json` is at the ZIP root;
5. exchanges the refresh token for an access token, uploads the ZIP, and — only
   with `--publish` — submits for review.

Review typically takes 1–3 business days.

## CI

`.github/workflows/release.yml` runs the same script on a pushed `v*` tag, using
repository **secrets** (`CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`,
`CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`). Add those under
Settings → Secrets and variables → Actions before tagging a release.
