// Dev-only: extracts the three real stylesheets injected by contentScript.js and
// renders representative panel + All Data markup into a closed-shadow harness, so
// the modern UI can be screenshotted (light/dark) without a live Salesforce org.
// Output: scripts/.harness.html (gitignored build artifact).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = await readFile(path.join(root, "contentScript.js"), "utf8");

function extract(marker) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  const tStart = src.indexOf("style.textContent = `", at) + "style.textContent = `".length;
  const tEnd = src.indexOf("`;", tStart);
  return src
    .slice(tStart, tEnd)
    .replaceAll("${LOADER_ELEMENT_ID}", "mf-loader")
    .replaceAll("${STATUS_ELEMENT_ID}", "metaforce-status");
}

const baseCss = extract("style.id = STYLE_ELEMENT_ID;");
const themeCss = extract('const STYLE_ID = "metaforce-theme-style";');
const allDataCss = extract('const STYLE_ID = "metaforce-alldata-style";');

// Same injection order as the runtime: base → theme → all-data.
const css = `${baseCss}\n${themeCss}\n${allDataCss}`;

const panel = `
<div id="mf-main">
  <div id="mf-panel">
    <div class="mf-panel-header">
      <span class="mf-panel-title">MetaForce</span>
      <div class="mf-object-badge"><span class="mf-object-name">Account</span><span class="mf-field-count">63 fields</span></div>
      <button class="mf-header-close">✕</button>
    </div>
    <div class="mf-tabs" role="tablist">
      <button class="mf-tab" role="tab" aria-selected="false">Search</button>
      <button class="mf-tab" role="tab" aria-selected="true">All Data</button>
    </div>
    <div id="mf-tab-alldata" class="mf-tabpane">
      <div class="mf-ad-breadcrumb" style="display:flex"><button class="mf-ad-crumb">Account</button><span class="mf-ad-crumb-sep">›</span><span class="mf-ad-crumb mf-ad-crumb-current">Contact</span></div>
      <div class="mf-ad-toolbar">
        <input class="mf-ad-filter" placeholder="Filter fields…" />
        <label class="mf-ad-hidenull"><input type="checkbox"/> <span>Hide empty</span></label>
        <div class="mf-ad-actions"><button class="mf-ad-export-btn">Copy JSON</button><button class="mf-ad-export-btn">CSV</button><button class="mf-ad-export-btn">Copy SOQL</button><button class="mf-ad-export-btn">Dev Console</button></div>
      </div>
      <div class="mf-ad-count">63 / 63 fields</div>
      <div class="mf-ad-tablewrap">
        <table class="mf-ad-table">
          <thead><tr><th>Label</th><th>API Name</th><th>Type</th><th>Value</th></tr></thead>
          <tbody>
            <tr class="mf-ad-row is-fav"><td class="mf-ad-label"><button class="mf-ad-fav is-fav">★</button><span>Account Name</span></td><td class="mf-ad-api">Name</td><td class="mf-ad-type"><span class="mf-ad-kind" data-kind="text">string</span></td><td class="mf-ad-val"><span class="mf-ad-text">Acme Corporation</span><button class="mf-ad-rowbtn">⧉</button></td></tr>
            <tr class="mf-ad-row"><td class="mf-ad-label"><button class="mf-ad-fav">☆</button><span>Owner</span></td><td class="mf-ad-api">OwnerId</td><td class="mf-ad-type"><span class="mf-ad-kind" data-kind="id">reference</span></td><td class="mf-ad-val"><button class="mf-ad-ref">005xx000001Sv6AAAS</button><button class="mf-ad-rowbtn">⧉</button></td></tr>
            <tr class="mf-ad-row"><td class="mf-ad-label"><button class="mf-ad-fav">☆</button><span>Annual Revenue</span></td><td class="mf-ad-api">AnnualRevenue</td><td class="mf-ad-type"><span class="mf-ad-kind" data-kind="number">currency</span></td><td class="mf-ad-val"><span class="mf-ad-text">5200000</span><button class="mf-ad-rowbtn">⧉</button></td></tr>
            <tr class="mf-ad-row"><td class="mf-ad-label"><button class="mf-ad-fav">☆</button><span>Active</span></td><td class="mf-ad-api">Active__c</td><td class="mf-ad-type"><span class="mf-ad-kind" data-kind="bool">boolean</span></td><td class="mf-ad-val"><span class="mf-ad-text">true</span><button class="mf-ad-rowbtn">⧉</button></td></tr>
            <tr class="mf-ad-row"><td class="mf-ad-label"><button class="mf-ad-fav">☆</button><span>Created Date</span></td><td class="mf-ad-api">CreatedDate</td><td class="mf-ad-type"><span class="mf-ad-kind" data-kind="date">datetime</span></td><td class="mf-ad-val"><span class="mf-ad-text">2024-01-12T09:40:00Z</span><button class="mf-ad-rowbtn">⧉</button></td></tr>
            <tr class="mf-ad-row"><td class="mf-ad-label"><button class="mf-ad-fav">☆</button><span>Industry</span></td><td class="mf-ad-api">Industry</td><td class="mf-ad-type"><span class="mf-ad-kind" data-kind="picklist">picklist</span></td><td class="mf-ad-val"><span class="mf-ad-empty">—</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <button id="mf-trigger"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; min-height:100vh; background:#e9eef6; }
  body.dark { background:#0b0e14; }
  .stage { display:flex; gap:40px; padding:40px; align-items:flex-start; }
  .col { position:relative; width:430px; }
  h2 { font:600 13px -apple-system,sans-serif; color:#64748b; margin:0 0 10px; }
</style></head><body>
<div class="stage">
  <div class="col"><h2>LIGHT</h2><mf-ext-root id="light"></mf-ext-root></div>
  <div class="col"><h2>DARK</h2><mf-ext-root id="dark"></mf-ext-root></div>
</div>
<script>
  const CSS = ${JSON.stringify(css)};
  const PANEL = ${JSON.stringify(panel)};
  function mount(id, themeClass) {
    const host = document.getElementById(id);
    if (themeClass) host.className = themeClass;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<style>" + CSS + "</style>" + PANEL;
    // Neutralize fixed positioning so both panels render inline side by side.
    const main = root.getElementById("mf-main");
    main.style.position = "static"; main.style.inset = "auto";
    root.getElementById("mf-panel").style.animation = "none";
  }
  mount("light", "mf-theme-light");
  mount("dark", "mf-theme-dark");
</script>
</body></html>`;

const out = path.join(root, "scripts", ".harness.html");
await writeFile(out, html);
console.log(out);
