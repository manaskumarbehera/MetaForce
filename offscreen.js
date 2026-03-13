// Offscreen document — runs in the extension's own context, completely isolated
// from any web page. Salesforce's Permissions-Policy headers cannot reach here.
//
// IMPORTANT: navigator.clipboard.writeText() does NOT work in offscreen
// documents because they are never focused. Chrome explicitly supports
// document.execCommand("copy") for offscreen documents created with the
// CLIPBOARD reason — that is the correct (and only) mechanism here.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen" || message.action !== "copyToClipboard") {
    return false;
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = message.text;
    document.body.appendChild(textArea);
    textArea.select();
    const ok = document.execCommand("copy");
    textArea.remove();
    sendResponse(ok ? { ok: true } : { ok: false, error: "execCommand copy returned false" });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }

  return false; // synchronous — response already sent
});

