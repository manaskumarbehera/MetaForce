# MetaForce — Privacy Policy

_Last updated: 2026-06-28_

MetaForce is a browser extension (Chrome and Microsoft Edge) that displays
Salesforce record metadata in-page while you are signed in to your own
Salesforce org.

## Summary

**MetaForce does not collect, transmit, sell, or share any personal data.**
It has no analytics, no tracking, no remote servers of its own, and no
advertising. Everything it does happens locally in your browser, talking only
to the Salesforce org you are already logged into.

## What data the extension touches, and why

- **Salesforce session (cookies).** The extension reads your existing Salesforce
  session so it can call the Salesforce REST API of the org you are viewing, on
  your behalf. The session is used only to authenticate those API calls. It is
  never stored by the extension and never sent anywhere other than your
  Salesforce org.
- **Salesforce record metadata.** When you open the panel on a record, the
  extension requests that record's field metadata (field type, label, value,
  whether it is updateable, references, etc.) directly from your Salesforce org's
  REST API. This data is shown in the panel and is not transmitted to any third
  party.
- **Your settings (storage).** Preferences such as the API version and whether
  inline editing is enabled are stored locally using the browser's extension
  storage. These never leave your browser.
- **Clipboard (clipboardWrite).** When you choose to copy a value, the extension
  writes that value to your clipboard. Nothing is read from the clipboard.

## Where data goes

The only network calls MetaForce makes are to the Salesforce org you are signed
in to (`*.salesforce.com`, `*.lightning.force.com`, `*.visualforce.com`,
`*.visual.force.com`, `*.cloudforce.com`). No data is sent to the developer or
to any third party.

## Optional inline editing

Inline editing is **off by default** and must be enabled in the extension's
Options page. When enabled, edits you make in the panel are written back to your
Salesforce records via the Salesforce REST API (a PATCH request to your org).
This is the same write you could perform in the Salesforce UI; the extension
performs it only when you explicitly edit and save a field.

## Permissions

- `cookies` — read the Salesforce session to authenticate REST API calls to your
  org.
- `storage` — save your extension preferences locally.
- `clipboardWrite` — copy a selected value to your clipboard on request.
- `offscreen` — used to perform the clipboard copy reliably.
- Host permissions for Salesforce domains — so the extension only runs on
  Salesforce pages and can call your org's API.

## Contact

Questions about this policy: behera.manas98@gmail.com
