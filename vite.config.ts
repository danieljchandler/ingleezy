import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const FALLBACK_SUPABASE_PROJECT_ID = "ovscskaijvclaxelkdyf";
const FALLBACK_SUPABASE_URL = `https://${FALLBACK_SUPABASE_PROJECT_ID}.supabase.co`;
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92c2Nza2FpanZjbGF4ZWxrZHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxMjM5NzAsImV4cCI6MjA4NDY5OTk3MH0.8fH3gVx8ft5KvHbeD0ngNs1-ZClg2R7a_juQ0_dwMW0";

const supabaseProjectId =
  process.env.VITE_SUPABASE_PROJECT_ID ??
  process.env.SUPABASE_PROJECT_ID ??
  FALLBACK_SUPABASE_PROJECT_ID;

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  (supabaseProjectId ? `https://${supabaseProjectId}.supabase.co` : FALLBACK_SUPABASE_URL);

const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  FALLBACK_SUPABASE_PUBLISHABLE_KEY;

const vapidPublicKey =
  process.env.VITE_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";

// https://vitejs.dev/config/ — cache bust v5
export default defineConfig(({ mode }) => ({
  // Lovable Cloud can rewrite the root .env after backend changes, which makes
  // Vite restart the preview server. Keep Vite env discovery on an isolated
  // directory and inject the required client vars from process.env instead.
  // Use public fallbacks so preview/build never crash if env injection is late.
  envDir: ".vite-env",
  server: {
    host: "::",
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
    // Vite-prefixed names and Lovable Cloud's standard secret names.
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
