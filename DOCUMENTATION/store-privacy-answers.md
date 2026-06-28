# Partner Center "Privacy" page — paste-ready answers

The Edge **Privacy** section of the listing (and the equivalent Chrome data-use /
permissions screens) is **listing metadata — there is no API for it** (Microsoft
docs: "There aren't REST API endpoints for … updating a product's metadata … you
must use Microsoft Partner Center"). Fill it in the dashboard with the text
below.

Privacy policy URL to use (resolves, public):
`https://github.com/manaskumarbehera/MetaForce/blob/main/PRIVACY.md`

## Single purpose

> MetaForce displays the metadata of the Salesforce record you are viewing
> (field types, labels, values, updateability, references) in an in-page panel,
> by calling the REST API of the Salesforce org you are signed in to.

## Does the extension collect or use personal data?

> No. MetaForce does not collect, transmit, sell, or share personal data. It has
> no analytics, no remote server of its own, and talks only to the Salesforce org
> the user is already signed in to.

## Permission justifications

| Permission                                                                                                                    | Justification                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cookies`                                                                                                                     | Read the user's existing Salesforce session to authenticate REST API calls to their own org on their behalf. The session is not stored and not sent anywhere except the user's Salesforce org. |
| `storage`                                                                                                                     | Persist user preferences locally (API version, whether inline editing is enabled). Never leaves the browser.                                                                                   |
| `clipboardWrite`                                                                                                              | Copy a selected field value to the clipboard when the user clicks copy.                                                                                                                        |
| `offscreen`                                                                                                                   | Perform the clipboard write reliably from the service worker via an offscreen document.                                                                                                        |
| Host permissions (`*.salesforce.com`, `*.lightning.force.com`, `*.visualforce.com`, `*.visual.force.com`, `*.cloudforce.com`) | Run only on Salesforce pages and call the signed-in org's REST API to read record metadata.                                                                                                    |

## Remote code

> No remote code. All logic ships inside the package; the only network calls are
> to the user's own Salesforce org REST API.

## Data handling certifications (check these)

- Does **not** sell user data.
- Does **not** use/transfer data for purposes unrelated to the single purpose.
- Does **not** use/transfer data to determine creditworthiness or for lending.
