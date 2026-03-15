// Initialize flags
let lastRecordId = "";
let lastUrl = "";
let requestToken = 0;
const STYLE_ELEMENT_ID = "metaforce-search-style";
const STATUS_ELEMENT_ID = "metaforce-status";
const LOADER_ELEMENT_ID = "mf-loader";
let detachOutsideCloseHandler = null;
let statusTimerId = null;

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
      chrome.runtime.sendMessage(
        { action: "copyToClipboard", text },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error((response && response.error) || "Copy failed"));
            return;
          }
          resolve();
        }
      );
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

// Initialize global variables
let globalTableData = [];
// Initialize your MutationObserver and start observing
const observer = new MutationObserver(() => {
  try {
    const currentUrl = window.location.href;

    if (currentUrl !== lastUrl) {
      const extractedData = extractObjectTypeFromURL(currentUrl);
      // Common clean-up
      removeSearchBox();
      globalTableData = [];
      lastRecordId = "";
      if (extractedData !== null) {
        lastRecordId = extractedData.recordId;
        mainLogic(extractedData);
      }

      lastUrl = currentUrl; // Update lastUrl to the current URL
    }
  } catch (error) {
    console.error("An error occurred in the MutationObserver:", error);
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
        response && response.error
          ? response.error
          : "Unable to fetch metadata for this record.",
        "error"
      );
      return;
    }

    const tableData = prepareTableData(response);
    globalTableData = tableData;

    if (extractedData.recordId && Array.isArray(tableData) && tableData.length > 0) {
      clearStatusNotice();
      createSearchBox(tableData, extractedData.objectType);
      return;
    }

    showStatusNotice("No metadata fields were returned for this record.", "info");
  } catch (error) {
    hideLoadingIndicator();
    showStatusNotice("Unable to load metadata. Check your Salesforce session.", "error");
    console.error("An error occurred in mainLogic:", error);
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
    globalTableData = [];
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
      const { type, value } = rawData[key];

      return {
        Field: key,
        Type: type,
        Value: value === null ? "null" : value,
      };
    });
  } catch (error) {
    console.error(
      "[ContentScript] prepareTableData  An error occurred:",
      error
    );
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
            console.error(
              "[ContentScript] Error in sendMessage:",
              chrome.runtime.lastError.message
            );
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
      const error = new Error("Extension context invalidated.");
      console.error("fetchMetadataAsync failed:", error);
      reject(error);
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
  if (mfRoot.querySelector("#" + STYLE_ELEMENT_ID)) {
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

  /* ── Dark mode ─────────────────────────────────────────────────── */
  @media (prefers-color-scheme: dark) {
    #${LOADER_ELEMENT_ID} {
      background: #1f1f1f;
      border-color: #3e3e3e;
    }
    .mf-spinner {
      border-color: #3e3e3e;
      border-top-color: #4b91f1;
    }
    #mf-trigger {
      background: #1a4a82;
      box-shadow: 0 2px 10px rgba(75,145,241,0.35);
    }
    #mf-trigger:hover {
      box-shadow: 0 4px 18px rgba(75,145,241,0.55);
    }
    #mf-panel {
      background: #1f1f1f;
      border-color: #3e3e3e;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    }
    .mf-panel-header { background: #1a4a82; }
    .mf-search-row { border-color: #333; }
    .mf-search-input {
      background: #2a2a2a;
      color: #f3f3f3;
      border-color: #4d4d4d;
    }
    .mf-search-input:focus {
      border-color: #4b91f1;
      box-shadow: 0 0 0 3px rgba(75,145,241,0.15);
    }
    .mf-result-item { color: #f3f3f3; }
    .mf-result-item:hover, .mf-result-item.active { background: #2a3448; }
    .mf-result-field-name { color: #f3f3f3; }
    .mf-result-value-preview { color: #999; }
    .mf-result-type-badge { color: #c9c9c9; background: #2a2a2a; border-color: #4d4d4d; }
    .mf-result-copy-btn { color: #888; }
    .mf-result-copy-btn:hover { background: #2a3448; border-color: #4b91f1; color: #4b91f1; }
    .mf-highlight { color: #4b91f1; }
    .mf-empty-state { color: #888; }
    .mf-selected-value { border-color: #333; }
    .mf-back-btn { background: #2a2a2a; border-color: #4d4d4d; color: #c9c9c9; }
    .mf-back-btn:hover { background: #2a3448; border-color: #4b91f1; color: #4b91f1; }
    .mf-selected-field { color: #f3f3f3; }
    .mf-type-badge { color: #c9c9c9; border-color: #4d4d4d; }
    .mf-value-text { background: #151515; color: #e8e8e8; }
    .mf-value-text.mf-null-value { background: #111; color: #666; }
    .mf-copy-btn { background: #1a4a82; color: #ffffff; border: none; }
    .mf-copy-btn:hover { background: #4b91f1; }
    .mf-copy-btn.mf-copied { background: #2e844a; }
    .mf-result-copy-btn { background: #2a2a2a; border-color: #4d4d4d; color: #c9c9c9; }
    .mf-result-copy-btn:hover { background: #4b91f1; border-color: #4b91f1; color: #ffffff; }
    .mf-result-copy-btn.mf-copied { background: #2e844a; border-color: #2e844a; color: #ffffff; }
    #${STATUS_ELEMENT_ID} { background: #1f1f1f; color: #f3f3f3; border-color: #3e3e3e; }
    #${STATUS_ELEMENT_ID}.mf-status-error { background: #3a1c21; border-color: #d45068; color: #ffdbe1; }
    #${STATUS_ELEMENT_ID}.mf-status-info  { background: #1f2f4a; border-color: #4b91f1; color: #d7e8ff; }
  }
  `;
  mfRoot.appendChild(style);
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

function createSearchBox(originalData, objectType = "") {
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
              closeSearchUI(existingContainer, searchIcon, existingSearchBox, existingContainer.querySelector("#mf-results"));
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

      searchContainer.append(panelHeader, searchRow, resultList);
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
        const formattedValue = formatFieldValue(matchedRow ? matchedRow.Value : undefined, fieldType);
        const isNullish = formattedValue.display === "null" || formattedValue.display === "(undefined)";

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
          typeBadge.textContent = row.Type || "—";

          resultTop.append(fieldNameSpan, typeBadge);

          // Value preview row
          const formatted = formatFieldValue(row.Value, row.Type ? String(row.Type) : "unknown");
          const previewRaw = formatted.display;
          const valuePreview = document.createElement("span");
          valuePreview.className = "mf-result-value-preview";
          valuePreview.textContent = previewRaw.length > 70 ? previewRaw.slice(0, 70) + "…" : previewRaw;
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
              setTimeout(() => { copyBtn.innerHTML = copyIcon; copyBtn.classList.remove("mf-copied"); }, 1500);
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
