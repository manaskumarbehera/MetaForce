// Mirrors the Lightning record-URL parser in contentScript.js.
function parseLightningRecordUrl(url) {
  const regex = /\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view/;
  const match = url.match(regex);
  if (!match) return null;
  return { objectType: match[1], recordId: match[2] };
}

describe("Lightning record URL parsing", () => {
  test("parses a Salesforce Lightning record URL", () => {
    expect(
      parseLightningRecordUrl(
        "https://example.lightning.force.com/lightning/r/Account/001ABCDEF123456/view"
      )
    ).toEqual({ objectType: "Account", recordId: "001ABCDEF123456" });
  });

  test("rejects a non-record (list) URL", () => {
    expect(
      parseLightningRecordUrl("https://example.lightning.force.com/lightning/o/Account/list")
    ).toBeNull();
  });

  test("handles 18-char IDs and custom objects", () => {
    expect(
      parseLightningRecordUrl(
        "https://x.lightning.force.com/lightning/r/Custom_Obj__c/a01ABCDEF123456AAA/view"
      )
    ).toEqual({ objectType: "Custom_Obj__c", recordId: "a01ABCDEF123456AAA" });
  });
});
