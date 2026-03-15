/**
 * ValueSearchTest
 *
 * Unit-tests the field + value search filter logic used by the content script.
 * The filterRows function is extracted as a pure function.
 */

// ── Extract filterRows logic (mirrors contentScript.js) ─────────────────────
function filterRows(rows, query) {
  if (!query) return rows;
  const q = query.toLowerCase();
  return rows.filter((row) => {
    if (row.Field.toLowerCase().includes(q)) return true;
    const val = row.Value === null || row.Value === undefined ? "" : String(row.Value);
    return val.toLowerCase().includes(q);
  });
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

// ── Test data ────────────────────────────────────────────────────────────────
const sampleRows = [
  { Field: "Email", Type: "email", Value: "admin@example.com" },
  { Field: "Phone", Type: "phone", Value: "+1-555-0100" },
  { Field: "Status", Type: "picklist", Value: "Active" },
  { Field: "Name", Type: "string", Value: "Alice Johnson" },
  { Field: "NullField", Type: "string", Value: null },
  { Field: "IsActive", Type: "boolean", Value: true },
];

// ── Tests ────────────────────────────────────────────────────────────────────
class ValueSearchTest {
  run() {
    // 1. Empty query returns all rows
    assertEqual(
      "empty query returns all rows",
      filterRows(sampleRows, "").length,
      sampleRows.length
    );

    // 2. Search by field name still works
    assertEqual(
      "search by field name 'Email'",
      filterRows(sampleRows, "Email").map(r => r.Field),
      ["Email"]
    );

    // 3. Search by value — email address
    assertEqual(
      "search by value 'admin@example'",
      filterRows(sampleRows, "admin@example").map(r => r.Field),
      ["Email"]
    );

    // 4. Search by value — phone number
    assertEqual(
      "search by value '555-0100'",
      filterRows(sampleRows, "555-0100").map(r => r.Field),
      ["Phone"]
    );

    // 5. Search by value — status
    assertEqual(
      "search by value 'Active' matches Status and IsActive",
      filterRows(sampleRows, "Active").map(r => r.Field),
      ["Status", "IsActive"]
    );

    // 6. Search is case-insensitive
    assertEqual(
      "case-insensitive search 'alice'",
      filterRows(sampleRows, "alice").map(r => r.Field),
      ["Name"]
    );

    // 7. Null values don't crash and don't match non-empty queries
    assertEqual(
      "null value doesn't match 'something'",
      filterRows(sampleRows, "something").length,
      0
    );

    // 8. Null values field still findable by field name
    assertEqual(
      "null value field found by name 'NullField'",
      filterRows(sampleRows, "NullField").map(r => r.Field),
      ["NullField"]
    );

    // 9. Boolean value matches when searched as text
    assertEqual(
      "boolean value matches 'true'",
      filterRows(sampleRows, "true").map(r => r.Field),
      ["IsActive"]
    );

    // 10. Partial field name match
    assertEqual(
      "partial field name 'Stat' matches Status",
      filterRows(sampleRows, "Stat").map(r => r.Field),
      ["Status"]
    );

    // 11. Query matches both field name and value on different rows
    assertEqual(
      "query 'Name' matches Name field",
      filterRows(sampleRows, "Name").map(r => r.Field),
      ["Name"]
    );

    // 12. No match returns empty
    assertEqual(
      "no match returns empty array",
      filterRows(sampleRows, "zzzzz"),
      []
    );
  }
}

if (require.main === module) {
  const suite = new ValueSearchTest();
  suite.run();
}

module.exports = ValueSearchTest;

