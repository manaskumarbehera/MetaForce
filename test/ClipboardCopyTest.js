/**
 * ClipboardCopyTest
 *
 * Unit-tests the offscreen clipboard handler logic in isolation.
 * We extract the handler's core behaviour into a pure function and exercise it
 * with mock DOM primitives — no Chrome extension APIs needed at test time.
 */

// ── Extract the handler logic (mirrors offscreen.js) ────────────────────────
// This pure function takes a message and DOM helpers and returns the response
// that the real listener would send back via sendResponse.
function handleCopyMessage(message, domHelpers) {
  if (message.target !== "offscreen" || message.action !== "copyToClipboard") {
    return null; // signals "ignored"
  }

  try {
    const textArea = domHelpers.createTextArea();
    textArea.value = message.text;
    domHelpers.appendToBody(textArea);
    textArea.select();
    const ok = domHelpers.execCommand("copy");
    domHelpers.removeElement(textArea);
    return ok
      ? { ok: true }
      : { ok: false, error: "execCommand copy returned false" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────
function assertEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${name} FAILED\n  expected: ${e}\n  actual:   ${a}`);
  }
  console.log(`PASS - ${name}`);
}

function makeMockDOM({ execCommandReturns = true, execCommandThrows = null } = {}) {
  let captured = null;
  return {
    captured: () => captured,
    createTextArea() {
      const ta = { value: "", selected: false, removed: false, select() { this.selected = true; } };
      captured = ta;
      return ta;
    },
    appendToBody(_el) { /* no-op */ },
    removeElement(el) { el.removed = true; },
    execCommand(cmd) {
      if (cmd !== "copy") throw new Error(`Unexpected command: ${cmd}`);
      if (execCommandThrows) throw execCommandThrows;
      return execCommandReturns;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
class ClipboardCopyTest {
  run() {
    // 1. Ignores messages not targeted at offscreen
    assertEqual(
      "ignores message with wrong target",
      handleCopyMessage({ target: "other", action: "copyToClipboard", text: "hi" }, makeMockDOM()),
      null
    );

    // 2. Ignores messages with wrong action
    assertEqual(
      "ignores message with wrong action",
      handleCopyMessage({ target: "offscreen", action: "fetchMetadata", text: "hi" }, makeMockDOM()),
      null
    );

    // 3. Successful copy
    {
      const dom = makeMockDOM({ execCommandReturns: true });
      const result = handleCopyMessage(
        { target: "offscreen", action: "copyToClipboard", text: "hello world" },
        dom
      );
      assertEqual("successful copy returns ok:true", result, { ok: true });
      assertEqual("textarea value set correctly", dom.captured().value, "hello world");
      assertEqual("textarea was selected", dom.captured().selected, true);
      assertEqual("textarea was removed", dom.captured().removed, true);
    }

    // 4. execCommand returns false
    {
      const dom = makeMockDOM({ execCommandReturns: false });
      const result = handleCopyMessage(
        { target: "offscreen", action: "copyToClipboard", text: "test" },
        dom
      );
      assertEqual("execCommand false returns ok:false", result.ok, false);
      assertEqual("execCommand false returns error message", result.error, "execCommand copy returned false");
    }

    // 5. execCommand throws
    {
      const dom = makeMockDOM({ execCommandThrows: new Error("DOM error") });
      const result = handleCopyMessage(
        { target: "offscreen", action: "copyToClipboard", text: "test" },
        dom
      );
      assertEqual("execCommand throw returns ok:false", result.ok, false);
      assertEqual("execCommand throw returns error message", result.error, "DOM error");
    }

    // 6. Empty string copy
    {
      const dom = makeMockDOM({ execCommandReturns: true });
      const result = handleCopyMessage(
        { target: "offscreen", action: "copyToClipboard", text: "" },
        dom
      );
      assertEqual("empty string copy returns ok:true", result, { ok: true });
      assertEqual("textarea value is empty string", dom.captured().value, "");
    }

    // 7. Large text / special characters
    {
      const special = "Line1\nLine2\t\"quotes\" <html> & symbols™ 🎉";
      const dom = makeMockDOM({ execCommandReturns: true });
      const result = handleCopyMessage(
        { target: "offscreen", action: "copyToClipboard", text: special },
        dom
      );
      assertEqual("special chars copy returns ok:true", result, { ok: true });
      assertEqual("special chars textarea value preserved", dom.captured().value, special);
    }

    // 8. null/undefined text
    {
      const dom = makeMockDOM({ execCommandReturns: true });
      const result = handleCopyMessage(
        { target: "offscreen", action: "copyToClipboard", text: null },
        dom
      );
      assertEqual("null text copy returns ok:true", result, { ok: true });
    }
  }
}

if (require.main === module) {
  const suite = new ClipboardCopyTest();
  suite.run();
}

module.exports = { ClipboardCopyTest, handleCopyMessage };

