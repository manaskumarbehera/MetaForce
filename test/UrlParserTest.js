class UrlParserTest {
  static parseLightningRecordUrl(url) {
    const regex = /\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view/;
    const match = url.match(regex);
    if (!match) {
      return null;
    }

    return {
      objectType: match[1],
      recordId: match[2],
    };
  }

  static assertDeepEqual(name, actual, expected) {
    const actualText = JSON.stringify(actual);
    const expectedText = JSON.stringify(expected);
    if (actualText !== expectedText) {
      throw new Error(
        `${name} failed\nexpected: ${expectedText}\nactual:   ${actualText}`
      );
    }
    console.log(`PASS - ${name}`);
  }

  run() {
    UrlParserTest.assertDeepEqual(
      "parses Salesforce Lightning record URL",
      UrlParserTest.parseLightningRecordUrl(
        "https://example.lightning.force.com/lightning/r/Account/001ABCDEF123456/view"
      ),
      {
        objectType: "Account",
        recordId: "001ABCDEF123456",
      }
    );

    UrlParserTest.assertDeepEqual(
      "rejects non-record URL",
      UrlParserTest.parseLightningRecordUrl(
        "https://example.lightning.force.com/lightning/o/Account/list"
      ),
      null
    );
  }
}

if (require.main === module) {
  const suite = new UrlParserTest();
  suite.run();
}

module.exports = UrlParserTest;

