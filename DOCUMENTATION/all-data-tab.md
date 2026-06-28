# All Data tab

The All Data tab lists **every** field of the current record — not just the ones
you search for. It is inspired by the "Show All Data" inspector in the
sf-audit-extractor project, adapted to MetaForce's in-page, shadow-DOM UI.

## How it gets the data

No new fetch path. MetaForce already calls `describe` + the record-retrieve
endpoint in `fetchObjectMetadata` (background.js), which together return every
field's value, type, label, and `updateable`/`referenceTo`/`nillable` flags. The
All Data tab simply renders the full enriched map instead of discarding metadata.

## UI

A tab strip sits at the top of the floating panel:

- **Search** — the original field/value search box.
- **All Data** — a table with columns: Label, API Name, Type, Value.

Toolbar: a filter input (matches label, API name, or value) and a **Hide empty**
checkbox that drops null/empty fields.

### Reference navigation

Reference (lookup) fields whose value is a 15/18-char Salesforce ID render as a
link. Clicking it re-invokes the existing metadata fetch for the referenced
record and pushes a breadcrumb, so you can drill into related records and step
back. This reuses `handleFetchMetadata` (objectType + recordId) — no extra
background capability.

### Inline edit (optional, off by default)

When enabled in settings, double-clicking an `updateable` field turns the value
cell into an editor with Save/Cancel. Save sends an `updateField` message; the
background issues a `PATCH` to
`/services/data/<API_VERSION>/sobjects/<Object>/<Id>` with a single-field body.
**This writes to live records** — hence the default-off toggle.

## Power features

- **Type chips** — each field's type renders as a color-coded chip grouped by kind
  (id/reference, number, date, contact, picklist, text…) via `MF.fieldKind`.
- **Pin favorites** — the star in each row pins a field; pinned fields are stored
  per object (`metaforceFavorites`) and float to the top on every record of that
  object.
- **Per-row copy** — a copy button on each value cell.
- **Export** — _Copy JSON_ puts `{ apiName: value }` on the clipboard; _CSV_
  downloads `Label,API Name,Type,Value` as `<Object>_<Id>.csv`; _Copy SOQL_
  copies a ready-to-run `SELECT <fields> FROM <Object> WHERE Id = '<Id>'` query
  (Id forced first) — paste straight into the Developer Console / Workbench.

## Settings that affect it

- `enableAllData` — show/hide the tab.
- `enableInlineEdit` — allow editing.
- `apiVersion` — REST version used for describe/retrieve/update.

See [settings.md](./settings.md).
