// Exercises the pure helpers exported by mf_shared.js (field categorization and
// the JSON/CSV export builders used by the All Data tab).
const MF = require("../mf_shared.js");

describe("fieldKind categorization", () => {
  test("reference and id map to 'id'", () => {
    expect(MF.fieldKind("reference")).toBe("id");
    expect(MF.fieldKind("id")).toBe("id");
  });
  test("numeric types map to 'number'", () => {
    ["int", "double", "currency", "percent"].forEach((t) => expect(MF.fieldKind(t)).toBe("number"));
  });
  test("date-ish types map to 'date'", () => {
    ["date", "datetime", "time"].forEach((t) => expect(MF.fieldKind(t)).toBe("date"));
  });
  test("contact types map to 'contact'", () => {
    ["email", "phone", "url"].forEach((t) => expect(MF.fieldKind(t)).toBe("contact"));
  });
  test("unknown types fall back to 'other'", () => {
    expect(MF.fieldKind("address")).toBe("other");
    expect(MF.fieldKind(undefined)).toBe("other");
  });
});

describe("recordToJson", () => {
  const rows = [
    { Field: "Name", RawValue: "Acme" },
    { Field: "Active", RawValue: true },
    { Field: "Industry", RawValue: null },
    { Field: "Missing", RawValue: undefined },
  ];
  const parsed = JSON.parse(MF.recordToJson(rows));

  test("keys by API name with raw values", () => {
    expect(parsed.Name).toBe("Acme");
    expect(parsed.Active).toBe(true);
    expect(parsed.Industry).toBeNull();
  });
  test("undefined values become null", () => {
    expect(parsed.Missing).toBeNull();
  });
});

describe("escapeCsv", () => {
  test("quotes values containing commas, quotes, or newlines", () => {
    expect(MF.escapeCsv("a,b")).toBe('"a,b"');
    expect(MF.escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(MF.escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });
  test("leaves simple values untouched and renders null/undefined as empty", () => {
    expect(MF.escapeCsv("plain")).toBe("plain");
    expect(MF.escapeCsv(null)).toBe("");
    expect(MF.escapeCsv(undefined)).toBe("");
  });
});

describe("recordToCsv", () => {
  const rows = [
    { Field: "Name", Label: "Account Name", Type: "string", RawValue: "Acme, Inc" },
    { Field: "Phone", Label: "Phone", Type: "phone", RawValue: "555" },
  ];
  const csv = MF.recordToCsv(rows);
  const lines = csv.split("\r\n");

  test("starts with the header row", () => {
    expect(lines[0]).toBe("Label,API Name,Type,Value");
  });
  test("emits one row per field with escaped values", () => {
    expect(lines[1]).toBe('Account Name,Name,string,"Acme, Inc"');
    expect(lines[2]).toBe("Phone,Phone,phone,555");
  });
});

describe("favorites sort (mirrors renderAllDataRows)", () => {
  function sortFavoritesFirst(rows, favSet) {
    const copy = rows.slice();
    copy.sort((a, b) => (favSet.has(b.Field) ? 1 : 0) - (favSet.has(a.Field) ? 1 : 0));
    return copy.map((r) => r.Field);
  }
  test("pinned fields move to the top, others keep order", () => {
    const rows = [{ Field: "A" }, { Field: "B" }, { Field: "C" }, { Field: "D" }];
    expect(sortFavoritesFirst(rows, new Set(["C"]))).toEqual(["C", "A", "B", "D"]);
    expect(sortFavoritesFirst(rows, new Set(["B", "D"]))).toEqual(["B", "D", "A", "C"]);
  });
});
