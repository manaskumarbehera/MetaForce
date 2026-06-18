// Shared settings/helpers (see mf_shared.js). importScripts runs synchronously
// at the top of the classic service worker, so MF is ready for everything below.
importScripts("mf_shared.js");

let contentScriptLoadedTabs = new Set();

function getSettings() {
  return MF.getSettings();
}

async function getApiVersion() {
  const settings = await MF.getSettings();
  return settings.apiVersion || MF.DEFAULT_SETTINGS.apiVersion;
}

// ── Offscreen document (clipboard) ──────────────────────────────────────────
let _creatingOffscreen = null;

async function ensureOffscreenDocument() {
  // chrome.runtime.getContexts is available Chrome 116+ / Edge 116+.
  // Guard for older Edge versions that lack it.
  if (typeof chrome.runtime.getContexts === "function") {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen.html")],
    });
    if (existing.length > 0) return;
  }

  if (_creatingOffscreen) {
    await _creatingOffscreen;
    return;
  }

  if (!chrome.offscreen) {
    throw new Error("Offscreen API not available in this browser");
  }

  try {
    _creatingOffscreen = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: "Copy Salesforce field value to clipboard",
    });
    await _creatingOffscreen;
  } catch (err) {
    // If getContexts was unavailable we may try to create a document that
    // already exists — tolerate that specific error.
    if (!err.message?.includes("Only a single offscreen")) throw err;
  } finally {
    _creatingOffscreen = null;
  }
}

function sendError(sendResponse, message) {
  sendResponse({ error: message });
}
function sendSuccess(sendResponse, data) {
  sendResponse({ data: data });
}
async function getAuthToken(domain, storeId) {
  return new Promise((resolve, reject) => {
    const details = { url: `https://${domain}`, name: "sid" };
    if (storeId) details.storeId = storeId;
    chrome.cookies.get(details, (cookie) => {
      if (cookie && cookie.value) {
        resolve(cookie.value);
      } else {
        reject(new Error("SID cookie not found or has no value"));
      }
    });
  });
}

async function fetchData(url, sidAuthToken, options = {}) {
  const { method = "GET", body = null } = options;
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${sidAuthToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body !== null) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);

  if (!response.ok) {
    // Salesforce normally returns JSON errors, but intermediary proxies or
    // auth failures may return HTML/plain text. Parse safely.
    let errorBody;
    const contentType = response.headers.get("content-type") || "";
    try {
      if (contentType.includes("application/json")) {
        errorBody = JSON.stringify(await response.json());
      } else {
        errorBody = await response.text();
      }
    } catch (_) {
      errorBody = `HTTP ${response.status} ${response.statusText}`;
    }
    throw new Error(errorBody);
  }

  // PATCH/DELETE return 204 No Content; reading .json() on an empty body throws.
  if (response.status === 204) {
    return {};
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function fetchObjectMetadata(objectType, recordId, domain, storeId) {
  const sidAuthToken = await getAuthToken(domain, storeId);
  const apiVersion = await getApiVersion();
  const endpointMetaUrl = `https://${domain}/services/data/${apiVersion}/sobjects/${objectType}/describe/`;
  const endpointRecordUrl = `https://${domain}/services/data/${apiVersion}/sobjects/${objectType}/${recordId}/`;

  const [metadata, record] = await Promise.all([
    fetchData(endpointMetaUrl, sidAuthToken),
    fetchData(endpointRecordUrl, sidAuthToken),
  ]);

  const combinedData = {};

  // Keep the original { type, value } shape (the Search tab depends on it) and
  // enrich with describe metadata the All Data tab needs (label, updateable,
  // referenceTo, nillable). See DOCUMENTATION/architecture.md.
  for (const field of metadata.fields) {
    const { name, type, label, updateable, referenceTo, nillable } = field;
    combinedData[name] = {
      type,
      value: record[name],
      label: label || name,
      updateable: updateable === true,
      referenceTo: Array.isArray(referenceTo) ? referenceTo : [],
      nillable: nillable === true,
    };
  }

  return combinedData;
}

// Resolve the org's session cookie domain from a record-page origin. Mirrors the
// salesforce.com → cloudforce.com fallback used by handleFetchMetadata, exposed
// as a promise so the update path can reuse it.
function resolveSessionDomain(baseUrl, storeId) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: baseUrl, name: "sid", storeId }, (cookie) => {
      if (!cookie) {
        resolve(null);
        return;
      }
      const [orgId] = cookie.value.split("!");
      const tryDomain = (domain, next) => {
        chrome.cookies.getAll({ name: "sid", domain, secure: true, storeId }, (cookies) => {
          const match = cookies.find((c) => c.value.startsWith(orgId + "!"));
          if (match) resolve(match.domain);
          else if (next) next();
          else resolve(null);
        });
      };
      tryDomain("salesforce.com", () => tryDomain("cloudforce.com", null));
    });
  });
}

// PATCH a single field back to Salesforce. Gated on the enableInlineEdit
// setting as defense-in-depth (the content script also gates the UI).
async function handleUpdateField(message, sender, sendResponse) {
  try {
    const settings = await getSettings();
    if (settings.enableInlineEdit !== true) {
      sendResponse({ error: "Inline editing is disabled in MetaForce settings." });
      return;
    }
    const storeId = sender.tab?.cookieStoreId;
    const domain = await resolveSessionDomain(message.baseUrl, storeId);
    if (!domain) {
      sendResponse({ error: "Salesforce session cookie not found." });
      return;
    }
    const sidAuthToken = await getAuthToken(domain, storeId);
    const apiVersion = await getApiVersion();
    const url = `https://${domain}/services/data/${apiVersion}/sobjects/${message.objectType}/${message.recordId}`;
    await fetchData(url, sidAuthToken, {
      method: "PATCH",
      body: { [message.fieldName]: message.value },
    });
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleFetchMetadata(message, sender, sendResponse) {
  let hasSentData = false;
  const storeId = sender.tab?.cookieStoreId;
  let fetchAndRespond = async (cookieDomain) => {
    try {
      const data = await fetchObjectMetadata(
        message.objectType,
        message.recordId,
        cookieDomain,
        storeId
      );
      if (!hasSentData) {
        sendSuccess(sendResponse, data);
        hasSentData = true;
      }
    } catch (error) {
      if (!hasSentData) {
        sendError(sendResponse, error.message);
        hasSentData = true;
      }
    }
  };

  // Rest of the cookie fetching code here...
  chrome.cookies.get(
    { url: message.baseUrl, name: "sid", storeId: sender.tab.cookieStoreId },
    (cookie) => {
      if (!cookie) {
        sendResponse(null);
        return;
      }
      let [orgId] = cookie.value.split("!");
      chrome.cookies.getAll(
        {
          name: "sid",
          domain: "salesforce.com",
          secure: true,
          storeId: sender.tab.cookieStoreId,
        },
        (cookies) => {
          let sessionCookie = cookies.find((c) => c.value.startsWith(orgId + "!"));
          if (sessionCookie) {
            fetchAndRespond(sessionCookie.domain); // Replace fetchObjectMetadata with fetchAndRespond
          } else {
            // If sessionCookie is not found in 'salesforce.com', try 'cloudforce.com'
            chrome.cookies.getAll(
              {
                name: "sid",
                domain: "cloudforce.com",
                secure: true,
                storeId: sender.tab.cookieStoreId,
              },
              (cookies) => {
                sessionCookie = cookies.find((c) => c.value.startsWith(orgId + "!"));
                if (sessionCookie) {
                  fetchAndRespond(sessionCookie.domain);
                } else {
                  sendResponse(null);
                }
              }
            );
          }
        }
      );
    }
  );
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages intended for the offscreen document (they pass through here)
  if (message.target === "offscreen") return false;

  switch (message.action) {
    case "copyToClipboard":
      (async () => {
        // Always delegate to the offscreen document. navigator.clipboard in a
        // service worker can resolve without actually writing to the clipboard
        // (service workers are never focused), so we skip it entirely and use
        // the Chrome-sanctioned execCommand path in the offscreen document.
        try {
          await ensureOffscreenDocument();
          chrome.runtime.sendMessage(
            { target: "offscreen", action: "copyToClipboard", text: message.text },
            (response) => {
              if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              sendResponse(response ?? { ok: false });
            }
          );
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    case "CONTENT_SCRIPT_LOADED":
      if (sender.tab && sender.tab.id) contentScriptLoadedTabs.add(sender.tab.id);
      sendResponse({ status: "ok" });
      break;
    case "fetchMetadata":
    case "handleUrlChange":
      handleFetchMetadata(message, sender, sendResponse);
      return true;
    case "updateField":
      handleUpdateField(message, sender, sendResponse);
      return true;
    default:
      sendResponse({ status: "unexpected_message" });
      break;
  }
});

// Keyboard shortcut (Ctrl/Cmd+Shift+M) → ask the active tab to toggle the panel.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command !== "toggle-panel") return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (tab && tab.id != null) {
        chrome.tabs.sendMessage(
          tab.id,
          { action: "togglePanel" },
          () => void chrome.runtime.lastError
        );
      }
    });
  });
}
