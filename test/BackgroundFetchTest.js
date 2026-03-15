/**
 * BackgroundFetchTest
 *
 * Unit-tests the error-handling path in fetchData when the response is not JSON.
 * Extracts the parsing logic into a pure function so no real fetch/Chrome API
 * is needed at test time.
 */

// ── Extract the response-error parsing logic (mirrors background.js) ────────
async function parseErrorResponse(response) {
  const contentType = (response.headers && response.headers.get
    ? response.headers.get("content-type")
    : "") || "";
  try {
    if (contentType.includes("application/json")) {
      return JSON.stringify(await response.json());
    }
    return await response.text();
  } catch (_) {
    return `HTTP ${response.status} ${response.statusText}`;
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

function makeResponse(body, contentType, status = 500, statusText = "Internal Server Error") {
  return {
    status,
    statusText,
    headers: {
      get(key) { return key === "content-type" ? contentType : null; },
    },
    json() { return Promise.resolve(JSON.parse(body)); },
    text() { return Promise.resolve(body); },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────
class BackgroundFetchTest {
  async run() {
    // 1. JSON error body is stringified
    {
      const resp = makeResponse(
        JSON.stringify([{ message: "Session expired", errorCode: "INVALID_SESSION_ID" }]),
        "application/json;charset=UTF-8",
        401,
        "Unauthorized"
      );
      const result = await parseErrorResponse(resp);
      assertEqual(
        "JSON error is stringified",
        result,
        JSON.stringify([{ message: "Session expired", errorCode: "INVALID_SESSION_ID" }])
      );
    }

    // 2. HTML error body returns raw text
    {
      const htmlBody = "<html><body>502 Bad Gateway</body></html>";
      const resp = makeResponse(htmlBody, "text/html", 502, "Bad Gateway");
      const result = await parseErrorResponse(resp);
      assertEqual("HTML error returns raw text", result, htmlBody);
    }

    // 3. Plain text error body
    {
      const textBody = "Service Unavailable";
      const resp = makeResponse(textBody, "text/plain", 503, "Service Unavailable");
      const result = await parseErrorResponse(resp);
      assertEqual("plain text error returns body", result, textBody);
    }

    // 4. Missing content-type falls back to text
    {
      const body = "Unknown error";
      const resp = makeResponse(body, "", 500, "Internal Server Error");
      const result = await parseErrorResponse(resp);
      assertEqual("missing content-type falls back to text", result, body);
    }

    // 5. Broken JSON with JSON content-type falls back to HTTP status
    {
      const resp = {
        status: 500,
        statusText: "Internal Server Error",
        headers: { get() { return "application/json"; } },
        json() { return Promise.reject(new Error("Unexpected token")); },
        text() { return Promise.reject(new Error("stream consumed")); },
      };
      const result = await parseErrorResponse(resp);
      assertEqual("broken JSON falls back to HTTP status", result, "HTTP 500 Internal Server Error");
    }
  }
}

if (require.main === module) {
  const suite = new BackgroundFetchTest();
  suite.run().then(() => {
    // All async tests completed
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = BackgroundFetchTest;

