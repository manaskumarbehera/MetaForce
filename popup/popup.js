"use strict";

// Settings contract from the shared module (mf_shared.js → global MF).
const SETTINGS_KEY = MF.SETTINGS_KEY;
const DEFAULTS = MF.DEFAULT_SETTINGS;

// Hosts where the content script runs (must match manifest content_scripts).
const SF_HOST =
  /(\.salesforce\.com|\.visual\.force\.com|\.lightning\.force\.com|\.cloudforce\.com|\.visualforce\.com)$/i;

function localize() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = chrome.i18n.getMessage(el.getAttribute("data-i18n"));
    if (msg) el.textContent = msg;
  });
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(SETTINGS_KEY, (stored) => {
      resolve({ ...DEFAULTS, ...(stored && stored[SETTINGS_KEY]) });
    });
  });
}

function saveSettings(settings) {
  chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

function reflectActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const dot = document.getElementById("statusDot");
    const text = document.getElementById("stateText");
    let onSf = false;
    try {
      const url = tabs && tabs[0] && tabs[0].url ? new URL(tabs[0].url) : null;
      onSf = !!url && SF_HOST.test(url.hostname);
    } catch (_) {
      onSf = false;
    }
    dot.classList.toggle("dot--on", onSf);
    dot.classList.toggle("dot--off", !onSf);
    text.textContent = chrome.i18n.getMessage(onSf ? "popupActiveOnSf" : "popupInactive");
  });
}

async function init() {
  localize();
  reflectActiveTab();

  const settings = await loadSettings();
  const allDataEl = document.getElementById("enableAllData");
  const inlineEl = document.getElementById("enableInlineEdit");

  allDataEl.checked = settings.enableAllData;
  inlineEl.checked = settings.enableInlineEdit;

  const syncInline = () => {
    inlineEl.disabled = !allDataEl.checked;
    if (!allDataEl.checked) inlineEl.checked = false;
  };
  syncInline();

  const persist = () => {
    saveSettings({
      ...settings,
      enableAllData: allDataEl.checked,
      enableInlineEdit: allDataEl.checked && inlineEl.checked,
    });
  };

  allDataEl.addEventListener("change", () => {
    syncInline();
    persist();
  });
  inlineEl.addEventListener("change", persist);

  document.getElementById("openSettings").addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options/options.html"));
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
