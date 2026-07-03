# Notes for certification (reviewer test login)

MetaForce only does anything **inside a logged-in Salesforce org on a record
page**, so the reviewer cannot test it without a Salesforce account. Policy
**1.3.1 Product is Testable** fails if this information is missing or the
account doesn't work.

## How to use this

1. Copy the block below into a file named **`.edge-certification-notes.txt`** at
   the repo root (gitignored — safe place for the password). The release script
   sends it as the submission `notes`.
2. **Also paste the same text** into Partner Center → Extension →
   **Availability → "Notes for certification"** — that's the field the reviewer
   reads directly. (The API `notes` field supplements it; don't rely on it
   alone.)
3. Fill in the real credentials and **verify the account logs in** (no expired
   password, no MFA prompt the reviewer can't pass) before submitting.

---

## Paste-ready notes (fill the placeholders)

```
Product ID: <EDGE_PRODUCT_ID GUID — include for faster review>

WHAT THIS EXTENSION DOES
MetaForce shows Salesforce record metadata in-page. It activates ONLY on
Salesforce domains (*.salesforce.com, *.lightning.force.com, *.visualforce.com,
*.visual.force.com, *.cloudforce.com). It does nothing on other sites.

TEST ACCOUNT (Salesforce)
  Login URL: https://login.salesforce.com
  Username:  <test-username>
  Password:  <test-password>
  (Free Salesforce Developer Edition org is fine: https://developer.salesforce.com/signup)

STEPS TO REVIEW
1. Install the extension in Edge.
2. Go to https://login.salesforce.com and sign in with the account above.
3. Open any record — e.g. an Account: App Launcher → Accounts → open one record.
   The URL looks like .../lightning/r/Account/<id>/view
4. Open the MetaForce panel one of two ways:
   - Press Ctrl+Shift+M (same on Windows and macOS — the physical Ctrl key), OR
   - Click the floating MetaForce trigger button on the page.
5. The panel lists the record's field metadata (type, label, value,
   updateable, referenceTo). Use the "All Data" tab and the search box to
   confirm functionality.

NOTES
- Inline editing (which writes to live Salesforce records) is OFF by default and
  gated behind a toggle in the extension's Options page. It is not required to
  review core functionality.
- No account data leaves the browser except calls to the Salesforce REST API of
  the org you are logged into.
```
