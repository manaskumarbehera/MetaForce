// Mirrors the one-shot initial-URL bootstrap in contentScript.js.
function extractObjectTypeFromURL(url) {
  const regex = /\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view/;
  const match = url.match(regex);
  return match ? { objectType: match[1], recordId: match[2] } : null;
}

function simulateBootstrap(initialUrl) {
  let lastUrl = "";
  let lastRecordId = "";
  let mainLogicCalled = false;
  let mainLogicArg = null;
  const extractedData = extractObjectTypeFromURL(initialUrl);
  if (extractedData !== null) {
    lastUrl = initialUrl;
    lastRecordId = extractedData.recordId;
    mainLogicCalled = true;
    mainLogicArg = extractedData;
  }
  return { lastUrl, lastRecordId, mainLogicCalled, mainLogicArg };
}

describe("Initial URL bootstrap", () => {
  test("fires mainLogic immediately for a record URL", () => {
    const url = "https://myorg.lightning.force.com/lightning/r/Account/001ABCDEF123456/view";
    const r = simulateBootstrap(url);
    expect(r.mainLogicCalled).toBe(true);
    expect(r.mainLogicArg).toEqual({ objectType: "Account", recordId: "001ABCDEF123456" });
    expect(r.lastUrl).toBe(url);
    expect(r.lastRecordId).toBe("001ABCDEF123456");
  });

  test("skips non-record and homepage URLs", () => {
    expect(
      simulateBootstrap("https://x.lightning.force.com/lightning/o/Account/list").mainLogicCalled
    ).toBe(false);
    expect(
      simulateBootstrap("https://x.lightning.force.com/lightning/page/home").mainLogicCalled
    ).toBe(false);
  });

  test("handles 18-char IDs and custom objects", () => {
    const r = simulateBootstrap(
      "https://x.lightning.force.com/lightning/r/Custom_Obj__c/a01ABCDEF123456AAA/view"
    );
    expect(r.mainLogicCalled).toBe(true);
    expect(r.mainLogicArg.objectType).toBe("Custom_Obj__c");
    expect(r.mainLogicArg.recordId).toBe("a01ABCDEF123456AAA");
  });
});
