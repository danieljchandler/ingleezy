import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Vitest's 5s default was fine for a suite of pure functions. This one now
    // renders hundreds of component trees, and a run competing with the
    // Playwright suite for CPU took 85s where an idle one takes 46 — long
    // enough for a starved worker to blow the per-test budget on work that was
    // about to finish. Two different tests failed that way, neither
    // reproducible on an idle machine.
    //
    // Generous rather than precise: a real hang still fails, just later, and a
    // slow machine no longer reports a false one.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // src/integrations/supabase/client.ts throws at import time when these are
    // missing, which is why hook tests have historically had to vi.mock the
    // client just to be importable. Setting them here lets tests exercise the
    // real supabase-js query builder against the in-memory backend instead.
    //
    // The host is deliberately the same fake as playwright.config.ts, and the
    // values are deliberately NOT vite.config.ts's fallbacks: that file falls
    // back to the real production project ref and a real anon key, so mirroring
    // its logic here would point the unit suite at production. Never do that —
    // src/test/envGuard.test.ts fails the build if these drift.
    env: {
      VITE_SUPABASE_URL: "https://e2e.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-anon-key-not-a-real-secret",
      VITE_SUPABASE_PROJECT_ID: "e2e",
      // Empty on purpose: usePushNotifications reports itself unsupported when
      // this is blank, which is the default branch most tests should see.
      VITE_VAPID_PUBLIC_KEY: "",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/vite-env.d.ts",
      ],
      // Per-directory, and deliberately not global.
      //
      // A global number here would be meaningless: `src/pages/**` is 110 route
      // components covered by the Playwright suite rather than this one. It
      // sits near zero and would drag any overall figure down to a threshold so
      // low it could never fail — which is worse than no threshold, because it
      // looks like a gate.
      //
      // These four directories are the ones this suite actually owns, and the
      // first three have a drift guard already (hookCoverage, libCoverage)
      // asserting that every module *has* a test. The thresholds are the second
      // half of that: they catch a module that has a test file which stopped
      // exercising it.
      //
      // Set a couple of points under the measured figures so ordinary churn
      // does not fail the build. Raise them when the real numbers move up —
      // they are a ratchet, not a target.
      thresholds: {
        // measured across the whole tree: 75.89 lines · 80.00 functions
        //
        // Added once component coverage was worth gating — when the thresholds
        // below were first set this tree sat near zero and was excluded for
        // that reason.
        //
        // Note the figure is the glob's, not the `src/components` row in the
        // text reporter: that row covers only the files directly in the folder
        // (81%), while `**` includes every subdirectory, `ui/`'s vendored
        // shadcn primitives among them.
        "src/components/**": { lines: 73, functions: 77, branches: 85 },
        // measured: 85.65 lines · 89.94 functions · 81.85 branches
        "src/hooks/**": { lines: 83, functions: 87, branches: 79 },
        // measured: 92.20 lines · 94.66 functions · 92.07 branches
        "src/lib/**": { lines: 90, functions: 93, branches: 90 },
        // measured: 69.61 lines · 57.14 functions · 81.08 branches
        "src/contexts/**": { lines: 67, functions: 55, branches: 79 },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
