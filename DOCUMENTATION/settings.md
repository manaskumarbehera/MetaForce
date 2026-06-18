# Popup & settings

## Popup (`popup/`)

The toolbar popup is a lightweight status/launcher (MetaForce's real UI is the
in-page content script, so the popup deliberately stays small):

- Shows whether the current tab is a Salesforce page where MetaForce is active.
- A hint on how to open the in-page panel.
- Quick toggles for **All Data tab** and **Inline editing**, plus a button to
  open full **Settings**.

## Options (`options/`)

Persisted to `chrome.storage.sync` under the key `metaforceSettings`:

| Setting              | Key                | Default       | Effect                                                                        |
| -------------------- | ------------------ | ------------- | ----------------------------------------------------------------------------- |
| Theme                | `theme`            | `system`      | UI appearance (system / light / dark), applied to the in-page panel and pages |
| Density              | `density`          | `comfortable` | Row spacing in the All Data table (comfortable / compact)                     |
| API version          | `apiVersion`       | `v67.0`       | REST version for describe/retrieve/update                                     |
| Enable All Data tab  | `enableAllData`    | `true`        | Show the All Data tab                                                         |
| Allow inline editing | `enableInlineEdit` | `false`       | Permit PATCH edits in All Data                                                |

The schema and read/write helpers live in `mf_shared.js` (global `MF`), shared by
the content script, service worker, popup, and options page. The content script
reacts to changes live via `chrome.storage.onChanged` and re-applies theme +
density as classes on the shadow host. Inline editing is off by default because
it writes to live Salesforce records.

Pinned fields are stored separately under `metaforceFavorites`, keyed by object
type.
