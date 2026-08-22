import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FullConfig } from "@playwright/test";
// Reached by relative path because e2e/ sits outside the `@/` alias — the same
// way the suite already imports supabase/functions/_shared modules.
import globalSetup from "../../e2e/support/globalSetup";

/**
 * Guards the one mistake in this repo that is both easy to make and expensive:
 * running a test suite against the production Supabase project.
 *
 * vite.config.ts sets `envDir: ".vite-env"` — an empty directory — so Vite's own
 * env loading finds nothing, and the Supabase client vars are injected through
 * `define` instead. That used to come with **hardcoded production fallbacks**,
 * which in a fork meant the previous app's production database: anything that
 * booted without overriding those vars talked to live data, and nothing about
 * the failure was loud. The fallbacks are gone and the assertions below keep
 * them gone.
 *
 * These assertions are deliberately textual. They are checking that the
 * safeguards are still present in the config files, which is not something a
 * runtime test can observe from inside the suite those safeguards protect.
 */

const root = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

const FAKE_HOST = "https://e2e.supabase.co";

describe("production-traffic safeguards", () => {
  describe("vitest", () => {
    it("points the unit suite at the fake Supabase host", () => {
      // Not just "is set" — set to the fake host specifically.
      expect(import.meta.env.VITE_SUPABASE_URL).toBe(FAKE_HOST);
      expect(import.meta.env.VITE_SUPABASE_PROJECT_ID).toBe("e2e");
    });

    it("never carries a real anon key", () => {
      // Supabase anon keys are JWTs, so they always start with the base64url
      // encoding of `{"alg":`.
      expect(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").not.toMatch(/^eyJ/);
    });

    it("declares the env in vitest.config.ts rather than inheriting it", () => {
      // Inheriting from the ambient environment would make the guarantee depend
      // on how the suite was invoked.
      const config = read("vitest.config.ts");
      expect(config).toContain("VITE_SUPABASE_URL");
      expect(config).toContain(FAKE_HOST);
    });
  });

  describe("playwright", () => {
    const config = read("playwright.config.ts");

    it("overrides all three client vars for the dev server", () => {
      for (const key of [
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "VITE_SUPABASE_PROJECT_ID",
      ]) {
        expect(config).toContain(key);
      }
      expect(config).toContain(FAKE_HOST);
    });

    it("runs the globalSetup that verifies those overrides took effect", () => {
      expect(config).toContain("globalSetup");
      expect(() => read("e2e/support/globalSetup.ts")).not.toThrow();
    });

    it("never reuses an already-running dev server", () => {
      // A server someone started by hand points at production; reusing it would
      // invalidate every stub in the suite while still going green.
      expect(config).toMatch(/reuseExistingServer:\s*false/);
    });
  });

  describe("the playwright globalSetup guard itself", () => {
    // A guard that cannot fail is not a guard. These drive it directly with the
    // shapes it is meant to reject.
    const withEnv = (env: Record<string, string>): FullConfig =>
      ({ webServer: { command: "noop", env } }) as unknown as FullConfig;

    const GOOD = {
      VITE_SUPABASE_URL: FAKE_HOST,
      VITE_SUPABASE_PROJECT_ID: "e2e",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-anon-key-not-a-real-secret",
    };

    it("accepts the fake host", () => {
      expect(() => globalSetup(withEnv(GOOD))).not.toThrow();
    });

    it("rejects a missing override, which is what silently reaches production", () => {
      const { VITE_SUPABASE_URL: _omitted, ...withoutUrl } = GOOD;
      expect(() => globalSetup(withEnv(withoutUrl))).toThrow(/not pointed at the fake/i);
    });

    it("rejects a real project URL", () => {
      expect(() =>
        globalSetup(withEnv({ ...GOOD, VITE_SUPABASE_URL: "https://ovscskaijvclaxelkdyf.supabase.co" })),
      ).toThrow(/not pointed at the fake/i);
    });

    it("rejects a real anon key even when the host looks right", () => {
      expect(() =>
        globalSetup(withEnv({ ...GOOD, VITE_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiJ9.x.y" })),
      ).toThrow(/real JWT/i);
    });

    it("rejects a config with no webServer at all", () => {
      expect(() => globalSetup({} as unknown as FullConfig)).toThrow(/no webServer/i);
    });
  });

  describe("vite", () => {
    const config = read("vite.config.ts");

    it("still reads the client vars from process.env, and reads it first", () => {
      // If this stops being true, the overrides above stop working and every
      // other assertion here becomes theatre. Precedence matters as much as
      // presence: Playwright passes the fake host through the environment, so
      // process.env has to beat anything read from a file.
      expect(config).toContain("VITE_SUPABASE_URL");
      expect(config).toMatch(/process\.env\[/);
      expect(config.indexOf("process.env[")).toBeLessThan(config.indexOf("ROOT_ENV["));
    });

    it("keeps env loading pinned to the empty .vite-env directory", () => {
      // The surprising half of the hazard: Vite's own env discovery finds
      // nothing here, so every client var has to be injected deliberately.
      expect(config).toMatch(/envDir:\s*["'.]/);
    });

    it("still reads a root .env, which is the workflow the README documents", () => {
      // The other half of the same hazard. `envDir` means Vite will not read
      // it, so the config reads it by hand — without that, a developer who
      // copies .env.example to .env as instructed gets no backend at all and no
      // explanation, which is how the production fallback justified itself in
      // the first place.
      expect(config).toContain(".env");
      expect(config).toMatch(/readFileSync/);
    });

    it("carries no hardcoded project ref or anon key", () => {
      // The fork hazard, pinned. `ovscskaijvclaxelkdyf` is Hakiya's project —
      // its anon key predates this repo's first migration — and it sat here as
      // a fallback, so an Ingleezy dev server started without env vars read and
      // wrote Hakiya's production data while looking entirely healthy.
      //
      // Matched by shape, not by that one string: any Supabase project ref or
      // JWT hardcoded into the build config is the same bug wearing different
      // characters.
      const withoutComments = config.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      expect(withoutComments, "a JWT is hardcoded in vite.config.ts").not.toMatch(
        /["']eyJ[A-Za-z0-9_-]{10,}/,
      );
      expect(withoutComments, "a Supabase project URL is hardcoded in vite.config.ts").not.toMatch(
        /["'`]https:\/\/[a-z]{20}\.supabase\.co/,
      );
    });
  });
});
