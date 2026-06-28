// Initialize flags
let lastRecordId = "";
let lastUrl = "";
let requestToken = 0;
const STYLE_ELEMENT_ID = "metaforce-search-style";
const STATUS_ELEMENT_ID = "metaforce-status";
const LOADER_ELEMENT_ID = "mf-loader";
let detachOutsideCloseHandler = null;
let statusTimerId = null;

// ── Settings (shared contract lives in mf_shared.js → global MF) ─────────────
let mfSettings = { ...MF.DEFAULT_SETTINGS };

function loadSettings() {
  try {
    MF.getSettings().then((settings) => {
      mfSettings = settings;
      applyHostTheme();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[MF.SETTINGS_KEY]) {
        mfSettings = { ...MF.DEFAULT_SETTINGS, ...changes[MF.SETTINGS_KEY].newValue };
        applyHostTheme();
      }
    });
  } catch (_) {
    // storage unavailable — keep defaults.
  }
}
loadSettings();

// Toggle the panel from the keyboard shortcut routed via the service worker.
function mfTogglePanel() {
  const panel = mfRoot.querySelector("#mf-panel");
  const trigger = mfRoot.querySelector("#mf-trigger");
  if (panel && panel.style.display !== "none") {
    const close = panel.querySelector(".mf-header-close");
    if (close) close.click();
  } else if (trigger) {
    trigger.click();
  }
}
try {
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === "togglePanel") mfTogglePanel();
  });
} catch (_) {
  // messaging unavailable — keyboard toggle simply won't fire.
}

// ── All Data tab state ───────────────────────────────────────────────────────
// mfAd holds the DOM refs + filter state of the All Data panel; mfAdContext is
// the record currently shown there; mfAdNav is the reference-navigation
// breadcrumb stack of { objectType, recordId }.
let mfAd = null;
let mfAdContext = null;
let mfAdNav = [];

// ── Shadow DOM isolation ──────────────────────────────────────────────────────
// All MetaForce UI lives inside a closed Shadow DOM attached to <html> (not
// <body>). This prevents our DOM mutations from triggering Salesforce's
// MutationObservers, which internally register `unload` listeners and cause
// "Permissions policy violation: unload" warnings.
const mfShadowHost = document.createElement("mf-ext-root");
document.documentElement.appendChild(mfShadowHost);
const mfRoot = mfShadowHost.attachShadow({ mode: "closed" });

// ── Utility: debounce ────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Utility: clipboard copy ───────────────────────────────────────────────────
// Two-tier fallback for Chrome + Edge compatibility:
// 1. navigator.clipboard.writeText() — works when the page's Permissions-Policy
//    allows it and a user gesture is active.
// 2. Delegate to the background service worker → offscreen document (always
//    reliable; offscreen documents with CLIPBOARD reason support execCommand).
//
// NOTE: We intentionally skip document.execCommand("copy") in the content
// script.  When Tier 1 fails, the browser consumes the transient user
// activation, so execCommand would return false anyway.  It also calls
// textarea.focus() which steals focus from the shadow-DOM search input.
function copyToClipboard(text) {
  // ── Tier 1: navigator.clipboard (user-gesture required) ──
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).catch(() => _bgCopyFallback(text));
  }
  return _bgCopyFallback(text);
}

function _bgCopyFallback(text) {
  // ── Tier 2: background → offscreen document ──
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ action: "copyToClipboard", text }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || "Copy failed"));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function highlightMatch(text, query) {
  if (!query) return document.createTextNode(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  if (idx > 0) frag.appendChild(document.createTextNode(text.slice(0, idx)));
  const mark = document.createElement("mark");
  mark.className = "mf-highlight";
  mark.textContent = text.slice(idx, idx + query.length);
  frag.appendChild(mark);
  if (idx + query.length < text.length) {
    frag.appendChild(document.createTextNode(text.slice(idx + query.length)));
  }
  return frag;
}

// Initialize your MutationObserver and start observing
const observer = new MutationObserver(() => {
  try {
    const currentUrl = window.location.href;

    if (currentUrl !== lastUrl) {
      const extractedData = extractObjectTypeFromURL(currentUrl);
      // Common clean-up
      removeSearchBox();
      lastRecordId = "";
      if (extractedData !== null) {
        lastRecordId = extractedData.recordId;
        mainLogic(extractedData);
      }

      lastUrl = currentUrl; // Update lastUrl to the current URL
    }
  } catch (_) {
    // Swallow observer errors; a failed tick must not break SF's own observers.
  }
});
// Configuration of the observer
const config = { childList: true, subtree: true };
// Start observing the entire body for changes
observer.observe(document.body, config);

// ── Initial bootstrap ─────────────────────────────────────────────────────────
// The MutationObserver only fires on *future* mutations. If the record page is
// already stable at document_idle (no further DOM changes), the search icon
// would never appear. Perform one immediate URL check to cover this case.
{
  const initialUrl = window.location.href;
  const extractedData = extractObjectTypeFromURL(initialUrl);
  if (extractedData !== null) {
    lastUrl = initialUrl;
    lastRecordId = extractedData.recordId;
    mainLogic(extractedData);
  }
}

// Main logic
async function mainLogic(extractedData) {
  try {
    if (!extractedData) {
      return;
    }

    const activeToken = ++requestToken;
    showLoadingIndicator();
    const response = await fetchMetadataAsync(extractedData);
    hideLoadingIndicator();

    // Ignore stale responses from previous route transitions.
    if (activeToken !== requestToken || extractedData.recordId !== lastRecordId) {
      return;
    }

    if (!response || response.error) {
      showStatusNotice(
        response && response.error ? response.error : "Unable to fetch metadata for this record.",
        "error"
      );
      return;
    }

    const tableData = prepareTableData(response);

    if (extractedData.recordId && Array.isArray(tableData) && tableData.length > 0) {
      clearStatusNotice();
      createSearchBox(tableData, extractedData.objectType, extractedData.recordId);
      return;
    }

    showStatusNotice("No metadata fields were returned for this record.", "info");
  } catch (_) {
    hideLoadingIndicator();
    showStatusNotice("Unable to load metadata. Check your Salesforce session.", "error");
  }
}
// Extract object type and record ID from the URL
function extractObjectTypeFromURL(url) {
  const regex = /\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view/;
  const match = url.match(regex);
  if (match) {
    return { objectType: match[1], recordId: match[2] };
  } else {
    // Reset if the URL doesn't match
    removeSearchBox();
    lastRecordId = "";
    return null;
  }
}
function prepareTableData(response = {}) {
  try {
    if (!response || !response.data) {
      return [];
    }
    const rawData = response.data;
    return Object.keys(rawData).map((key) => {
      const { type, value, label, updateable, referenceTo, nillable } = rawData[key];

      return {
        Field: key,
        Type: type,
        Value: value === null ? "null" : value,
        // Enriched metadata for the All Data tab (older background responses
        // omit these — fall back gracefully so the Search tab is unaffected).
        Label: label || key,
        Updateable: updateable === true,
        ReferenceTo: Array.isArray(referenceTo) ? referenceTo : [],
        Nillable: nillable === true,
        RawValue: value,
      };
    });
  } catch (_) {
    return [];
  }
}
async function fetchMetadataAsync(extractedData) {
  return new Promise((resolve, reject) => {
    // Check if the extension context is valid.
    if (chrome.runtime) {
      chrome.runtime.sendMessage(
        {
          action: "fetchMetadata",
          objectType: extractedData.objectType,
          recordId: extractedData.recordId,
          baseUrl: window.location.origin,
        },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError.message);
            return;
          }

          if (response === null) {
            reject(new Error("Salesforce session cookie not found."));
            return;
          }

          if (!response || typeof response !== "object") {
            reject(new Error("Unexpected response from extension background."));
            return;
          }

          resolve(response);
        }
      );
    } else {
      reject(new Error("Extension context invalidated."));
    }
  });
}
function removeSearchBox() {
  if (detachOutsideCloseHandler) {
    detachOutsideCloseHandler();
    detachOutsideCloseHandler = null;
  }

  clearStatusNotice();
  hideLoadingIndicator();

  // Reset All Data tab state so a new record doesn't inherit stale breadcrumbs.
  mfAd = null;
  mfAdContext = null;
  mfAdNav = [];

  const searchContainer = mfRoot.querySelector("#mf-panel");
  if (searchContainer) {
    searchContainer.remove();
  }
  const mainContainer = mfRoot.querySelector("#mf-main");
  if (mainContainer) {
    mainContainer.remove();
  }
}

function ensureSearchStyles() {
  applyHostTheme();
  if (mfRoot.querySelector("#" + STYLE_ELEMENT_ID)) {
    // Base sheet already present — make sure the theme layer sits after it.
    ensureThemeStyles();
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
  /* ── Loading indicator ─────────────────────────────────────────── */
  #${LOADER_ELEMENT_ID} {
    position: fixed;
    bottom: 24px;
    right: 80px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border: 1px solid #d8dde6;
    border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.14);
  }
  .mf-spinner {
    width: 18px;
    height: 18px;
    border: 2.5px solid #d8dde6;
    border-top-color: #0176d3;
    border-radius: 50%;
    animation: mf-spin 0.65s linear infinite;
  }

  /* ── Main container & trigger icon ────────────────────────────── */
  #mf-main {
    position: fixed;
    bottom: 24px;
    right: 80px;
    z-index: 99999;
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #mf-trigger {
    order: 2;
    flex-shrink: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: #0176d3;
    color: #ffffff;
    border-radius: 999px;
    border: none;
    box-shadow: 0 2px 10px rgba(1,118,211,0.45);
    transition: transform 0.15s, box-shadow 0.2s;
    animation: mf-pulse 2.8s ease-in-out infinite;
  }
  #mf-trigger:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 18px rgba(1,118,211,0.6);
    animation: none;
  }

  /* ── Panel ─────────────────────────────────────────────────────── */
  #mf-panel {
    order: 1;
    width: 360px;
    max-width: calc(100vw - 64px);
    background: #ffffff;
    border: 1px solid #d8dde6;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    overflow: hidden;
    animation: mf-slide-in-right 0.18s ease;
  }

  /* ── Panel header ──────────────────────────────────────────────── */
  .mf-panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    background: #0176d3;
    color: #ffffff;
  }
  .mf-panel-title {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.4px;
    flex-shrink: 0;
  }
  .mf-object-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .mf-object-name {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mf-field-count {
    font-size: 11px;
    background: rgba(255,255,255,0.2);
    border-radius: 999px;
    padding: 1px 8px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .mf-header-close {
    border: none;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 4px;
    opacity: 0.8;
    flex-shrink: 0;
    transition: opacity 0.15s, background 0.15s;
  }
  .mf-header-close:hover { opacity: 1; background: rgba(255,255,255,0.15); }

  /* ── Search row ────────────────────────────────────────────────── */
  .mf-search-row {
    display: flex;
    align-items: center;
    padding: 10px;
    border-bottom: 1px solid #f0f0f0;
  }
  .mf-search-input {
    flex: 1;
    min-width: 0;
    border: 1px solid #b0b7c3;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    outline: none;
    background: #ffffff;
    color: #181818;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .mf-search-input:focus {
    border-color: #0176d3;
    box-shadow: 0 0 0 3px rgba(1,118,211,0.12);
  }

  /* ── Result list ───────────────────────────────────────────────── */
  #mf-results {
    margin: 0;
    padding: 4px 0;
    list-style: none;
    max-height: 340px;
    overflow-y: auto;
  }
  .mf-result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .mf-result-item:hover,
  .mf-result-item.active {
    background: #eef4ff;
  }
  .mf-result-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mf-result-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mf-result-field-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: #181818;
  }
  .mf-result-value-preview {
    font-size: 11px;
    color: #777;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mf-highlight {
    background: none;
    color: #0176d3;
    font-weight: 700;
  }
  .mf-result-type-badge {
    font-size: 10px;
    color: #555;
    background: #f0f2f5;
    border: 1px solid #d8dde6;
    border-radius: 999px;
    padding: 1px 7px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .mf-result-copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border: 1px solid #d8dde6;
    background: #f0f2f5;
    border-radius: 6px;
    cursor: pointer;
    color: #444;
    transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
    padding: 0;
  }
  .mf-result-copy-btn svg,
  .mf-copy-btn svg {
    pointer-events: none;
  }
  .mf-result-copy-btn:hover {
    background: #0176d3;
    border-color: #0176d3;
    color: #ffffff;
    transform: scale(1.08);
  }
  .mf-result-copy-btn:active {
    transform: scale(0.95);
  }
  .mf-result-copy-btn.mf-copied {
    background: #2e844a;
    border-color: #2e844a;
    color: #ffffff;
  }
  .mf-empty-state {
    padding: 14px 12px;
    color: #888;
    font-size: 12px;
    text-align: center;
  }

  /* ── Selected value pane ───────────────────────────────────────── */
  .mf-selected-value {
    border-top: 1px solid #f0f0f0;
    padding: 10px;
  }
  .mf-selected-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .mf-back-btn {
    border: 1px solid #d8dde6;
    background: #f8f9fb;
    color: #444;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, border-color 0.15s;
  }
  .mf-back-btn:hover { background: #eef4ff; border-color: #0176d3; color: #0176d3; }
  .mf-selected-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .mf-selected-field {
    font-weight: 600;
    font-size: 12px;
    color: #181818;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mf-type-badge {
    border: 1px solid #d8dde6;
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 11px;
    color: #444;
    text-transform: lowercase;
    flex-shrink: 0;
  }
  .mf-value-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mf-value-text {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: #f8f9fb;
    color: #111;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 200px;
    overflow: auto;
    word-break: break-all;
  }
  .mf-value-text.mf-null-value {
    color: #999;
    font-style: italic;
    background: #fafafa;
  }
  .mf-copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    border: none;
    background: #0176d3;
    color: #ffffff;
    border-radius: 6px;
    padding: 9px 0;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s, transform 0.1s;
  }
  .mf-copy-btn:hover {
    background: #0160b0;
  }
  .mf-copy-btn:active {
    transform: scale(0.97);
  }
  .mf-copy-btn.mf-copied {
    background: #2e844a;
  }

  /* ── Status notice ─────────────────────────────────────────────── */
  #${STATUS_ELEMENT_ID} {
    position: fixed;
    bottom: 80px;
    right: 80px;
    z-index: 100000;
    max-width: 360px;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    border: 1px solid #d8dde6;
    background: #ffffff;
    color: #1f1f1f;
    box-shadow: 0 6px 14px rgba(0,0,0,0.16);
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #${STATUS_ELEMENT_ID} span { flex: 1; }
  .mf-status-dismiss {
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
    color: inherit;
    opacity: 0.6;
    padding: 0;
    transition: opacity 0.15s;
  }
  .mf-status-dismiss:hover { opacity: 1; }
  #${STATUS_ELEMENT_ID}.mf-status-error {
    border-color: #ea001e;
    background: #ffe8eb;
    color: #5b000d;
  }
  #${STATUS_ELEMENT_ID}.mf-status-info {
    border-color: #0176d3;
    background: #eef4ff;
    color: #032d60;
  }

  /* ── Animations ────────────────────────────────────────────────── */
  @keyframes mf-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes mf-pulse {
    0%, 100% { box-shadow: 0 2px 10px rgba(1,118,211,0.45); }
    50%       { box-shadow: 0 2px 22px rgba(1,118,211,0.75); }
  }
  @keyframes mf-slide-in-right {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Theming (light/dark/density tokens) is provided by ensureThemeStyles(). */
  `;
  mfRoot.appendChild(style);
  // Append the theme/token layer AFTER the base sheet so its appearance rules win
  // the cascade (equal specificity → later-in-DOM wins). Order: base → theme.
  ensureThemeStyles();
}

// ── Loading indicator ─────────────────────────────────────────────────────────
function showLoadingIndicator() {
  if (mfRoot.querySelector("#" + LOADER_ELEMENT_ID)) return;
  ensureSearchStyles();
  const loader = document.createElement("div");
  loader.id = LOADER_ELEMENT_ID;
  const spinner = document.createElement("div");
  spinner.className = "mf-spinner";
  loader.appendChild(spinner);
  mfRoot.appendChild(loader);
}

function hideLoadingIndicator() {
  const loader = mfRoot.querySelector("#" + LOADER_ELEMENT_ID);
  if (loader) loader.remove();
}

function closeSearchUI(searchContainer, searchIcon, searchBox, resultList) {
  if (detachOutsideCloseHandler) {
    detachOutsideCloseHandler();
    detachOutsideCloseHandler = null;
  }

  if (searchBox) {
    searchBox.value = "";
    searchBox.setAttribute("aria-expanded", "false");
    searchBox.removeAttribute("aria-activedescendant");
  }
  if (resultList) {
    resultList.innerHTML = "";
  }
  const existingValueElement = searchContainer.querySelector(".mf-selected-value");
  if (existingValueElement) {
    existingValueElement.remove();
  }
  searchContainer.style.display = "none";
  searchIcon.style.display = "block";
  searchIcon.setAttribute("aria-expanded", "false");
  searchIcon.focus();
}

function formatFieldValue(value, type) {
  if (value === null || value === "null") {
    return { display: "null", copyText: "null" };
  }

  if (value === undefined) {
    return { display: "(undefined)", copyText: "" };
  }

  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value, null, 2);
      return { display: text, copyText: text };
    } catch (error) {
      const fallback = String(value);
      return { display: fallback, copyText: fallback };
    }
  }

  if (type === "boolean") {
    const booleanText = value ? "true" : "false";
    return { display: booleanText, copyText: booleanText };
  }

  const text = String(value);
  return { display: text, copyText: text };
}

function clearStatusNotice() {
  if (statusTimerId) {
    clearTimeout(statusTimerId);
    statusTimerId = null;
  }

  const statusElement = mfRoot.querySelector("#" + STATUS_ELEMENT_ID);
  if (statusElement) {
    statusElement.remove();
  }
}

function showStatusNotice(message, kind = "info") {
  clearStatusNotice();

  const statusElement = document.createElement("div");
  statusElement.id = STATUS_ELEMENT_ID;
  statusElement.setAttribute("role", "alert");
  statusElement.className = kind === "error" ? "mf-status-error" : "mf-status-info";

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "mf-status-dismiss";
  dismissBtn.setAttribute("aria-label", "Dismiss notification");
  dismissBtn.textContent = "✕";
  dismissBtn.addEventListener("click", clearStatusNotice);

  statusElement.appendChild(msgSpan);
  statusElement.appendChild(dismissBtn);
  mfRoot.appendChild(statusElement);

  statusTimerId = setTimeout(() => {
    clearStatusNotice();
  }, 8000);
}

// ── All Data tab ───────────────────────────────────────────────────────────
// A second tab beside Search that lists every field of the record (label, API
// name, type, value) with filtering, reference navigation, and optional inline
// editing. Inspired by sf-audit-extractor's "Show All Data" inspector, but it
// reuses MetaForce's existing describe+record fetch (no new SOQL/proxy path).

function mfI18n(key, fallback) {
  try {
    const m = chrome.i18n.getMessage(key);
    return m || fallback;
  } catch (_) {
    return fallback;
  }
}

function mfMakeTab(label, controls, selected) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mf-tab";
  b.textContent = label;
  b.setAttribute("role", "tab");
  b.setAttribute("aria-controls", controls);
  b.setAttribute("aria-selected", String(selected));
  b.tabIndex = selected ? 0 : -1;
  return b;
}

function buildTabStrip(searchPane, rows, objectType, recordId) {
  const strip = document.createElement("div");
  strip.className = "mf-tabs";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "MetaForce views");

  const searchTab = mfMakeTab(mfI18n("tabSearch", "Search"), "mf-tab-search", true);
  const allDataTab = mfMakeTab(mfI18n("tabAllData", "All Data"), "mf-tab-alldata", false);
  const allDataPane = buildAllDataPane();

  function activate(which, focusTab) {
    const showAll = which === "alldata";
    searchTab.setAttribute("aria-selected", String(!showAll));
    allDataTab.setAttribute("aria-selected", String(showAll));
    searchTab.tabIndex = showAll ? -1 : 0;
    allDataTab.tabIndex = showAll ? 0 : -1;
    searchPane.hidden = showAll;
    allDataPane.hidden = !showAll;
    if (showAll) ensureAllDataLoaded(objectType, recordId, rows);
    if (focusTab) (showAll ? allDataTab : searchTab).focus();
  }

  searchTab.addEventListener("click", () => activate("search"));
  allDataTab.addEventListener("click", () => activate("alldata"));
  strip.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const toAll = document.activeElement === searchTab;
      activate(toAll ? "alldata" : "search", true);
    }
  });

  strip.append(searchTab, allDataTab);
  return { strip, allDataPane, activate };
}

function buildAllDataPane() {
  ensureAllDataStyles();

  const pane = document.createElement("div");
  pane.id = "mf-tab-alldata";
  pane.className = "mf-tabpane";
  pane.setAttribute("role", "tabpanel");
  pane.hidden = true;

  const breadcrumb = document.createElement("div");
  breadcrumb.className = "mf-ad-breadcrumb";
  breadcrumb.style.display = "none";

  const toolbar = document.createElement("div");
  toolbar.className = "mf-ad-toolbar";

  const filter = document.createElement("input");
  filter.type = "text";
  filter.className = "mf-ad-filter";
  filter.placeholder = mfI18n("allDataFilterPlaceholder", "Filter fields…");
  filter.setAttribute("aria-label", "Filter All Data fields");

  const hideNullLabel = document.createElement("label");
  hideNullLabel.className = "mf-ad-hidenull";
  const hideNull = document.createElement("input");
  hideNull.type = "checkbox";
  const hideNullText = document.createElement("span");
  hideNullText.textContent = mfI18n("allDataHideNull", "Hide empty");
  hideNullLabel.append(hideNull, hideNullText);

  const actions = document.createElement("div");
  actions.className = "mf-ad-actions";
  const jsonBtn = document.createElement("button");
  jsonBtn.type = "button";
  jsonBtn.className = "mf-ad-export-btn";
  jsonBtn.textContent = mfI18n("allDataCopyJson", "Copy JSON");
  jsonBtn.addEventListener("click", () => exportAllData("json", jsonBtn));
  const csvBtn = document.createElement("button");
  csvBtn.type = "button";
  csvBtn.className = "mf-ad-export-btn";
  csvBtn.textContent = mfI18n("allDataExportCsv", "CSV");
  csvBtn.addEventListener("click", () => exportAllData("csv", csvBtn));
  const soqlBtn = document.createElement("button");
  soqlBtn.type = "button";
  soqlBtn.className = "mf-ad-export-btn";
  soqlBtn.textContent = mfI18n("allDataCopySoql", "Copy SOQL");
  soqlBtn.title = mfI18n("allDataCopySoqlTitle", "Copy a SELECT query for this record");
  soqlBtn.addEventListener("click", () => exportAllData("soql", soqlBtn));
  actions.append(jsonBtn, csvBtn, soqlBtn);

  toolbar.append(filter, hideNullLabel, actions);

  const count = document.createElement("div");
  count.className = "mf-ad-count";

  const tableWrap = document.createElement("div");
  tableWrap.className = "mf-ad-tablewrap";
  const table = document.createElement("table");
  table.className = "mf-ad-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [
    ["allDataColLabel", "Label"],
    ["allDataColApiName", "API Name"],
    ["allDataColType", "Type"],
    ["allDataColValue", "Value"],
  ].forEach(([key, fallback]) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = mfI18n(key, fallback);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  tableWrap.appendChild(table);

  pane.append(breadcrumb, toolbar, count, tableWrap);

  mfAd = { pane, breadcrumb, filter, hideNull, count, tbody, filterText: "", favorites: new Set() };

  const onFilter = debounce(() => {
    mfAd.filterText = filter.value.trim();
    renderAllDataRows();
  }, 120);
  filter.addEventListener("input", onFilter);
  hideNull.addEventListener("change", renderAllDataRows);

  return pane;
}

function ensureAllDataLoaded(objectType, recordId, rows) {
  if (mfAdContext && mfAdContext.objectType === objectType && mfAdContext.recordId === recordId) {
    return;
  }
  mfAdNav = [];
  setAllDataRecord(objectType, recordId, rows);
}

function setAllDataRecord(objectType, recordId, rows) {
  mfAdContext = { objectType, recordId, rows };
  renderBreadcrumb();
  renderAllDataRows();
  // Pull pinned fields for this object, then re-render so they float to the top.
  MF.getFavorites(objectType).then((favs) => {
    if (
      mfAd &&
      mfAdContext &&
      mfAdContext.objectType === objectType &&
      mfAdContext.recordId === recordId
    ) {
      mfAd.favorites = new Set(favs);
      renderAllDataRows();
    }
  });
}

function mfToggleFavorite(field) {
  if (!mfAdContext) return;
  MF.toggleFavorite(mfAdContext.objectType, field).then((list) => {
    if (mfAd) {
      mfAd.favorites = new Set(list);
      renderAllDataRows();
    }
  });
}

function renderBreadcrumb() {
  if (!mfAd) return;
  mfAd.breadcrumb.innerHTML = "";
  if (mfAdNav.length === 0) {
    mfAd.breadcrumb.style.display = "none";
    return;
  }
  mfAd.breadcrumb.style.display = "flex";
  mfAdNav.forEach((entry, index) => {
    const crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = "mf-ad-crumb";
    crumb.textContent = entry.objectType;
    crumb.title = `${entry.objectType} ${entry.recordId}`;
    crumb.addEventListener("click", () => popAllDataNav(index));
    const sep = document.createElement("span");
    sep.className = "mf-ad-crumb-sep";
    sep.textContent = "›";
    mfAd.breadcrumb.append(crumb, sep);
  });
  const current = document.createElement("span");
  current.className = "mf-ad-crumb mf-ad-crumb-current";
  current.textContent = mfAdContext.objectType;
  current.title = `${mfAdContext.objectType} ${mfAdContext.recordId}`;
  mfAd.breadcrumb.appendChild(current);
}

function popAllDataNav(index) {
  const target = mfAdNav[index];
  if (!target) return;
  mfAdNav = mfAdNav.slice(0, index);
  setAllDataRecord(target.objectType, target.recordId, target.rows);
}

function mfAllDataValueText(row) {
  const v = row.RawValue;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function renderAllDataRows() {
  if (!mfAd || !mfAdContext) return;
  const q = (mfAd.filterText || "").toLowerCase();
  const hideNull = mfAd.hideNull.checked;
  const rows = mfAdContext.rows.filter((row) => {
    const text = mfAllDataValueText(row);
    if (hideNull && text === "") return false;
    if (!q) return true;
    return (
      row.Field.toLowerCase().includes(q) ||
      (row.Label || "").toLowerCase().includes(q) ||
      text.toLowerCase().includes(q)
    );
  });
  // Pinned fields float to the top (Array.sort is stable, so the rest keep order).
  const favs = mfAd.favorites || new Set();
  rows.sort((a, b) => (favs.has(b.Field) ? 1 : 0) - (favs.has(a.Field) ? 1 : 0));
  mfAd.tbody.innerHTML = "";
  rows.forEach((row) => mfAd.tbody.appendChild(buildAllDataRow(row, favs.has(row.Field))));
  mfAd.count.textContent = `${rows.length} / ${mfAdContext.rows.length} fields`;
}

function mfTd(text, cls) {
  const cell = document.createElement("td");
  cell.className = cls;
  cell.textContent = text;
  return cell;
}

function buildAllDataRow(row, isFav) {
  const tr = document.createElement("tr");
  tr.className = isFav ? "mf-ad-row is-fav" : "mf-ad-row";

  // Label cell: a pin/favorite star + the label.
  const tdLabel = document.createElement("td");
  tdLabel.className = "mf-ad-label";
  tdLabel.title = row.Field;
  const star = document.createElement("button");
  star.type = "button";
  star.className = isFav ? "mf-ad-fav is-fav" : "mf-ad-fav";
  star.textContent = isFav ? "★" : "☆";
  star.title = isFav ? mfI18n("allDataUnpin", "Unpin field") : mfI18n("allDataPin", "Pin field");
  star.setAttribute("aria-pressed", String(!!isFav));
  star.setAttribute("aria-label", `${isFav ? "Unpin" : "Pin"} ${row.Field}`);
  star.addEventListener("click", (event) => {
    event.stopPropagation();
    mfToggleFavorite(row.Field);
  });
  const labelText = document.createElement("span");
  labelText.textContent = row.Label || row.Field;
  tdLabel.append(star, labelText);

  const tdApi = mfTd(row.Field, "mf-ad-api");

  // Type cell: a color-coded kind chip.
  const tdType = document.createElement("td");
  tdType.className = "mf-ad-type";
  if (row.Type) {
    const chip = document.createElement("span");
    chip.className = "mf-ad-kind";
    chip.dataset.kind = MF.fieldKind(row.Type);
    chip.textContent = row.Type;
    tdType.appendChild(chip);
  }

  const tdVal = document.createElement("td");
  tdVal.className = "mf-ad-val";
  fillAllDataValueCell(tdVal, row);
  tr.append(tdLabel, tdApi, tdType, tdVal);
  return tr;
}

function fillAllDataValueCell(tdVal, row) {
  tdVal.innerHTML = "";
  const text = mfAllDataValueText(row);
  const editable = mfSettings.enableInlineEdit === true && row.Updateable === true;
  tdVal.classList.toggle("mf-ad-editable", editable);

  if (text === "") {
    const empty = document.createElement("span");
    empty.className = "mf-ad-empty";
    empty.textContent = "—";
    tdVal.appendChild(empty);
  } else if (
    row.Type === "reference" &&
    Array.isArray(row.ReferenceTo) &&
    row.ReferenceTo.length > 0 &&
    /^[a-zA-Z0-9]{15,18}$/.test(text)
  ) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "mf-ad-ref";
    link.textContent = text;
    link.title = `Open ${row.ReferenceTo[0]} ${text}`;
    link.addEventListener("click", () => navigateToReference(row.ReferenceTo[0], text));
    tdVal.appendChild(link);
  } else {
    const span = document.createElement("span");
    span.className = "mf-ad-text";
    span.textContent = text.length > 200 ? text.slice(0, 200) + "…" : text;
    span.title = text;
    tdVal.appendChild(span);
  }

  // Per-row copy (any non-empty value).
  if (text !== "") {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "mf-ad-rowbtn";
    copyBtn.title = mfI18n("allDataCopyValue", "Copy value");
    copyBtn.setAttribute("aria-label", `Copy ${row.Field} value`);
    copyBtn.textContent = "⧉";
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await copyToClipboard(text);
        copyBtn.classList.add("mf-copied");
        copyBtn.textContent = "✓";
        setTimeout(() => {
          copyBtn.classList.remove("mf-copied");
          copyBtn.textContent = "⧉";
        }, 1200);
      } catch (_) {
        // copy failed silently; the global notice path handles hard errors.
      }
    });
    tdVal.appendChild(copyBtn);
  }

  if (editable) {
    const pencil = document.createElement("button");
    pencil.type = "button";
    pencil.className = "mf-ad-rowbtn";
    pencil.title = mfI18n("allDataEdit", "Edit");
    pencil.setAttribute("aria-label", `Edit ${row.Field}`);
    pencil.textContent = "✎";
    pencil.addEventListener("click", (event) => {
      event.stopPropagation();
      startInlineEdit(tdVal, row);
    });
    tdVal.appendChild(pencil);
    tdVal.addEventListener("dblclick", () => startInlineEdit(tdVal, row));
  }
}

// Export the current All Data record as JSON (to clipboard) or CSV (download).
async function exportAllData(kind, btn) {
  if (!mfAdContext) return;
  const rows = mfAdContext.rows;
  const flash = (text) => {
    const orig = btn.dataset.label || btn.textContent;
    btn.dataset.label = orig;
    btn.textContent = text;
    btn.classList.add("mf-copied");
    setTimeout(() => {
      btn.textContent = btn.dataset.label;
      btn.classList.remove("mf-copied");
    }, 1300);
  };
  if (kind === "json") {
    try {
      await copyToClipboard(MF.recordToJson(rows));
      flash(mfI18n("allDataCopied", "Copied!"));
    } catch (_) {
      showStatusNotice("Copy failed.", "error");
    }
  } else if (kind === "soql") {
    try {
      await copyToClipboard(MF.recordToSoql(rows, mfAdContext.objectType, mfAdContext.recordId));
      flash(mfI18n("allDataCopied", "Copied!"));
    } catch (_) {
      showStatusNotice("Copy failed.", "error");
    }
  } else {
    mfDownload(
      `${mfAdContext.objectType}_${mfAdContext.recordId}.csv`,
      MF.recordToCsv(rows),
      "text/csv;charset=utf-8"
    );
    flash(mfI18n("allDataDownloaded", "Saved"));
  }
}

// Trigger a file download. The anchor must live in the page (not the closed
// shadow root) for the programmatic click to work — same constraint as copy.
function mfDownload(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.position = "fixed";
    a.style.left = "-9999px";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (_) {
    showStatusNotice("Download failed.", "error");
  }
}

function startInlineEdit(tdVal, row) {
  if (tdVal.querySelector(".mf-ad-edit-input")) return;
  const current = row.RawValue == null ? "" : String(row.RawValue);
  tdVal.innerHTML = "";

  const editWrap = document.createElement("div");
  editWrap.className = "mf-ad-editwrap";

  let input;
  if (row.Type === "boolean") {
    input = document.createElement("select");
    ["true", "false"].forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      input.appendChild(opt);
    });
    input.value = String(row.RawValue === true);
  } else if (row.Type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
    input.value = current;
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = current;
  }
  input.className = "mf-ad-edit-input";
  input.setAttribute("aria-label", `Edit ${row.Field}`);

  const actions = document.createElement("div");
  actions.className = "mf-ad-editactions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "mf-ad-btn mf-ad-save";
  save.textContent = mfI18n("allDataSave", "Save");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "mf-ad-btn mf-ad-cancel";
  cancel.textContent = mfI18n("allDataCancel", "Cancel");
  actions.append(save, cancel);

  const finish = () => fillAllDataValueCell(tdVal, row);
  cancel.addEventListener("click", finish);
  save.addEventListener("click", () => commitInlineEdit(tdVal, row, input));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    } else if (event.key === "Enter" && row.Type !== "textarea") {
      event.preventDefault();
      commitInlineEdit(tdVal, row, input);
    }
  });

  editWrap.append(input, actions);
  tdVal.appendChild(editWrap);
  input.focus();
}

// Map an edited string into the typed value Salesforce expects in the PATCH body.
function coerceEditedValue(row, raw) {
  if (row.Type === "boolean") return raw === "true";
  if (raw === "" && row.Nillable) return null;
  if (["int", "double", "currency", "percent"].includes(row.Type) && raw !== "") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

function commitInlineEdit(tdVal, row, input) {
  const outValue = coerceEditedValue(row, input.value);
  const saveBtn = tdVal.querySelector(".mf-ad-save");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "…";
  }

  chrome.runtime.sendMessage(
    {
      action: "updateField",
      objectType: mfAdContext.objectType,
      recordId: mfAdContext.recordId,
      fieldName: row.Field,
      value: outValue,
      baseUrl: window.location.origin,
    },
    (resp) => {
      if (chrome.runtime.lastError || !resp || resp.error) {
        const msg = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : (resp && resp.error) || "Save failed";
        showStatusNotice(`${mfI18n("allDataSaveFailed", "Save failed")}: ${msg}`, "error");
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = mfI18n("allDataSave", "Save");
        }
        return;
      }
      // Rows are shared by reference with mfAdContext.rows, so mutating here
      // also updates the Search tab's view of this field.
      row.RawValue = outValue;
      row.Value = outValue === null ? "null" : outValue;
      fillAllDataValueCell(tdVal, row);
      showStatusNotice(mfI18n("allDataSaved", "Saved"), "info");
    }
  );
}

async function fetchRowsForRecord(objectType, recordId) {
  const response = await fetchMetadataAsync({ objectType, recordId });
  if (!response || response.error) {
    throw new Error(response && response.error ? response.error : "Unable to load record.");
  }
  return prepareTableData(response);
}

async function navigateToReference(refObj, refId) {
  if (!refObj || !refId) return;
  showLoadingIndicator();
  try {
    const rows = await fetchRowsForRecord(refObj, refId);
    if (mfAdContext) mfAdNav.push({ ...mfAdContext });
    setAllDataRecord(refObj, refId, rows);
  } catch (error) {
    showStatusNotice(error.message || "Unable to load referenced record.", "error");
  } finally {
    hideLoadingIndicator();
  }
}

function ensureAllDataStyles() {
  const STYLE_ID = "metaforce-alldata-style";
  if (mfRoot.querySelector("#" + STYLE_ID)) return;
  ensureThemeStyles();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  .mf-tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--mf-border); }
  .mf-tab {
    appearance: none; border: none; background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 700; color: var(--mf-muted);
    padding: 8px 14px; border-radius: 10px 10px 0 0; border-bottom: 2px solid transparent;
    transition: color 0.16s, border-color 0.16s;
  }
  .mf-tab:hover { color: var(--mf-accent); }
  .mf-tab[aria-selected="true"] { color: var(--mf-accent); border-bottom-color: var(--mf-accent); }
  .mf-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--mf-accent-soft); border-radius: 8px; }
  .mf-tabpane[hidden] { display: none; }

  .mf-ad-breadcrumb { align-items: center; gap: 4px; flex-wrap: wrap; padding: 9px 12px 0; font-size: 11px; }
  .mf-ad-crumb {
    appearance: none; border: none; background: transparent; cursor: pointer;
    font: inherit; font-size: 11px; color: var(--mf-accent); padding: 1px 4px; border-radius: 5px;
  }
  .mf-ad-crumb:hover { background: var(--mf-accent-soft); }
  .mf-ad-crumb-current { color: var(--mf-muted); cursor: default; font-weight: 700; }
  .mf-ad-crumb-current:hover { background: none; }
  .mf-ad-crumb-sep { color: var(--mf-faint); }

  .mf-ad-toolbar { display: flex; align-items: center; gap: 8px; padding: 9px 12px; flex-wrap: wrap; }
  .mf-ad-filter {
    flex: 1; min-width: 120px; font: inherit; font-size: 12px; padding: 7px 10px;
    border: 1px solid var(--mf-border-2); border-radius: var(--mf-radius-md);
    background: var(--mf-surface); color: var(--mf-text);
  }
  .mf-ad-filter::placeholder { color: var(--mf-faint); }
  .mf-ad-filter:focus { outline: none; border-color: var(--mf-accent); background: var(--mf-bg-solid); box-shadow: 0 0 0 3px var(--mf-accent-soft); }
  .mf-ad-hidenull { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--mf-muted); cursor: pointer; white-space: nowrap; }
  .mf-ad-hidenull input { accent-color: var(--mf-accent); }
  .mf-ad-actions { display: flex; gap: 6px; }
  .mf-ad-export-btn {
    appearance: none; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600;
    padding: 6px 10px; border-radius: var(--mf-radius-sm); border: 1px solid var(--mf-border-2);
    background: var(--mf-surface); color: var(--mf-muted); white-space: nowrap;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .mf-ad-export-btn:hover { border-color: var(--mf-accent); color: var(--mf-accent); background: var(--mf-accent-soft); }
  .mf-ad-export-btn.mf-copied { border-color: var(--mf-ok); color: #fff; background: var(--mf-ok); }
  .mf-ad-count { padding: 0 12px 7px; font-size: 11px; color: var(--mf-faint); }

  .mf-ad-tablewrap { max-height: 340px; overflow: auto; padding: 0 8px 10px; }
  .mf-ad-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .mf-ad-table th {
    position: sticky; top: 0; background: var(--mf-surface-2); color: var(--mf-muted); text-align: left;
    font-weight: 700; padding: 7px 8px; border-bottom: 1px solid var(--mf-border); z-index: 1;
    -webkit-backdrop-filter: var(--mf-blur); backdrop-filter: var(--mf-blur);
  }
  .mf-ad-row td { padding: var(--mf-pad) 8px; border-bottom: 1px solid var(--mf-border); vertical-align: top; }
  .mf-ad-row:hover td { background: var(--mf-accent-soft); }
  .mf-ad-row.is-fav td { background: color-mix(in srgb, var(--mf-kind-picklist) 9%, transparent); }
  .mf-ad-fav {
    appearance: none; border: none; background: transparent; cursor: pointer; padding: 0 2px;
    margin-right: 4px; color: var(--mf-faint); font-size: 13px; line-height: 1;
    transition: color 0.15s, transform 0.1s;
  }
  .mf-ad-fav:hover { transform: scale(1.2); color: var(--mf-kind-picklist); }
  .mf-ad-fav.is-fav { color: var(--mf-kind-picklist); }
  .mf-ad-label { font-weight: 600; color: var(--mf-text); max-width: 130px; word-break: break-word; }
  .mf-ad-api { color: var(--mf-muted); font-family: var(--mf-mono); font-size: 11px; max-width: 130px; word-break: break-all; }
  .mf-ad-type { white-space: nowrap; }
  .mf-ad-kind {
    display: inline-block; font-size: 10px; font-weight: 700; color: #fff;
    padding: 1px 7px; border-radius: 99px; background: var(--mf-kind-other); white-space: nowrap;
  }
  .mf-ad-kind[data-kind="id"] { background: var(--mf-kind-id); }
  .mf-ad-kind[data-kind="bool"] { background: var(--mf-kind-bool); }
  .mf-ad-kind[data-kind="number"] { background: var(--mf-kind-number); }
  .mf-ad-kind[data-kind="date"] { background: var(--mf-kind-date); }
  .mf-ad-kind[data-kind="contact"] { background: var(--mf-kind-contact); }
  .mf-ad-kind[data-kind="picklist"] { background: var(--mf-kind-picklist); }
  .mf-ad-kind[data-kind="text"] { background: var(--mf-kind-text); }
  .mf-ad-val { color: var(--mf-text); word-break: break-word; }
  .mf-ad-val.mf-ad-editable { position: relative; }
  .mf-ad-text { white-space: pre-wrap; }
  .mf-ad-empty { color: var(--mf-faint); }
  .mf-ad-ref {
    appearance: none; border: none; background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; color: var(--mf-accent); padding: 0; text-align: left;
    font-family: var(--mf-mono);
  }
  .mf-ad-ref:hover { text-decoration: underline; }
  .mf-ad-rowbtn {
    appearance: none; border: none; background: transparent; cursor: pointer;
    color: var(--mf-faint); font-size: 11px; margin-left: 6px; opacity: 0; transition: opacity .12s, color .12s;
  }
  .mf-ad-row:hover .mf-ad-rowbtn { opacity: 1; }
  .mf-ad-rowbtn:hover { color: var(--mf-accent); }
  .mf-ad-rowbtn.mf-copied { color: var(--mf-ok); opacity: 1; }

  .mf-ad-editwrap { display: flex; flex-direction: column; gap: 6px; }
  .mf-ad-edit-input {
    font: inherit; font-size: 12px; padding: 6px 8px; border: 1px solid var(--mf-accent);
    border-radius: var(--mf-radius-sm); background: var(--mf-bg-solid); color: var(--mf-text);
    width: 100%; box-sizing: border-box;
  }
  .mf-ad-edit-input:focus { outline: none; box-shadow: 0 0 0 3px var(--mf-accent-soft); }
  .mf-ad-editactions { display: flex; gap: 6px; }
  .mf-ad-btn { font: inherit; font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: var(--mf-radius-sm); cursor: pointer; border: 1px solid transparent; }
  .mf-ad-save { background: var(--mf-grad); color: #fff; }
  .mf-ad-save:hover { filter: brightness(1.06); }
  .mf-ad-save:disabled { opacity: .6; cursor: default; }
  .mf-ad-cancel { background: transparent; border-color: var(--mf-border-2); color: var(--mf-muted); }
  .mf-ad-cancel:hover { border-color: var(--mf-accent); color: var(--mf-accent); }
  `;
  mfRoot.appendChild(style);
}

// Apply the chosen theme + density as classes on the shadow host. The token
// stylesheet reacts to these (and to prefers-color-scheme when theme = system).
function applyHostTheme() {
  const theme = mfSettings.theme || "system";
  mfShadowHost.classList.toggle("mf-theme-light", theme === "light");
  mfShadowHost.classList.toggle("mf-theme-dark", theme === "dark");
  mfShadowHost.classList.toggle("mf-density-compact", mfSettings.density === "compact");
}

// The single source of theming + modern visual design. Defined as design tokens
// on :host (light), overridden for dark (system media + explicit theme class) and
// density, then consumed by every component rule below. Injected after the base
// structural stylesheet so these appearance rules win the cascade.
function ensureThemeStyles() {
  const STYLE_ID = "metaforce-theme-style";
  if (mfRoot.querySelector("#" + STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
  :host {
    --mf-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mf-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --mf-bg: rgba(255,255,255,0.82);
    --mf-bg-solid: #ffffff;
    --mf-surface: #f4f7fc;
    --mf-surface-2: #e9eef8;
    --mf-text: #0c1530;
    --mf-muted: #5a6478;
    --mf-faint: #8a93a6;
    --mf-border: rgba(12,21,48,0.10);
    --mf-border-2: rgba(12,21,48,0.18);
    --mf-accent: #2563eb;
    --mf-accent-2: #7c3aed;
    --mf-on-accent: #ffffff;
    --mf-accent-soft: rgba(37,99,235,0.12);
    --mf-ok: #16a34a;
    --mf-danger: #e11d48;
    --mf-radius: 18px;
    --mf-radius-md: 12px;
    --mf-radius-sm: 9px;
    --mf-shadow: 0 18px 50px -12px rgba(12,21,48,0.34), 0 4px 14px rgba(12,21,48,0.10);
    --mf-shadow-sm: 0 6px 18px rgba(12,21,48,0.16);
    --mf-blur: saturate(180%) blur(16px);
    --mf-ease: cubic-bezier(0.22,1,0.36,1);
    --mf-grad: linear-gradient(135deg, #2563eb, #7c3aed);
    --mf-pad: 7px;
    --mf-kind-id:#2563eb; --mf-kind-bool:#0891b2; --mf-kind-number:#7c3aed;
    --mf-kind-date:#db2777; --mf-kind-contact:#0d9488; --mf-kind-picklist:#d97706;
    --mf-kind-text:#475569; --mf-kind-other:#64748b;
  }
  /* Dark tokens — applied for system dark (unless forced light) and explicit dark. */
  @media (prefers-color-scheme: dark) {
    :host(:not(.mf-theme-light)) {
      --mf-bg: rgba(22,27,38,0.86);
      --mf-bg-solid: #161b26;
      --mf-surface: #1c2230;
      --mf-surface-2: #232b3b;
      --mf-text: #eaeef7;
      --mf-muted: #a3adc0;
      --mf-faint: #79859b;
      --mf-border: rgba(255,255,255,0.10);
      --mf-border-2: rgba(255,255,255,0.20);
      --mf-accent: #5b8cff;
      --mf-accent-2: #a875ff;
      --mf-accent-soft: rgba(91,140,255,0.16);
      --mf-shadow: 0 18px 54px -10px rgba(0,0,0,0.66), 0 4px 14px rgba(0,0,0,0.4);
      --mf-shadow-sm: 0 6px 18px rgba(0,0,0,0.5);
      --mf-grad: linear-gradient(135deg, #3b6ef0, #8b5cf6);
      --mf-kind-id:#5b8cff; --mf-kind-bool:#22d3ee; --mf-kind-number:#a875ff;
      --mf-kind-date:#f472b6; --mf-kind-contact:#2dd4bf; --mf-kind-picklist:#fbbf24;
      --mf-kind-text:#94a3b8; --mf-kind-other:#94a3b8;
    }
  }
  :host(.mf-theme-dark) {
    --mf-bg: rgba(22,27,38,0.86);
    --mf-bg-solid: #161b26;
    --mf-surface: #1c2230;
    --mf-surface-2: #232b3b;
    --mf-text: #eaeef7;
    --mf-muted: #a3adc0;
    --mf-faint: #79859b;
    --mf-border: rgba(255,255,255,0.10);
    --mf-border-2: rgba(255,255,255,0.20);
    --mf-accent: #5b8cff;
    --mf-accent-2: #a875ff;
    --mf-accent-soft: rgba(91,140,255,0.16);
    --mf-shadow: 0 18px 54px -10px rgba(0,0,0,0.66), 0 4px 14px rgba(0,0,0,0.4);
    --mf-shadow-sm: 0 6px 18px rgba(0,0,0,0.5);
    --mf-grad: linear-gradient(135deg, #3b6ef0, #8b5cf6);
    --mf-kind-id:#5b8cff; --mf-kind-bool:#22d3ee; --mf-kind-number:#a875ff;
    --mf-kind-date:#f472b6; --mf-kind-contact:#2dd4bf; --mf-kind-picklist:#fbbf24;
    --mf-kind-text:#94a3b8; --mf-kind-other:#94a3b8;
  }
  :host(.mf-density-compact) { --mf-pad: 3px; }

  /* ── Trigger FAB ──────────────────────────────────────────────── */
  #mf-trigger {
    width: 44px; height: 44px; border-radius: 50%;
    background: var(--mf-grad); color: #fff; border: none;
    box-shadow: 0 8px 22px -4px rgba(37,99,235,0.55);
    transition: transform 0.22s var(--mf-ease), box-shadow 0.22s var(--mf-ease);
  }
  #mf-trigger:hover { transform: translateY(-2px) scale(1.06); box-shadow: 0 12px 30px -4px rgba(124,58,237,0.6); animation: none; }
  #mf-trigger:active { transform: scale(0.96); }
  #mf-trigger:focus-visible { outline: none; box-shadow: 0 0 0 4px var(--mf-accent-soft), 0 8px 22px -4px rgba(37,99,235,0.55); }

  /* ── Glass panel ──────────────────────────────────────────────── */
  #mf-panel {
    width: 384px; max-width: calc(100vw - 56px);
    background: var(--mf-bg);
    -webkit-backdrop-filter: var(--mf-blur); backdrop-filter: var(--mf-blur);
    border: 1px solid var(--mf-border);
    border-radius: var(--mf-radius);
    box-shadow: var(--mf-shadow);
    color: var(--mf-text);
    overflow: hidden;
    animation: mf-pop-in 0.26s var(--mf-ease);
  }
  @keyframes mf-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }

  /* ── Header ───────────────────────────────────────────────────── */
  .mf-panel-header { background: var(--mf-grad); color: #fff; padding: 11px 14px; }
  .mf-panel-title { font-weight: 800; letter-spacing: 0.3px; }
  .mf-field-count { background: rgba(255,255,255,0.22); }
  .mf-header-close { color: #fff; border-radius: 8px; }
  .mf-header-close:hover { background: rgba(255,255,255,0.2); }

  /* ── Search ───────────────────────────────────────────────────── */
  .mf-search-row { border-bottom: 1px solid var(--mf-border); padding: 11px; }
  .mf-search-input {
    background: var(--mf-surface); color: var(--mf-text);
    border: 1px solid var(--mf-border-2); border-radius: var(--mf-radius-md);
    padding: 9px 12px; transition: border-color 0.16s, box-shadow 0.16s, background 0.16s;
  }
  .mf-search-input::placeholder { color: var(--mf-faint); }
  .mf-search-input:focus { border-color: var(--mf-accent); background: var(--mf-bg-solid); box-shadow: var(--mf-ring, 0 0 0 3px var(--mf-accent-soft)); }

  /* ── Results ──────────────────────────────────────────────────── */
  #mf-results { padding: 6px; max-height: 360px; }
  #mf-results::-webkit-scrollbar, .mf-ad-tablewrap::-webkit-scrollbar, .mf-value-text::-webkit-scrollbar { width: 9px; height: 9px; }
  #mf-results::-webkit-scrollbar-thumb, .mf-ad-tablewrap::-webkit-scrollbar-thumb, .mf-value-text::-webkit-scrollbar-thumb { background: var(--mf-border-2); border-radius: 99px; border: 2px solid transparent; background-clip: content-box; }
  .mf-result-item { border-radius: var(--mf-radius-sm); padding: 8px 10px; color: var(--mf-text); transition: background 0.14s var(--mf-ease); }
  .mf-result-item:hover, .mf-result-item.active { background: var(--mf-accent-soft); }
  .mf-result-field-name { color: var(--mf-text); font-weight: 600; }
  .mf-result-value-preview { color: var(--mf-muted); }
  .mf-highlight { color: var(--mf-accent); background: none; }
  .mf-result-type-badge {
    color: var(--mf-on-accent); border: none; font-weight: 600;
    background: var(--mf-kind-other);
  }
  .mf-result-type-badge[data-kind="id"] { background: var(--mf-kind-id); }
  .mf-result-type-badge[data-kind="bool"] { background: var(--mf-kind-bool); }
  .mf-result-type-badge[data-kind="number"] { background: var(--mf-kind-number); }
  .mf-result-type-badge[data-kind="date"] { background: var(--mf-kind-date); }
  .mf-result-type-badge[data-kind="contact"] { background: var(--mf-kind-contact); }
  .mf-result-type-badge[data-kind="picklist"] { background: var(--mf-kind-picklist); }
  .mf-result-type-badge[data-kind="text"] { background: var(--mf-kind-text); }
  .mf-result-copy-btn { background: var(--mf-surface); border: 1px solid var(--mf-border); color: var(--mf-muted); border-radius: var(--mf-radius-sm); }
  .mf-result-copy-btn:hover { background: var(--mf-accent); border-color: var(--mf-accent); color: #fff; }
  .mf-result-copy-btn.mf-copied { background: var(--mf-ok); border-color: var(--mf-ok); color: #fff; }
  .mf-empty-state { color: var(--mf-faint); }

  /* ── Selected value pane ──────────────────────────────────────── */
  .mf-selected-value { border-top: 1px solid var(--mf-border); }
  .mf-back-btn { background: var(--mf-surface); border: 1px solid var(--mf-border-2); color: var(--mf-muted); border-radius: var(--mf-radius-sm); }
  .mf-back-btn:hover { background: var(--mf-accent-soft); border-color: var(--mf-accent); color: var(--mf-accent); }
  .mf-selected-field { color: var(--mf-text); }
  .mf-type-badge { color: var(--mf-muted); border: 1px solid var(--mf-border-2); }
  .mf-value-text { background: var(--mf-surface); color: var(--mf-text); border-radius: var(--mf-radius-md); }
  .mf-value-text.mf-null-value { color: var(--mf-faint); background: var(--mf-surface); }
  .mf-copy-btn { background: var(--mf-grad); color: #fff; border: none; border-radius: var(--mf-radius-md); }
  .mf-copy-btn:hover { filter: brightness(1.06); }
  .mf-copy-btn.mf-copied { background: var(--mf-ok); }

  /* ── Status notice ────────────────────────────────────────────── */
  #${STATUS_ELEMENT_ID} {
    background: var(--mf-bg); -webkit-backdrop-filter: var(--mf-blur); backdrop-filter: var(--mf-blur);
    color: var(--mf-text); border: 1px solid var(--mf-border); border-radius: var(--mf-radius-md);
    box-shadow: var(--mf-shadow-sm);
  }
  #${STATUS_ELEMENT_ID}.mf-status-error { border-color: var(--mf-danger); }
  #${STATUS_ELEMENT_ID}.mf-status-info { border-color: var(--mf-accent); }
  `;
  mfRoot.appendChild(style);
}

function createSearchBox(originalData, objectType = "", recordId = "") {
  let searchIcon = mfRoot.querySelector("#mf-trigger");
  if (!searchIcon) {
    ensureSearchStyles();

    // ── Root container ──────────────────────────────────────────────
    const mainContainer = document.createElement("div");
    mainContainer.id = "mf-main";

    // ── Trigger icon (SVG magnifier) ────────────────────────────────
    const searchIcon = document.createElement("button");
    searchIcon.type = "button";
    searchIcon.id = "mf-trigger";
    searchIcon.title = "MetaForce — click to search fields";
    searchIcon.setAttribute("role", "button");
    searchIcon.setAttribute("aria-haspopup", "listbox");
    searchIcon.setAttribute("aria-label", "Open MetaForce field search");
    searchIcon.setAttribute("aria-controls", "mf-results");
    searchIcon.setAttribute("aria-expanded", "false");
    searchIcon.tabIndex = 0;
    searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

    mainContainer.appendChild(searchIcon);
    mfRoot.appendChild(mainContainer);

    // Persists the last search text so "Back" can restore the filtered list
    let lastSearchText = "";

    const openSearch = function (e) {
      e.stopPropagation();
      searchIcon.style.display = "none";

      // Re-open existing panel if it was hidden
      const existingContainer = mfRoot.querySelector("#mf-panel");
      if (existingContainer) {
        existingContainer.style.display = "block";
        searchIcon.setAttribute("aria-expanded", "true");
        const existingSearchBox = existingContainer.querySelector("input");
        if (existingSearchBox) {
          existingSearchBox.setAttribute("aria-expanded", "true");
          existingSearchBox.focus();
          // Re-render all fields (search box was cleared on close, so this shows everything)
          existingSearchBox.dispatchEvent(new Event("input"));
        }
        if (!detachOutsideCloseHandler) {
          const handleOutsidePointerDown = function (event) {
            if (event.target !== mfShadowHost && !mfShadowHost.contains(event.target)) {
              closeSearchUI(
                existingContainer,
                searchIcon,
                existingSearchBox,
                existingContainer.querySelector("#mf-results")
              );
            }
          };
          document.addEventListener("pointerdown", handleOutsidePointerDown);
          detachOutsideCloseHandler = function () {
            document.removeEventListener("pointerdown", handleOutsidePointerDown);
          };
        }
        return;
      }

      // ── Build the panel ───────────────────────────────────────────
      const searchContainer = document.createElement("div");
      searchContainer.id = "mf-panel";

      // Header bar
      const panelHeader = document.createElement("div");
      panelHeader.className = "mf-panel-header";

      const panelTitle = document.createElement("span");
      panelTitle.className = "mf-panel-title";
      panelTitle.textContent = "MetaForce";

      const objectBadge = document.createElement("div");
      objectBadge.className = "mf-object-badge";
      if (objectType) {
        const objectName = document.createElement("span");
        objectName.className = "mf-object-name";
        objectName.textContent = objectType;
        objectBadge.appendChild(objectName);
      }
      const fieldCountBadge = document.createElement("span");
      fieldCountBadge.className = "mf-field-count";
      fieldCountBadge.textContent = `${originalData.length} fields`;
      objectBadge.appendChild(fieldCountBadge);

      const headerCloseBtn = document.createElement("button");
      headerCloseBtn.type = "button";
      headerCloseBtn.className = "mf-header-close";
      headerCloseBtn.setAttribute("aria-label", "Close MetaForce panel");
      headerCloseBtn.textContent = "✕";

      panelHeader.append(panelTitle, objectBadge, headerCloseBtn);

      // Search input (no separate clear button — ESC or header ✕ closes)
      const searchBox = document.createElement("input");
      searchBox.type = "text";
      searchBox.className = "mf-search-input";
      searchBox.title = "Search fields by name or value…";
      searchBox.setAttribute("role", "combobox");
      searchBox.setAttribute("aria-autocomplete", "list");
      searchBox.setAttribute("aria-label", "Search Salesforce fields by name or value");
      searchBox.setAttribute("aria-controls", "mf-results");
      searchBox.setAttribute("aria-expanded", "true");
      searchBox.placeholder = "Search by field name or value…";
      searchIcon.setAttribute("aria-expanded", "true");

      const searchRow = document.createElement("div");
      searchRow.className = "mf-search-row";
      searchRow.appendChild(searchBox);

      // Result list
      const resultList = document.createElement("ul");
      resultList.id = "mf-results";
      resultList.setAttribute("role", "listbox");

      // Outside-click handler
      const handleOutsidePointerDown = function (event) {
        if (event.target !== mfShadowHost && !mfShadowHost.contains(event.target)) {
          closeSearchUI(searchContainer, searchIcon, searchBox, resultList);
        }
      };
      document.addEventListener("pointerdown", handleOutsidePointerDown);
      detachOutsideCloseHandler = function () {
        document.removeEventListener("pointerdown", handleOutsidePointerDown);
      };

      // Wrap the search controls in a tab pane so the All Data tab can sit
      // beside them. The searchBox/resultList references are unchanged.
      const searchPane = document.createElement("div");
      searchPane.id = "mf-tab-search";
      searchPane.className = "mf-tabpane";
      searchPane.setAttribute("role", "tabpanel");
      searchPane.append(searchRow, resultList);

      if (mfSettings.enableAllData) {
        const tabs = buildTabStrip(searchPane, originalData, objectType, recordId);
        searchContainer.append(panelHeader, tabs.strip, searchPane, tabs.allDataPane);
      } else {
        searchContainer.append(panelHeader, searchPane);
      }
      mainContainer.appendChild(searchContainer);

      // ── Shared filter: matches field name OR stringified value ─────
      function filterRows(rows, query) {
        if (!query) return rows;
        const q = query.toLowerCase();
        return rows.filter((row) => {
          if (row.Field.toLowerCase().includes(q)) return true;
          const val = row.Value === null || row.Value === undefined ? "" : String(row.Value);
          return val.toLowerCase().includes(q);
        });
      }

      // ── displaySelectedValue ──────────────────────────────────────
      function displaySelectedValue(field, data, parentContainer) {
        const matchedRow = data.find((row) => row.Field === field);
        const fieldType = matchedRow && matchedRow.Type ? String(matchedRow.Type) : "unknown";
        const formattedValue = formatFieldValue(
          matchedRow ? matchedRow.Value : undefined,
          fieldType
        );
        const isNullish =
          formattedValue.display === "null" || formattedValue.display === "(undefined)";

        const valueElement = document.createElement("div");
        valueElement.className = "mf-selected-value";

        // Header row: [← Back]  [FieldName]  [type]
        const selectedHeader = document.createElement("div");
        selectedHeader.className = "mf-selected-header";

        const backBtn = document.createElement("button");
        backBtn.type = "button";
        backBtn.className = "mf-back-btn";
        backBtn.textContent = "← Back";
        backBtn.setAttribute("aria-label", "Back to search results");
        backBtn.addEventListener("click", function () {
          valueElement.remove();
          currentRows = filterRows(originalData, lastSearchText);
          activeIndex = -1;
          renderResults(currentRows);
          searchBox.focus();
        });

        const valueMeta = document.createElement("div");
        valueMeta.className = "mf-selected-meta";

        const fieldName = document.createElement("span");
        fieldName.className = "mf-selected-field";
        fieldName.textContent = field;
        fieldName.title = field;

        const typeBadge = document.createElement("span");
        typeBadge.className = "mf-type-badge";
        typeBadge.textContent = fieldType;

        valueMeta.append(fieldName, typeBadge);
        selectedHeader.append(backBtn, valueMeta);

        // Value display
        const valueWrap = document.createElement("div");
        valueWrap.className = "mf-value-wrap";

        const valueText = document.createElement("pre");
        valueText.className = "mf-value-text" + (isNullish ? " mf-null-value" : "");
        valueText.textContent = formattedValue.display;

        // Copy button — always visible, prominent
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "mf-copy-btn";
        copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy value`;
        copyButton.title = "Copy value to clipboard";
        copyButton.addEventListener("click", async function (e) {
          e.stopPropagation();
          e.preventDefault();
          try {
            await copyToClipboard(formattedValue.copyText);
            copyButton.classList.add("mf-copied");
            copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><polyline points="20 6 9 17 4 12"/></svg>Copied!`;
            setTimeout(() => {
              copyButton.classList.remove("mf-copied");
              copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy value`;
            }, 1500);
          } catch (error) {
            copyButton.textContent = "Copy failed — try again";
            setTimeout(() => {
              copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy value`;
            }, 2000);
          }
        });

        valueWrap.append(valueText, copyButton);
        valueElement.append(selectedHeader, valueWrap);
        parentContainer.appendChild(valueElement);
      }

      // ── State ─────────────────────────────────────────────────────
      let activeIndex = -1;
      let currentRows = [];

      function selectRow(row) {
        searchBox.value = row.Field;
        lastSearchText = row.Field;
        const existingValueElement = searchContainer.querySelector(".mf-selected-value");
        if (existingValueElement) existingValueElement.remove();
        displaySelectedValue(row.Field, originalData, searchContainer);
        resultList.innerHTML = "";
        currentRows = [];
        activeIndex = -1;
      }

      function scrollActiveIntoView() {
        const activeEl = resultList.querySelector(`#mf-option-${activeIndex}`);
        if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
      }

      function renderResults(rows) {
        resultList.innerHTML = "";

        if (activeIndex < 0 || activeIndex >= rows.length) {
          searchBox.removeAttribute("aria-activedescendant");
        } else {
          searchBox.setAttribute("aria-activedescendant", `mf-option-${activeIndex}`);
        }

        if (rows.length === 0) {
          const emptyItem = document.createElement("li");
          emptyItem.className = "mf-empty-state";
          emptyItem.textContent = "No matching fields";
          resultList.appendChild(emptyItem);
          return;
        }

        const query = lastSearchText;
        rows.forEach((row, index) => {
          const listItem = document.createElement("li");
          listItem.className = "mf-result-item" + (index === activeIndex ? " active" : "");
          listItem.id = `mf-option-${index}`;
          listItem.setAttribute("role", "option");
          listItem.setAttribute("aria-selected", String(index === activeIndex));

          // ── Main block (field name row + value preview row) ───────
          const resultMain = document.createElement("div");
          resultMain.className = "mf-result-main";

          // Top row: field name + type badge
          const resultTop = document.createElement("div");
          resultTop.className = "mf-result-top";

          const fieldNameSpan = document.createElement("span");
          fieldNameSpan.className = "mf-result-field-name";
          fieldNameSpan.appendChild(highlightMatch(row.Field, query));
          fieldNameSpan.title = row.Field;

          const typeBadge = document.createElement("span");
          typeBadge.className = "mf-result-type-badge";
          typeBadge.dataset.kind = MF.fieldKind(row.Type);
          typeBadge.textContent = row.Type || "—";

          resultTop.append(fieldNameSpan, typeBadge);

          // Value preview row
          const formatted = formatFieldValue(row.Value, row.Type ? String(row.Type) : "unknown");
          const previewRaw = formatted.display;
          const valuePreview = document.createElement("span");
          valuePreview.className = "mf-result-value-preview";
          valuePreview.textContent =
            previewRaw.length > 70 ? previewRaw.slice(0, 70) + "…" : previewRaw;
          valuePreview.title = previewRaw;

          resultMain.append(resultTop, valuePreview);

          // ── Inline copy button ────────────────────────────────────
          const copyBtn = document.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "mf-result-copy-btn";
          copyBtn.title = `Copy value of ${row.Field}`;
          copyBtn.setAttribute("aria-label", `Copy value of ${row.Field}`);
          const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
          const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
          copyBtn.innerHTML = copyIcon;
          copyBtn.addEventListener("click", async function (e) {
            e.stopPropagation();
            e.preventDefault();
            try {
              await copyToClipboard(formatted.copyText);
              copyBtn.innerHTML = checkIcon;
              copyBtn.classList.add("mf-copied");
              setTimeout(() => {
                copyBtn.innerHTML = copyIcon;
                copyBtn.classList.remove("mf-copied");
              }, 1500);
            } catch (_) {
              copyBtn.textContent = "!";
              setTimeout(() => {
                copyBtn.innerHTML = copyIcon;
                copyBtn.classList.remove("mf-copied");
              }, 1500);
            }
          });

          listItem.append(resultMain, copyBtn);

          listItem.addEventListener("mouseenter", function () {
            if (activeIndex !== index) {
              activeIndex = index;
              renderResults(currentRows);
            }
          });
          listItem.addEventListener("click", function () {
            selectRow(row);
          });

          resultList.appendChild(listItem);
        });
      }

      // ── Debounced search input ────────────────────────────────────
      const debouncedFilter = debounce(function () {
        lastSearchText = searchBox.value;
        currentRows = filterRows(originalData, lastSearchText);
        activeIndex = currentRows.length > 0 ? 0 : -1;
        renderResults(currentRows);
      }, 150);

      searchBox.addEventListener("input", debouncedFilter);

      // ── Header close button ───────────────────────────────────────
      headerCloseBtn.addEventListener("click", function () {
        closeSearchUI(searchContainer, searchIcon, searchBox, resultList);
      });
      headerCloseBtn.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          closeSearchUI(searchContainer, searchIcon, searchBox, resultList);
        }
      });

      // ── Keyboard navigation ───────────────────────────────────────
      searchBox.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closeSearchUI(searchContainer, searchIcon, searchBox, resultList);
          return;
        }
        if (event.key === "ArrowDown") {
          if (currentRows.length === 0) return;
          event.preventDefault();
          activeIndex = (activeIndex + 1) % currentRows.length;
          renderResults(currentRows);
          scrollActiveIntoView();
          return;
        }
        if (event.key === "ArrowUp") {
          if (currentRows.length === 0) return;
          event.preventDefault();
          activeIndex = (activeIndex - 1 + currentRows.length) % currentRows.length;
          renderResults(currentRows);
          scrollActiveIntoView();
          return;
        }
        if (event.key === "Enter") {
          if (currentRows.length > 0 && activeIndex >= 0 && activeIndex < currentRows.length) {
            event.preventDefault();
            selectRow(currentRows[activeIndex]);
          }
        }
      });

      // ── Initial render ────────────────────────────────────────────
      searchBox.focus();
      currentRows = originalData;
      activeIndex = currentRows.length > 0 ? 0 : -1;
      renderResults(currentRows);
    };

    searchIcon.onclick = openSearch;
    searchIcon.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openSearch(event);
      }
    });
  }
}
