# MetaForce

MetaForce is a Manifest V3 browser extension that displays Salesforce record metadata directly in Lightning record pages.

## NPM workflow

```bash
npm install
npm run test
npm run build
npm run package
```

## Scripts
- `npm run test`: runs `test/UrlParserTest.js`
- `npm run build`: copies extension runtime files into `dist/`
- `npm run package`: creates a zip in `build/` using `dist/`
- `npm run clean`: removes `dist/` and `build/`

## Load extension locally
1. Open Chromium extension settings.
2. Enable developer mode.
3. Load unpacked from this project root for development, or from `dist/` after `npm run build`.

