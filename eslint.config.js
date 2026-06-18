"use strict";

// Flat ESLint config (ESLint 9+). The extension runtime sources (background.js,
// contentScript.js, offscreen.js, popup/*, options/*) run in the browser /
// service worker; the dev tooling (scripts/, tests/, *.cjs, *.mjs) is Node.

const js = require("@eslint/js");

const browserGlobals = {
  chrome: "readonly",
  document: "readonly",
  window: "readonly",
  navigator: "readonly",
  console: "readonly",
  fetch: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  MutationObserver: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  Promise: "readonly",
  URL: "readonly",
  Blob: "readonly",
  self: "readonly",
  globalThis: "readonly",
  importScripts: "readonly",
  // Shared module (mf_shared.js) exposed on the global as MF.
  MF: "readonly",
};

const nodeGlobals = {
  module: "writable",
  require: "readonly",
  process: "readonly",
  __dirname: "readonly",
  console: "readonly",
  global: "writable",
  fetch: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
};

const jestGlobals = {
  describe: "readonly",
  test: "readonly",
  it: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  jest: "readonly",
};

module.exports = [
  {
    ignores: ["node_modules/**", "build/**", "dist/**", "coverage/**", "*.zip"],
  },
  js.configs.recommended,
  {
    // Extension source — runs in the browser / service worker.
    files: [
      "background.js",
      "contentScript.js",
      "offscreen.js",
      "popup/**/*.js",
      "options/**/*.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Shipped extension code must not log to the console.
      "no-console": "error",
    },
  },
  {
    // Universal shared module — runs in the browser, the SW, and Node (jest).
    files: ["mf_shared.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...browserGlobals, module: "writable" },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    // Dev tooling (ES module scripts and Vite config).
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
  {
    // Dev tooling and tests — CommonJS. Tests use jsdom DOM globals, so include
    // the browser set too. Their stdout is their purpose.
    files: ["tests/**", "**/*.cjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...browserGlobals, ...nodeGlobals, ...jestGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
];
