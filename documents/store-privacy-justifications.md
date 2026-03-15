# Chrome / Edge Web Store — Privacy Practices Justifications

Paste the text below into the corresponding permission field on the
**Privacy practices** tab when submitting or updating the extension listing.

---

## `clipboardWrite`

> MetaForce lets users copy Salesforce field values to the clipboard with a
> single click. The clipboardWrite permission is required because Salesforce
> Lightning pages set a restrictive Permissions-Policy header that blocks the
> Async Clipboard API (navigator.clipboard.writeText) in content scripts.
> When the in-page API is unavailable, MetaForce delegates the write to an
> offscreen document that uses document.execCommand("copy"), which requires
> the clipboardWrite permission. No data is written to the clipboard without
> an explicit user click on a copy button.

---

## `offscreen`

> MetaForce uses the offscreen permission to create a hidden offscreen
> document (offscreen.html) solely for clipboard write operations. Salesforce
> Lightning pages block navigator.clipboard.writeText via Permissions-Policy,
> and the Manifest V3 service worker cannot reliably write to the clipboard
> because it is never focused. The offscreen document, created with the
> CLIPBOARD reason, is the Chrome-recommended mechanism for extensions that
> need to call document.execCommand("copy"). The document is only created
> when a user clicks a copy button and contains no UI.

