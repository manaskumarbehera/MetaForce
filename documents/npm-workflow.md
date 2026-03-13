# NPM Test/Build/Package Workflow

This project now includes Node scripts for repeatable local workflows.

## Commands

```bash
npm install
npm run test
npm run build
npm run package
```

## Outputs
- Test output prints pass/fail lines in terminal.
- Build output directory: `dist/`
- Packaged extension zip: `build/metaforce-v<manifest.version>.zip`

## Notes
- `npm run package` expects `dist/` to exist; run `npm run build` first.
- Archive version is read from `manifest.json`.

