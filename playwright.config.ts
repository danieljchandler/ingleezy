import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

/**
 * E2E config. The suite stubs Supabase in the browser, so it needs no
 * credentials and no network — see e2e/support/supabase.ts.
 *
 * The dev server is pointed at a fake Supabase host via process.env. That's the
 * only lever available: vite.config.ts sets `envDir: ".vite-env"`, so root
 * `.env` files are ignored, and it injects the client vars through `define`
 * from process.env — falling back to the real production project when unset.
 * Without this override the suite would talk to production.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Refuses to start unless the webServer env below actually took effect.
  globalSetup: "./e2e/support/globalSetup.ts",
  // CI defaults to one worker, which does not scale to a suite covering every
  // route. Each test gets its own browser context and its own in-memory
  // database, so there is no shared state to serialize on.
  workers: process.env.CI ? 4 : undefined,
  // The default 5s assertion timeout was set when the suite was one spec file.
  // With every route covered, several workers share one dev server, and a lazy
  // route's first paint behind a cold Vite transform can take longer than that
  // — a timeout that says nothing about the app. Failures still fail; they just
  // get long enough to be believed.
  expect: { timeout: 10_000 },
  // In CI, also emit the HTML report so a failed run uploads something
  // debuggable as an artifact — "line" alone writes nothing to disk.
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The sandbox/CI image ships browsers at PLAYWRIGHT_BROWSERS_PATH
        // rather than in node_modules, so let Playwright resolve them itself
        // and only drop the sandbox, which containers don't allow.
        //
        // The fake-media flags give Chromium a synthetic capture device. A
        // container has no microphone, so without them getUserMedia rejects
        // with NotFoundError and every recording surface — pronunciation,
        // shadowing, the conversation simulator, the admin audio recorders —
        // errors on mount. These produce a *real* MediaStream, which matters:
        // a hand-written stand-in is rejected by RTCPeerConnection.addTrack,
        // so the live-voice panel could not be tested with one.
        launchOptions: {
          args: [
            "--no-sandbox",
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
        permissions: ["microphone"],
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: a server already running against the real project would
    // silently invalidate the stubs.
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
    env: {
      // Fake host. supabase-js derives its localStorage session key from the
      // first hostname label, so "e2e" here == "sb-e2e-auth-token" in the stub.
      VITE_SUPABASE_URL: "https://e2e.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-anon-key-not-a-real-secret",
      VITE_SUPABASE_PROJECT_ID: "e2e",
    },
  },
});
