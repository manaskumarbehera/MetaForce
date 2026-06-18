// Mirrors the offscreen clipboard handler core in offscreen.js.
function handleCopyMessage(message, dom) {
  if (message.target !== "offscreen" || message.action !== "copyToClipboard") {
    return null; // ignored
  }
  try {
    const textArea = dom.createTextArea();
    textArea.value = message.text;
    dom.appendToBody(textArea);
    textArea.select();
    const ok = dom.execCommand("copy");
    dom.removeElement(textArea);
    return ok ? { ok: true } : { ok: false, error: "execCommand copy returned false" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function makeMockDOM({ execCommandReturns = true, execCommandThrows = null } = {}) {
  let captured = null;
  return {
    captured: () => captured,
    createTextArea() {
      const ta = {
        value: "",
        selected: false,
        removed: false,
        select() {
          this.selected = true;
        },
      };
      captured = ta;
      return ta;
    },
    appendToBody() {},
    removeElement(el) {
      el.removed = true;
    },
    execCommand(cmd) {
      if (cmd !== "copy") throw new Error(`Unexpected command: ${cmd}`);
      if (execCommandThrows) throw execCommandThrows;
      return execCommandReturns;
    },
  };
}

describe("Offscreen clipboard handler", () => {
  test("ignores messages with the wrong target", () => {
    expect(
      handleCopyMessage({ target: "other", action: "copyToClipboard", text: "hi" }, makeMockDOM())
    ).toBeNull();
  });

  test("successful copy selects, copies, and removes the textarea", () => {
    const dom = makeMockDOM({ execCommandReturns: true });
    const result = handleCopyMessage(
      { target: "offscreen", action: "copyToClipboard", text: "hello world" },
      dom
    );
    expect(result).toEqual({ ok: true });
    expect(dom.captured().value).toBe("hello world");
    expect(dom.captured().selected).toBe(true);
    expect(dom.captured().removed).toBe(true);
  });

  test("execCommand returning false yields an error", () => {
    const result = handleCopyMessage(
      { target: "offscreen", action: "copyToClipboard", text: "t" },
      makeMockDOM({ execCommandReturns: false })
    );
    expect(result).toEqual({ ok: false, error: "execCommand copy returned false" });
  });

  test("execCommand throwing yields its message", () => {
    const result = handleCopyMessage(
      { target: "offscreen", action: "copyToClipboard", text: "t" },
      makeMockDOM({ execCommandThrows: new Error("DOM error") })
    );
    expect(result).toEqual({ ok: false, error: "DOM error" });
  });

  test("special characters are preserved", () => {
    const special = 'Line1\nLine2\t"quotes" <html> & symbols™ 🎉';
    const dom = makeMockDOM();
    handleCopyMessage({ target: "offscreen", action: "copyToClipboard", text: special }, dom);
    expect(dom.captured().value).toBe(special);
  });
});
