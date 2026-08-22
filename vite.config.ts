import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import { componentTagger } from "lovable-tagger";

/**
 * There is no hardcoded Supabase fallback here, and there must not be one.
 *
 * There used to be: project `ovscskaijvclaxelkdyf` and its live anon key, so
 * that a preview whose env injection arrived late still booted. That was safe
 * in Hakiya, where it pointed at Hakiya's own backend. Ingleezy inherited it in
 * the fork — the project's anon key is stamped 22 January 2026, the day before
 * this repo's first migration and seven months before the fork — so the same
 * three lines meant something entirely different here: an Ingleezy dev server
 * started without env vars read and wrote *Hakiya's production database*, and
 * the app looked like it was working the whole time.
 *
 * `RETARGET.md` is explicit that Ingleezy runs its own Supabase project. Until
 * one is linked the correct behaviour is no backend at all: with nothing
 * injected, `src/integrations/supabase/client.ts` throws by name on first
 * import, which is a better preview than a working app attached to someone
 * else's data.
 */
const ROOT_ENV = (() => {
  // Read explicitly rather than through Vite: `envDir` points at an empty
  // directory (see below), so a root .env — the file README tells developers to
  // create, and the one .env.example is a template for — is otherwise ignored.
  // A plain read does not join Vite's config-watch set, so this does not
  // reintroduce the restart loop that `envDir` exists to avoid.
  try {
    return Object.fromEntries(
      readFileSync(path.resolve(__dirname, ".env"), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const at = line.indexOf("=");
          return at === -1
            ? []
            : [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
        })
        .filter((pair) => pair.length === 2),
    ) as Record<string, string>;
  } catch {
    return {} as Record<string, string>; // no .env is the normal case in CI
  }
})();

/** process.env first, so Playwright's fake-host overrides and CI always win. */
const fromEnv = (...names: string[]) =>
  names.map((name) => process.env[name] ?? ROOT_ENV[name]).find((value) => value) ?? undefined;

const supabaseProjectId = fromEnv("VITE_SUPABASE_PROJECT_ID", "SUPABASE_PROJECT_ID");

const supabaseUrl =
  fromEnv("VITE_SUPABASE_URL", "SUPABASE_URL") ??
  (supabaseProjectId ? `https://${supabaseProjectId}.supabase.co` : undefined);

const supabasePublishableKey = fromEnv(
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
);

const vapidPublicKey = fromEnv("VITE_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY") ?? "";

// https://vitejs.dev/config/ — cache bust v5
export default defineConfig(({ mode }) => ({
  // Lovable Cloud can rewrite the root .env after backend changes, which makes
  // Vite restart the preview server. Keep Vite env discovery on an isolated
  // directory and inject the required client vars ourselves instead — from
  // process.env, then from a root .env read by hand above.
  envDir: ".vite-env",
  server: {
    host: "0.0.0.0",
    port: 8080,
    hmr: {
      protocol: "wss",
      clientPort: 443,
      overlay: false,
    },
    headers: {
      "Permissions-Policy": "microphone=*",
    },
  },
  define: {
    // Backend env vars MUST be available at build time. Accept both the
    // Vite-prefixed names and Lovable Cloud's standard secret names. Each is
    // injected only when it has a value: an absent var must stay absent so
    // client.ts can say so, rather than being defined as something wrong.
    ...(supabaseProjectId
      ? { 'import.meta.env.VITE_SUPABASE_PROJECT_ID': JSON.stringify(supabaseProjectId) }
      : {}),
    ...(supabaseUrl
      ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl) }
      : {}),
    ...(supabasePublishableKey
      ? { 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabasePublishableKey) }
      : {}),
    ...(supabasePublishableKey
      ? { 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabasePublishableKey) }
      : {}),
    // Web push VAPID public key. Injected the same way as the Supabase vars
    // because `envDir` points away from the repo root, so a root .env is not
    // read. Deliberately no fallback: when it's unset the value is the empty
    // string, usePushNotifications reports itself unsupported, and the Settings
    // toggle hides rather than offering something that can't work.
    'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(vapidPublicKey),
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Split large, stable vendor libraries into their own cacheable chunks
        // so they aren't duplicated across route chunks and don't invalidate on
        // app-code changes. recharts (+ d3) is isolated so it loads only for the
        // routes that render charts (e.g. /analytics), not the whole app.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-charts": ["recharts"],
        },
      },
    },
  },
  esbuild: mode === 'production' ? {
    drop: ['console', 'debugger'],
  } : undefined,
}));
