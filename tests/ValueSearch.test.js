// Mirrors the field+value filter used by the Search tab in contentScript.js.
function filterRows(rows, query) {
  if (!query) return rows;
  const q = query.toLowerCase();
  return rows.filter((row) => {
    if (row.Field.toLowerCase().includes(q)) return true;
    const val = row.Value === null || row.Value === undefined ? "" : String(row.Value);
    return val.toLowerCase().includes(q);
  });
}

const sampleRows = [
  { Field: "Email", Type: "email", Value: "admin@example.com" },
  { Field: "Phone", Type: "phone", Value: "+1-555-0100" },
  { Field: "Status", Type: "picklist", Value: "Active" },
  { Field: "Name", Type: "string", Value: "Alice Johnson" },
  { Field: "NullField", Type: "string", Value: null },
  { Field: "IsActive", Type: "boolean", Value: true },
];

const fields = (q) => filterRows(sampleRows, q).map((r) => r.Field);

describe("Search filter (field name OR value, case-insensitive)", () => {
  test("empty query returns all rows", () => {
    expect(filterRows(sampleRows, "")).toHaveLength(sampleRows.length);
  });
  test("matches by field name", () => {
    expect(fields("Email")).toEqual(["Email"]);
  });
  test("matches by value (email)", () => {
    expect(fields("admin@example")).toEqual(["Email"]);
  });
  test("matches by value (phone)", () => {
    expect(fields("555-0100")).toEqual(["Phone"]);
  });
  test("matches both value and field on different rows", () => {
    expect(fields("Active")).toEqual(["Status", "IsActive"]);
  });
  test("is case-insensitive", () => {
    expect(fields("alice")).toEqual(["Name"]);
  });
  test("null values don't crash and don't match text", () => {
    expect(filterRows(sampleRows, "something")).toHaveLength(0);
  });
  test("null-valued field still findable by name", () => {
    expect(fields("NullField")).toEqual(["NullField"]);
  });
  test("boolean value matches as text", () => {
    expect(fields("true")).toEqual(["IsActive"]);
  });
  test("no match returns empty", () => {
    expect(fields("zzzzz")).toEqual([]);
  });
});
