// Exercises the pure keyboard-shortcut helpers in mf_shared.js: descriptor
// construction from keydown events, matching, formatting, and the recorder's
// validation rules (modifier required, browser-reserved combos rejected).
const MF = require("../mf_shared.js");

const evt = (over = {}) => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  key: "m",
  code: "KeyM",
  ...over,
});

describe("shortcutFromEvent", () => {
  test("builds a descriptor from a full combo", () => {
    expect(MF.shortcutFromEvent(evt({ ctrlKey: true, shiftKey: true, key: "M" }))).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
      code: "KeyM",
      key: "M",
    });
  });

  test("returns null while only modifiers are down", () => {
    ["Control", "Shift", "Alt", "Meta"].forEach((key) => {
      expect(MF.shortcutFromEvent(evt({ key, code: key + "Left" }))).toBeNull();
    });
  });

  test("uses the physical code, not the produced character (Alt+M on macOS types µ)", () => {
    const d = MF.shortcutFromEvent(evt({ altKey: true, key: "µ", code: "KeyM" }));
    expect(d.code).toBe("KeyM");
    expect(d.key).toBe("M");
  });
});

describe("shortcutKeyLabel", () => {
  test.each([
    ["KeyM", "M"],
    ["Digit5", "5"],
    ["Comma", ","],
    ["Period", "."],
    ["Space", "Space"],
    ["ArrowRight", "Right"],
    ["F6", "F6"],
    ["Numpad1", "Num 1"],
  ])("%s → %s", (code, label) => {
    expect(MF.shortcutKeyLabel(code)).toBe(label);
  });
});

describe("shortcutMatches", () => {
  const toggle = MF.DEFAULT_SHORTCUTS.togglePanel; // Ctrl+Shift+M

  test("matches the exact combo", () => {
    expect(MF.shortcutMatches(toggle, evt({ ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  test("rejects extra or missing modifiers and other keys", () => {
    expect(MF.shortcutMatches(toggle, evt({ ctrlKey: true }))).toBe(false);
    expect(MF.shortcutMatches(toggle, evt({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(
      false
    );
    expect(MF.shortcutMatches(toggle, evt({ ctrlKey: true, shiftKey: true, code: "KeyN" }))).toBe(
      false
    );
    expect(MF.shortcutMatches(null, evt())).toBe(false);
  });
});

describe("formatShortcut", () => {
  test("orders modifiers and uses platform names", () => {
    const d = { ctrl: true, alt: true, shift: true, meta: false, code: "KeyM", key: "M" };
    expect(MF.formatShortcut(d, false)).toBe("Ctrl+Alt+Shift+M");
    expect(MF.formatShortcut(d, true)).toBe("Ctrl+Option+Shift+M");
    expect(
      MF.formatShortcut(
        { ctrl: false, alt: false, shift: false, meta: true, code: "KeyK", key: "K" },
        true
      )
    ).toBe("Cmd+K");
  });

  test("returns empty string for unset descriptors", () => {
    expect(MF.formatShortcut(null, false)).toBe("");
    expect(MF.formatShortcut({ code: "" }, false)).toBe("");
  });
});

describe("validateShortcut", () => {
  test("requires Ctrl, Cmd, or Alt", () => {
    const d = { ctrl: false, alt: false, shift: true, meta: false, code: "KeyM", key: "M" };
    expect(MF.validateShortcut(d, false)).toEqual({ ok: false, reason: "needModifier" });
  });

  test("rejects browser-reserved combos on every platform", () => {
    ["KeyT", "KeyN", "KeyW"].forEach((code) => {
      const d = { ctrl: true, alt: false, shift: false, meta: false, code, key: code[3] };
      expect(MF.validateShortcut(d, false)).toEqual({ ok: false, reason: "reserved" });
    });
    const ctrlTab = { ctrl: true, alt: false, shift: false, meta: false, code: "Tab", key: "Tab" };
    expect(MF.validateShortcut(ctrlTab, false).ok).toBe(false);
  });

  test("rejects macOS app-level Cmd combos only on mac", () => {
    const cmdQ = { ctrl: false, alt: false, shift: false, meta: true, code: "KeyQ", key: "Q" };
    expect(MF.validateShortcut(cmdQ, true)).toEqual({ ok: false, reason: "reserved" });
    expect(MF.validateShortcut(cmdQ, false).ok).toBe(true);
    const cmdH = { ctrl: false, alt: false, shift: false, meta: true, code: "KeyH", key: "H" };
    expect(MF.validateShortcut(cmdH, true).ok).toBe(false);
  });

  test("warns on combos that shadow common browser actions", () => {
    const ctrlF = { ctrl: true, alt: false, shift: false, meta: false, code: "KeyF", key: "F" };
    expect(MF.validateShortcut(ctrlF, false)).toEqual({ ok: true, warn: true });
    // Adding Shift moves it out of the discouraged set.
    expect(MF.validateShortcut({ ...ctrlF, shift: true }, false)).toEqual({
      ok: true,
      warn: false,
    });
  });

  test("accepts the shipped defaults and suggestions everywhere", () => {
    [true, false].forEach((isMac) => {
      Object.values(MF.DEFAULT_SHORTCUTS).forEach((d) => {
        expect(MF.validateShortcut(d, isMac)).toEqual({ ok: true, warn: false });
      });
      MF.SHORTCUT_SUGGESTIONS.forEach((d) => {
        expect(MF.validateShortcut(d, isMac).ok).toBe(true);
      });
    });
  });
});

describe("shortcutsEqual + getShortcuts", () => {
  test("equality ignores the display label", () => {
    const a = { ctrl: true, alt: false, shift: true, meta: false, code: "KeyM", key: "M" };
    expect(MF.shortcutsEqual(a, { ...a, key: "different" })).toBe(true);
    expect(MF.shortcutsEqual(a, { ...a, code: "KeyN" })).toBe(false);
    expect(MF.shortcutsEqual(a, null)).toBe(false);
  });

  test("getShortcuts falls back per-action for settings saved by older versions", () => {
    expect(MF.getShortcuts({})).toEqual(MF.DEFAULT_SHORTCUTS);
    expect(MF.getShortcuts(null)).toEqual(MF.DEFAULT_SHORTCUTS);
    const custom = { ctrl: true, alt: false, shift: true, meta: false, code: "KeyY", key: "Y" };
    const merged = MF.getShortcuts({ shortcuts: { togglePanel: custom } });
    expect(merged.togglePanel).toEqual(custom);
    expect(merged.nextTab).toEqual(MF.DEFAULT_SHORTCUTS.nextTab);
    expect(merged.prevTab).toEqual(MF.DEFAULT_SHORTCUTS.prevTab);
  });
});
