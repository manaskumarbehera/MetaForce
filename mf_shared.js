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

  // Keyboard shortcuts are stored as plain descriptors so the options page can
  // record them and the content script can match them. Ctrl-based defaults work
  // on every platform (Cmd combos are macOS menu equivalents Chrome grabs
  // before the page ever sees the keydown).
  const DEFAULT_SHORTCUTS = {
    togglePanel: { ctrl: true, alt: false, shift: true, meta: false, code: "KeyM", key: "M" },
    nextTab: { ctrl: true, alt: false, shift: true, meta: false, code: "Period", key: "." },
    prevTab: { ctrl: true, alt: false, shift: true, meta: false, code: "Comma", key: "," },
  };

  const DEFAULT_SETTINGS = {
    theme: "system", // "system" | "light" | "dark"
    apiVersion: "v67.0",
    enableAllData: true,
    enableInlineEdit: false,
    density: "comfortable", // "comfortable" | "compact"
    triggerPosition: "middle-right", // "top-right" | "middle-right" | "bottom-right"
    shortcuts: DEFAULT_SHORTCUTS,
  };

  // Merge stored shortcuts over the defaults. The top-level settings merge is
  // shallow, so a settings object saved by an older version has no `shortcuts`
  // key at all — and a partial one must never leave an action unbound.
  function getShortcuts(settings) {
    const stored = (settings && settings.shortcuts) || {};
    return {
      togglePanel: stored.togglePanel || DEFAULT_SHORTCUTS.togglePanel,
      nextTab: stored.nextTab || DEFAULT_SHORTCUTS.nextTab,
      prevTab: stored.prevTab || DEFAULT_SHORTCUTS.prevTab,
    };
  }

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

  // Build a ready-to-run SOQL query from the record's fields. Id is forced first
  // (Salesforce convention); duplicates and empties are dropped. The recordId is
  // single-quote-escaped defensively even though Salesforce IDs never contain one.
  function recordToSoql(rows, objectType, recordId) {
    const seen = new Set();
    const fields = [];
    (rows || []).forEach((row) => {
      const f = row && row.Field;
      if (f && !seen.has(f)) {
        seen.add(f);
        fields.push(f);
      }
    });
    const idAt = fields.indexOf("Id");
    if (idAt > 0) fields.splice(idAt, 1);
    if (idAt !== 0) fields.unshift("Id");
    let soql = `SELECT ${fields.join(", ")}\nFROM ${objectType || "SObject"}`;
    if (recordId) soql += `\nWHERE Id = '${String(recordId).replace(/'/g, "\\'")}'`;
    return soql;
  }

  // ── Keyboard shortcut helpers (pure; unit-tested) ─────────────────────────
  // A descriptor is { ctrl, alt, shift, meta, code, key } where `code` is the
  // physical KeyboardEvent.code (layout-independent — Alt+M on macOS types "µ"
  // but the code stays "KeyM") and `key` is the human label shown in the UI.

  // Human label for a KeyboardEvent.code, falling back to the event.key.
  const CODE_LABELS = {
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Space: "Space",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
  };

  function shortcutKeyLabel(code, key) {
    if (!code) return String(key || "").toUpperCase();
    if (CODE_LABELS[code]) return CODE_LABELS[code];
    let m = code.match(/^Key([A-Z])$/);
    if (m) return m[1];
    m = code.match(/^Digit(\d)$/);
    if (m) return m[1];
    m = code.match(/^Numpad(\w+)$/);
    if (m) return `Num ${m[1]}`;
    if (/^F\d{1,2}$/.test(code)) return code;
    return key && key.length === 1 ? key.toUpperCase() : code;
  }

  // Build a descriptor from a keydown event; null while only modifiers are down.
  function shortcutFromEvent(event) {
    const key = event.key;
    if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return null;
    return {
      ctrl: !!event.ctrlKey,
      alt: !!event.altKey,
      shift: !!event.shiftKey,
      meta: !!event.metaKey,
      code: event.code,
      key: shortcutKeyLabel(event.code, event.key),
    };
  }

  function shortcutMatches(descriptor, event) {
    return !!(
      descriptor &&
      descriptor.code &&
      event.code === descriptor.code &&
      !!event.ctrlKey === !!descriptor.ctrl &&
      !!event.altKey === !!descriptor.alt &&
      !!event.shiftKey === !!descriptor.shift &&
      !!event.metaKey === !!descriptor.meta
    );
  }

  function formatShortcut(descriptor, isMac) {
    if (!descriptor || !descriptor.code) return "";
    const parts = [];
    if (descriptor.ctrl) parts.push("Ctrl");
    if (descriptor.alt) parts.push(isMac ? "Option" : "Alt");
    if (descriptor.shift) parts.push("Shift");
    if (descriptor.meta) parts.push(isMac ? "Cmd" : "Win");
    parts.push(descriptor.key || shortcutKeyLabel(descriptor.code));
    return parts.join("+");
  }

  // Combos the browser or OS handles before the page sees the keydown — a
  // content script cannot intercept or override these, so the recorder must
  // reject them outright (Ctrl/Cmd+T/N/W, tab cycling, quit/hide/minimize…).
  function shortcutIsReserved(descriptor, isMac) {
    if (!descriptor || !descriptor.code) return false;
    const d = descriptor;
    const primary = d.ctrl || d.meta;
    if (primary && (d.code === "KeyT" || d.code === "KeyN" || d.code === "KeyW")) return true;
    if (d.ctrl && d.code === "Tab") return true;
    if ((d.ctrl || d.meta) && d.shift && d.code === "KeyQ") return true;
    if (d.alt && (d.code === "F4" || d.code === "Tab")) return true;
    if (d.ctrl && d.code === "F4") return true;
    if (isMac && d.meta) {
      if (["KeyQ", "KeyH", "KeyM", "Backquote", "Comma", "Tab"].includes(d.code)) return true;
    }
    return false;
  }

  // Combos that do reach the page but shadow a very common browser action
  // (find, print, save, reload…). Allowed, with a warning in the recorder.
  function shortcutIsDiscouraged(descriptor) {
    if (!descriptor || !descriptor.code) return false;
    const d = descriptor;
    const primary = (d.ctrl || d.meta) && !d.alt && !d.shift;
    const common = [
      "KeyF",
      "KeyP",
      "KeyS",
      "KeyD",
      "KeyG",
      "KeyL",
      "KeyR",
      "KeyK",
      "KeyE",
      "KeyA",
      "KeyC",
      "KeyV",
      "KeyX",
      "KeyZ",
      "KeyU",
      "KeyO",
      "KeyJ",
      "KeyB",
      "KeyI",
    ];
    return primary && common.includes(d.code);
  }

  // Recorder validation: { ok, reason?, warn? }.
  function validateShortcut(descriptor, isMac) {
    if (!descriptor || !descriptor.code) return { ok: false, reason: "empty" };
    if (!descriptor.ctrl && !descriptor.meta && !descriptor.alt) {
      return { ok: false, reason: "needModifier" };
    }
    if (shortcutIsReserved(descriptor, isMac)) return { ok: false, reason: "reserved" };
    return { ok: true, warn: shortcutIsDiscouraged(descriptor) };
  }

  function shortcutsEqual(a, b) {
    return !!(
      a &&
      b &&
      a.code === b.code &&
      !!a.ctrl === !!b.ctrl &&
      !!a.alt === !!b.alt &&
      !!a.shift === !!b.shift &&
      !!a.meta === !!b.meta
    );
  }

  // Safe, rarely-bound combos the options page offers as suggestions.
  const SHORTCUT_SUGGESTIONS = [
    { ctrl: true, alt: false, shift: true, meta: false, code: "KeyY", key: "Y" },
    { ctrl: true, alt: false, shift: true, meta: false, code: "Space", key: "Space" },
    { ctrl: true, alt: false, shift: true, meta: false, code: "KeyU", key: "U" },
    { ctrl: false, alt: true, shift: true, meta: false, code: "KeyM", key: "M" },
  ];

  // URL of the org's Developer Console. It lives on the instance
  // (my.salesforce.com) domain, so map a Lightning host across; other hosts
  // (already my.salesforce.com, Classic, VF) are used as-is.
  function devConsoleUrl(hostname) {
    const h = String(hostname || "").replace(/\.lightning\.force\.com$/, ".my.salesforce.com");
    return `https://${h}/_ui/common/apex/debug/ApexCSIPage`;
  }

  root.MF = {
    SETTINGS_KEY,
    FAVORITES_KEY,
    DEFAULT_SETTINGS,
    DEFAULT_SHORTCUTS,
    SHORTCUT_SUGGESTIONS,
    getShortcuts,
    shortcutKeyLabel,
    shortcutFromEvent,
    shortcutMatches,
    formatShortcut,
    shortcutIsReserved,
    shortcutIsDiscouraged,
    validateShortcut,
    shortcutsEqual,
    getSettings,
    setSettings,
    getFavorites,
    toggleFavorite,
    fieldKind,
    recordToJson,
    recordToCsv,
    recordToSoql,
    devConsoleUrl,
    escapeCsv,
  };
})(typeof self !== "undefined" ? self : this);

// Make the helpers importable by the jest suite without touching the global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof self !== "undefined" ? self : this).MF;
}
