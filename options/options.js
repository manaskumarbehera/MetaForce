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

function msg(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch (_) {
    return fallback;
  }
}

// ── Shortcut recorder ────────────────────────────────────────────────────────
// Click a shortcut button → it waits for a key combo. Validation lives in
// mf_shared.js (modifier required, browser-reserved combos rejected).
const SHORTCUT_ACTIONS = ["togglePanel", "nextTab", "prevTab"];
const IS_MAC = /mac/i.test(navigator.platform || "");

function setupShortcutRecorder(shortcuts) {
  const statusEl = document.getElementById("shortcutStatus");
  let recording = null; // action name while waiting for keys

  const suggestionText = () => {
    const taken = SHORTCUT_ACTIONS.map((a) => shortcuts[a]);
    return MF.SHORTCUT_SUGGESTIONS.filter((s) => !taken.some((t) => MF.shortcutsEqual(s, t)))
      .map((s) => MF.formatShortcut(s, IS_MAC))
      .join(", ");
  };

  const setStatus = (text, kind) => {
    statusEl.textContent = text;
    statusEl.classList.toggle("hint--warn", kind === "warn");
    statusEl.classList.toggle("hint--error", kind === "error");
  };

  const render = () => {
    SHORTCUT_ACTIONS.forEach((action) => {
      const btn = document.getElementById("sc-" + action);
      btn.classList.toggle("recording", recording === action);
      btn.textContent =
        recording === action
          ? msg("shortcutPressKeys", "Press keys… (Esc cancels)")
          : MF.formatShortcut(shortcuts[action], IS_MAC);
    });
  };

  const stopRecording = () => {
    recording = null;
    render();
  };

  SHORTCUT_ACTIONS.forEach((action) => {
    const btn = document.getElementById("sc-" + action);

    btn.addEventListener("click", () => {
      recording = action;
      setStatus(msg("shortcutPressKeys", "Press keys… (Esc cancels)"), "");
      render();
    });

    btn.addEventListener("blur", () => {
      if (recording === action) {
        stopRecording();
        setStatus("", "");
      }
    });

    btn.addEventListener("keydown", (event) => {
      if (recording !== action) {
        // Not recording: Enter/Space activate the button normally.
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        stopRecording();
        setStatus("", "");
        return;
      }

      const descriptor = MF.shortcutFromEvent(event);
      if (!descriptor) {
        // Only modifiers held so far — show the combo building up.
        btn.textContent = MF.formatShortcut(
          {
            ctrl: event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey,
            meta: event.metaKey,
            code: "Pending",
            key: "…",
          },
          IS_MAC
        );
        return;
      }

      const verdict = MF.validateShortcut(descriptor, IS_MAC);
      if (!verdict.ok) {
        const reasonMsg =
          verdict.reason === "needModifier"
            ? msg("shortcutNeedModifier", "Include Ctrl, Cmd, or Alt. Free combos:")
            : msg(
                "shortcutReserved",
                "The browser reserves that combo — it can't be overridden. Free combos:"
              );
        setStatus(`${reasonMsg} ${suggestionText()}`, "error");
        return;
      }

      const clash = SHORTCUT_ACTIONS.find(
        (other) => other !== action && MF.shortcutsEqual(shortcuts[other], descriptor)
      );
      if (clash) {
        setStatus(
          msg(
            "shortcutDuplicate",
            "Already used by another MetaForce shortcut — pick a different combo."
          ),
          "error"
        );
        return;
      }

      shortcuts[action] = descriptor;
      stopRecording();
      setStatus(
        verdict.warn
          ? msg(
              "shortcutDiscouraged",
              "Set — note this combo shadows a common browser action on Salesforce pages. Click Save to apply."
            )
          : msg("shortcutSet", "Shortcut set — click Save to apply."),
        verdict.warn ? "warn" : ""
      );
    });
  });

  document.querySelectorAll(".shortcut-reset").forEach((resetBtn) => {
    resetBtn.addEventListener("click", () => {
      const action = resetBtn.getAttribute("data-reset");
      shortcuts[action] = MF.DEFAULT_SHORTCUTS[action];
      stopRecording();
      setStatus(msg("shortcutSet", "Shortcut set — click Save to apply."), "");
    });
  });

  render();
}

async function init() {
  localize();
  const settings = await loadSettings();

  const themeEl = document.getElementById("theme");
  const densityEl = document.getElementById("density");
  const apiEl = document.getElementById("apiVersion");
  const allDataEl = document.getElementById("enableAllData");
  const inlineEl = document.getElementById("enableInlineEdit");
  const positionEl = document.getElementById("triggerPosition");

  themeEl.value = settings.theme;
  densityEl.value = settings.density;
  apiEl.value = settings.apiVersion;
  allDataEl.checked = settings.enableAllData;
  inlineEl.checked = settings.enableInlineEdit;
  positionEl.value = settings.triggerPosition || DEFAULTS.triggerPosition;
  applyTheme(settings.theme);

  const shortcuts = MF.getShortcuts(settings);
  setupShortcutRecorder(shortcuts);

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
      triggerPosition: positionEl.value,
      shortcuts: {
        togglePanel: shortcuts.togglePanel,
        nextTab: shortcuts.nextTab,
        prevTab: shortcuts.prevTab,
      },
    };
    chrome.storage.sync.set({ [SETTINGS_KEY]: next }, showStatus);
  });
}

document.addEventListener("DOMContentLoaded", init);
