// Jest runs the suite in tests/. jsdom gives the UI/value tests a DOM; the
// background and URL-parser tests are environment-agnostic.
module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.js"],
  clearMocks: true,
};
