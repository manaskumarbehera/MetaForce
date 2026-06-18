# Architecture

MetaForce is a Manifest V3 extension with four runtime surfaces plus two
extension pages.

## Runtime surfaces

- **`background.js`** — service worker. Resolves the Salesforce `sid` cookie for
  the active org, calls the REST `describe` + record endpoints, returns an
  enriched field map, performs PATCH updates, and drives the offscreen clipboard
  document.
- **`contentScript.js`** — injected on Salesforce hosts. Watches SPA navigation,
  extracts `{ objectType, recordId }` from Lightning URLs, requests metadata, and
  renders a floating, tabbed UI inside a **closed shadow root** (`mfRoot`).
- **`offscreen.html` / `offscreen.js`** — clipboard writes via
  `document.execCommand("copy")` (the only reliable path in MV3).
- **`popup/`** and **`options/`** — toolbar popup (status/launcher) and settings.

## Message flow

```
contentScript  --fetchMetadata-->  background  --describe + retrieve-->  Salesforce
contentScript  <----- { data } ----  background
contentScript  --updateField (PATCH)-->  background  --PATCH sobject-->  Salesforce
contentScript  --copyToClipboard-->  background  --> offscreen (execCommand)
```

## Data shape (keep stable)

The background returns, on success:

```js
{
  data: {
    [fieldApiName]: {
      type,          // Salesforce field type (e.g. "string", "reference")
      value,         // current value from the record retrieve
      label,         // human label from describe
      updateable,    // boolean — drives inline-edit eligibility
      referenceTo,   // array of referenced sObjects (for reference fields)
      nillable       // boolean
    }
  }
}
```

`prepareTableData` in the content script maps this into rows consumed by both
the Search tab and the All Data tab. Error responses are `{ error: string }`
(or `null` on a cookie miss).

## Why a closed shadow root

All MetaForce DOM lives under `<mf-ext-root>` attached to `<html>`. This
isolates our mutations from Salesforce's own MutationObservers, avoiding
"Permissions policy violation: unload" warnings. The single exception is the
clipboard textarea, which `execCommand` cannot reach inside a closed shadow
root, so it is attached to `document.documentElement`.
