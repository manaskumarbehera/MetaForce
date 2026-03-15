/**
 * InitialBootstrapTest
 *
 * Unit-tests the initial URL bootstrap logic that runs once after the
 * MutationObserver is attached. Ensures that a record URL is detected
 * immediately without waiting for a DOM mutation.
 */

// ── Extract URL parser (mirrors contentScript.js) ───────────────────────────
function extractObjectTypeFromURL(url) {
  const regex = /\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view/;
  const match = url.match(regex);
  if (match) {
    return { objectType: match[1], recordId: match[2] };
  }
  return null;
}

// ── Simulate the bootstrap block (mirrors contentScript.js) ─────────────────
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

// ── Test helpers ─────────────────────────────────────────────────────────────
function assertEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${name} FAILED\n  expected: ${e}\n  actual:   ${a}`);
  }
  console.log(`PASS - ${name}`);
}

// ── Tests ────────────────────────────────────────────────────────────────────
class InitialBootstrapTest {
  run() {
    // 1. Record URL triggers mainLogic immediately
    {
      const result = simulateBootstrap(
        "https://myorg.lightning.force.com/lightning/r/Account/001ABCDEF123456/view"
      );
      assertEqual("bootstrap fires mainLogic for record URL", result.mainLogicCalled, true);
      assertEqual("bootstrap extracts objectType", result.mainLogicArg.objectType, "Account");
      assertEqual("bootstrap extracts recordId", result.mainLogicArg.recordId, "001ABCDEF123456");
      assertEqual(
        "bootstrap sets lastUrl",
        result.lastUrl,
        "https://myorg.lightning.force.com/lightning/r/Account/001ABCDEF123456/view"
      );
      assertEqual("bootstrap sets lastRecordId", result.lastRecordId, "001ABCDEF123456");
    }

    // 2. Non-record URL does not trigger mainLogic
    {
      const result = simulateBootstrap(
        "https://myorg.lightning.force.com/lightning/o/Account/list"
      );
      assertEqual("bootstrap skips non-record URL", result.mainLogicCalled, false);
      assertEqual("lastUrl stays empty for non-record URL", result.lastUrl, "");
      assertEqual("lastRecordId stays empty for non-record URL", result.lastRecordId, "");
    }

    // 3. Homepage URL does not trigger mainLogic
    {
      const result = simulateBootstrap(
        "https://myorg.lightning.force.com/lightning/page/home"
      );
      assertEqual("bootstrap skips homepage", result.mainLogicCalled, false);
    }

    // 4. 18-char record ID works
    {
      const result = simulateBootstrap(
        "https://myorg.lightning.force.com/lightning/r/Contact/003ABCDEF123456AAA/view"
      );
      assertEqual("bootstrap handles 18-char ID", result.mainLogicCalled, true);
      assertEqual("bootstrap extracts 18-char recordId", result.mainLogicArg.recordId, "003ABCDEF123456AAA");
      assertEqual("bootstrap extracts objectType for 18-char", result.mainLogicArg.objectType, "Contact");
    }

    // 5. Custom object URL works
    {
      const result = simulateBootstrap(
        "https://myorg.lightning.force.com/lightning/r/Custom_Obj__c/a01ABCDEF123456/view"
      );
      assertEqual("bootstrap handles custom object", result.mainLogicCalled, true);
      assertEqual("bootstrap extracts custom objectType", result.mainLogicArg.objectType, "Custom_Obj__c");
    }
  }
}

if (require.main === module) {
  const suite = new InitialBootstrapTest();
  suite.run();
}

module.exports = InitialBootstrapTest;

