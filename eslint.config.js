import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import noOnlyTests from "eslint-plugin-no-only-tests";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Test code is held to a higher standard than the app, not a lower one.
  //
  // `no-explicit-any` is already an error everywhere (via tseslint's recommended
  // set) and the ~549 pre-existing violations are what the lint ratchet exists to
  // hold the line on. Test files start from zero, so state the expectation
  // explicitly rather than letting them quietly drift into the baseline: the
  // fixtures and harness expose typed helpers, so no test needs `any`.
  //
  // `no-only-tests` matters more than it looks at this scale — a stray `.only`
  // left in a file silently reduces a suite of thousands to one, and CI still
  // reports green.
  {
    files: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "src/test/**/*.{ts,tsx}",
      "e2e/**/*.{ts,tsx}",
    ],
    plugins: { "no-only-tests": noOnlyTests },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-only-tests/no-only-tests": "error",
    },
  },
  // Two rules that misread Playwright's fixture API, which is not React and not
  // ordinary destructuring:
  //
  // - `use()` is the callback each fixture is handed. The React hooks plugin
  //   matches on the `use` prefix and reads those as hook calls outside a
  //   component. There is no React in this directory at all.
  // - `async ({}, use)` is the documented signature for a fixture that depends
  //   on no other fixtures. Playwright reads the destructured names to build its
  //   dependency graph, so the empty pattern is load-bearing — omitting it makes
  //   the fixture appear to depend on everything.
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "no-empty-pattern": "off",
    },
  },
);
