// Covers the pure logic behind the All Data tab:
//  - metadata enrichment (background.js fetchObjectMetadata combine loop)
//  - PATCH-body value coercion (contentScript.js coerceEditedValue)
//  - the All Data filter + hide-empty behavior (renderAllDataRows filter)
// These mirror the runtime code; the live PATCH round-trip needs a real org.

// ── Mirror: background.js metadata combine ──────────────────────────────────
function combineMetadata(metadata, record) {
  const combined = {};
  for (const field of metadata.fields) {
    const { name, type, label, updateable, referenceTo, nillable } = field;
    combined[name] = {
      type,
      value: record[name],
      label: label || name,
      updateable: updateable === true,
      referenceTo: Array.isArray(referenceTo) ? referenceTo : [],
      nillable: nillable === true,
    };
  }
  return combined;
}

// ── Mirror: contentScript.js coerceEditedValue ──────────────────────────────
function coerceEditedValue(row, raw) {
  if (row.Type === "boolean") return raw === "true";
  if (raw === "" && row.Nillable) return null;
  if (["int", "double", "currency", "percent"].includes(row.Type) && raw !== "") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

// ── Mirror: contentScript.js All Data filter ────────────────────────────────
function valueText(row) {
  const v = row.RawValue;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function adFilter(rows, query, hideNull) {
  const q = (query || "").toLowerCase();
  return rows.filter((row) => {
    const text = valueText(row);
    if (hideNull && text === "") return false;
    if (!q) return true;
    return (
      row.Field.toLowerCase().includes(q) ||
      (row.Label || "").toLowerCase().includes(q) ||
      text.toLowerCase().includes(q)
    );
  });
}

describe("metadata enrichment", () => {
  const metadata = {
    fields: [
      { name: "Name", type: "string", label: "Account Name", updateable: true, nillable: false },
      {
        name: "AccountId",
        type: "reference",
        label: "Account",
        updateable: true,
        referenceTo: ["Account"],
        nillable: true,
      },
      {
        name: "CreatedDate",
        type: "datetime",
        label: "Created Date",
        updateable: false,
        nillable: false,
      },
      { name: "NoLabel", type: "string" },
    ],
  };
  const record = {
    Name: "Acme",
    AccountId: "001xx0000000001",
    CreatedDate: "2024-01-01T00:00:00Z",
  };
  const combined = combineMetadata(metadata, record);

  test("keeps the original { type, value } shape", () => {
    expect(combined.Name.type).toBe("string");
    expect(combined.Name.value).toBe("Acme");
  });

  test("adds label / updateable / referenceTo / nillable", () => {
    expect(combined.AccountId).toEqual({
      type: "reference",
      value: "001xx0000000001",
      label: "Account",
      updateable: true,
      referenceTo: ["Account"],
      nillable: true,
    });
  });

  test("falls back to API name when label is missing", () => {
    expect(combined.NoLabel.label).toBe("NoLabel");
  });

  test("normalizes missing referenceTo to [] and flags to booleans", () => {
    expect(combined.Name.referenceTo).toEqual([]);
    expect(combined.CreatedDate.updateable).toBe(false);
  });

  test("value is undefined for fields absent from the record retrieve", () => {
    expect(combined.NoLabel.value).toBeUndefined();
  });
});

describe("PATCH value coercion", () => {
  test("boolean fields map true/false strings to booleans", () => {
    expect(coerceEditedValue({ Type: "boolean" }, "true")).toBe(true);
    expect(coerceEditedValue({ Type: "boolean" }, "false")).toBe(false);
  });

  test("empty value on a nillable field becomes null", () => {
    expect(coerceEditedValue({ Type: "string", Nillable: true }, "")).toBeNull();
  });

  test("empty value on a non-nillable field stays an empty string", () => {
    expect(coerceEditedValue({ Type: "string", Nillable: false }, "")).toBe("");
  });

  test("numeric fields parse to numbers", () => {
    expect(coerceEditedValue({ Type: "double" }, "12.5")).toBe(12.5);
    expect(coerceEditedValue({ Type: "int" }, "7")).toBe(7);
  });

  test("non-numeric input on a numeric field is left as-is for SF to reject", () => {
    expect(coerceEditedValue({ Type: "int" }, "abc")).toBe("abc");
  });

  test("strings pass through unchanged", () => {
    expect(coerceEditedValue({ Type: "string" }, "hello")).toBe("hello");
  });
});

describe("All Data filter", () => {
  const rows = [
    { Field: "Name", Label: "Account Name", RawValue: "Acme" },
    { Field: "Phone", Label: "Phone", RawValue: "+1-555" },
    { Field: "Industry", Label: "Industry", RawValue: null },
    { Field: "Site", Label: "Account Site", RawValue: "" },
  ];

  test("no query returns all rows", () => {
    expect(adFilter(rows, "", false)).toHaveLength(4);
  });

  test("hide-empty drops null/empty values", () => {
    expect(adFilter(rows, "", true).map((r) => r.Field)).toEqual(["Name", "Phone"]);
  });

  test("matches API name, label, or value (case-insensitive)", () => {
    expect(adFilter(rows, "acme", false).map((r) => r.Field)).toEqual(["Name"]);
    expect(adFilter(rows, "account", false).map((r) => r.Field)).toEqual(["Name", "Site"]);
    expect(adFilter(rows, "phone", false).map((r) => r.Field)).toEqual(["Phone"]);
  });

  test("hide-empty composes with a query", () => {
    expect(adFilter(rows, "account", true).map((r) => r.Field)).toEqual(["Name"]);
  });
});
