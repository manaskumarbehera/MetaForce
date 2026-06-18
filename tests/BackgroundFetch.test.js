// Mirrors the non-JSON error-parsing path of fetchData in background.js.
async function parseErrorResponse(response) {
  const contentType =
    (response.headers && response.headers.get ? response.headers.get("content-type") : "") || "";
  try {
    if (contentType.includes("application/json")) {
      return JSON.stringify(await response.json());
    }
    return await response.text();
  } catch (_) {
    return `HTTP ${response.status} ${response.statusText}`;
  }
}

function makeResponse(body, contentType, status = 500, statusText = "Internal Server Error") {
  return {
    status,
    statusText,
    headers: { get: (key) => (key === "content-type" ? contentType : null) },
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  };
}

describe("Background fetch error parsing", () => {
  test("JSON error body is stringified", async () => {
    const payload = [{ message: "Session expired", errorCode: "INVALID_SESSION_ID" }];
    const resp = makeResponse(
      JSON.stringify(payload),
      "application/json;charset=UTF-8",
      401,
      "Unauthorized"
    );
    await expect(parseErrorResponse(resp)).resolves.toBe(JSON.stringify(payload));
  });

  test("HTML error body returns raw text", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    await expect(
      parseErrorResponse(makeResponse(html, "text/html", 502, "Bad Gateway"))
    ).resolves.toBe(html);
  });

  test("missing content-type falls back to text", async () => {
    await expect(parseErrorResponse(makeResponse("Unknown error", "", 500))).resolves.toBe(
      "Unknown error"
    );
  });

  test("broken JSON falls back to HTTP status line", async () => {
    const resp = {
      status: 500,
      statusText: "Internal Server Error",
      headers: { get: () => "application/json" },
      json: () => Promise.reject(new Error("Unexpected token")),
      text: () => Promise.reject(new Error("stream consumed")),
    };
    await expect(parseErrorResponse(resp)).resolves.toBe("HTTP 500 Internal Server Error");
  });
});
