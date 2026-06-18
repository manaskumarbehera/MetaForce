# Microsoft Edge Add-ons release

MetaForce publishes to the Edge Add-ons store via the Edge Add-ons API
(Update API v1.1, API-key auth), driven by `scripts/release-edge.mjs`. Same
shape as the Chrome release; publish is opt-in.

## One-time setup

1. **Product ID.** From [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview),
   open the MetaForce extension — the product ID (a GUID) is in the URL / overview.
2. **API credentials.** Partner Center → Settings → **Publish API** → create an
   API key. Note the **Client ID** and the **API key** value.
3. **Fill `.env`** (gitignored):
   ```
   EDGE_PRODUCT_ID=<guid>
   EDGE_CLIENT_ID=<client id>
   EDGE_API_KEY=<api key>
   ```

## Releasing

```bash
npm run release:edge:dry       # build + upload the package to the draft
npm run release:edge:publish   # build + upload + submit for certification
```

The script builds `build/edge/metaforce-vX.Y-edge.zip`, uploads it (polling the
async operation), and — only with `--publish` — submits for certification.

## Reviewer test login

Edge certification needs the same Salesforce test account as Chrome. It is **not**
set by the API — enter it in Partner Center → Extension → **Availability →
"Notes for certification"** (username, password, and steps to reach the in-page
panel on a Salesforce record).

## Status

The Edge tooling is scaffolded but **untested end-to-end** until Partner Center
API credentials are added — only `EDGE_PRODUCT_ID` is known so far.
