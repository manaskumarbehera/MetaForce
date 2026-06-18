"use strict";

// Settings contract from the shared module (mf_shared.js → global MF).
const SETTINGS_KEY = MF.SETTINGS_KEY;
const DEFAULTS = MF.DEFAULT_SETTINGS;

// ── i18n: replace [data-i18n] text with localized messages ──────────────────
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

function applyTheme(theme) {
  // Page honors prefers-color-scheme by default; an explicit choice overrides.
  if (theme === "light" || theme === "dark") {
    document.documentElement.style.colorScheme = theme;
  } else {
    document.documentElement.style.colorScheme = "";
  }
}

function showStatus() {
  const status = document.getElementById("status");
  status.textContent = chrome.i18n.getMessage("settingsSaved") || "Settings saved.";
  status.classList.add("show");
  setTimeout(() => status.classList.remove("show"), 1800);
}

async function init() {
  localize();
  const settings = await loadSettings();

  const themeEl = document.getElementById("theme");
  const densityEl = document.getElementById("density");
  const apiEl = document.getElementById("apiVersion");
  const allDataEl = document.getElementById("enableAllData");
  const inlineEl = document.getElementById("enableInlineEdit");

  themeEl.value = settings.theme;
  densityEl.value = settings.density;
  apiEl.value = settings.apiVersion;
  allDataEl.checked = settings.enableAllData;
  inlineEl.checked = settings.enableInlineEdit;
  applyTheme(settings.theme);

  // Inline edit only makes sense when the tab is enabled.
  const syncInlineEnabled = () => {
    inlineEl.disabled = !allDataEl.checked;
    if (!allDataEl.checked) inlineEl.checked = false;
  };
  syncInlineEnabled();
  allDataEl.addEventListener("change", syncInlineEnabled);
  themeEl.addEventListener("change", () => applyTheme(themeEl.value));

  document.getElementById("saveButton").addEventListener("click", () => {
    let apiVersion = apiEl.value.trim() || DEFAULTS.apiVersion;
    // Normalize "67" / "67.0" / "v67" into the canonical "v67.0" REST form.
    const m = apiVersion.match(/^v?(\d+)(?:\.(\d+))?$/i);
    if (m) apiVersion = `v${m[1]}.${m[2] ?? "0"}`;
    apiEl.value = apiVersion;

    const next = {
      theme: themeEl.value,
      density: densityEl.value,
      apiVersion,
      enableAllData: allDataEl.checked,
      enableInlineEdit: allDataEl.checked && inlineEl.checked,
    };
    chrome.storage.sync.set({ [SETTINGS_KEY]: next }, showStatus);
  });
}

document.addEventListener("DOMContentLoaded", init);
