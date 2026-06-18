// ── MetaForce shared module ──────────────────────────────────────────────────
// The single source of truth for settings, favorites, and small helpers, shared
// across every extension context:
//   - content script  -> listed first in manifest content_scripts (sets self.MF)
//   - service worker   -> importScripts("mf_shared.js") at the top of background.js
//   - popup / options  -> <script src="../mf_shared.js"> before the page script
// Top-level `const` in a content-script file is not visible to sibling files, so
// everything is hung off the shared global (self) instead.
(function (root) {
  "use strict";

  const SETTINGS_KEY = "metaforceSettings";
  const FAVORITES_KEY = "metaforceFavorites";

  const DEFAULT_SETTINGS = {
    theme: "system", // "system" | "light" | "dark"
    apiVersion: "v67.0",
    enableAllData: true,
    enableInlineEdit: false,
    density: "comfortable", // "comfortable" | "compact"
  };

  function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(SETTINGS_KEY, (stored) => {
          resolve({ ...DEFAULT_SETTINGS, ...(stored && stored[SETTINGS_KEY]) });
        });
      } catch (_) {
        resolve({ ...DEFAULT_SETTINGS });
      }
    });
  }

  function setSettings(next) {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.set({ [SETTINGS_KEY]: next }, resolve);
      } catch (_) {
        resolve();
      }
    });
  }

  // Favorites are stored per object type: { [objectType]: ["Field1", "Field2"] }.
  function getFavorites(objectType) {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(FAVORITES_KEY, (stored) => {
          const all = (stored && stored[FAVORITES_KEY]) || {};
          resolve(objectType ? all[objectType] || [] : all);
        });
      } catch (_) {
        resolve(objectType ? [] : {});
      }
    });
  }

  function toggleFavorite(objectType, field) {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(FAVORITES_KEY, (stored) => {
          const all = (stored && stored[FAVORITES_KEY]) || {};
          const list = new Set(all[objectType] || []);
          if (list.has(field)) list.delete(field);
          else list.add(field);
          all[objectType] = [...list];
          chrome.storage.sync.set({ [FAVORITES_KEY]: all }, () => resolve(all[objectType]));
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  // Coarse field-type categories used for color-coded chips. Keep in sync with
  // the --mf-kind-* tokens in the stylesheet.
  function fieldKind(type) {
    switch (type) {
      case "id":
      case "reference":
        return "id";
      case "boolean":
        return "bool";
      case "int":
      case "double":
      case "currency":
      case "percent":
        return "number";
      case "date":
      case "datetime":
      case "time":
        return "date";
      case "email":
      case "phone":
      case "url":
        return "contact";
      case "picklist":
      case "multipicklist":
      case "combobox":
        return "picklist";
      case "textarea":
      case "string":
      case "encryptedstring":
        return "text";
      default:
        return "other";
    }
  }

  // ── Export helpers (pure; unit-tested) ────────────────────────────────────
  function recordToJson(rows) {
    const out = {};
    rows.forEach((row) => {
      out[row.Field] = row.RawValue === undefined ? null : row.RawValue;
    });
    return JSON.stringify(out, null, 2);
  }

  function escapeCsv(value) {
    const s =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function recordToCsv(rows) {
    const header = ["Label", "API Name", "Type", "Value"];
    const lines = [header.map(escapeCsv).join(",")];
    rows.forEach((row) => {
      lines.push(
        [row.Label || row.Field, row.Field, row.Type || "", row.RawValue].map(escapeCsv).join(",")
      );
    });
    return lines.join("\r\n");
  }

  root.MF = {
    SETTINGS_KEY,
    FAVORITES_KEY,
    DEFAULT_SETTINGS,
    getSettings,
    setSettings,
    getFavorites,
    toggleFavorite,
    fieldKind,
    recordToJson,
    recordToCsv,
    escapeCsv,
  };
})(typeof self !== "undefined" ? self : this);

// Make the helpers importable by the jest suite without touching the global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof self !== "undefined" ? self : this).MF;
}
