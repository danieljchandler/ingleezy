import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "glob";
import {
  DEFAULT_DRAFTERS,
  DEFAULT_FAST,
  DEFAULT_JUDGE,
  MODEL_IDS,
  MODEL_LINEUPS,
  MODEL_WEIGHTS,
  getLineup,
  getModelWeight,
  type LineupName,
} from "../../supabase/functions/_shared/modelRegistry.ts";

/**
 * The central model registry, and the rule it exists to enforce.
 *
 * The file's own instruction is explicit: do not hardcode model IDs in feature
 * code, fix the root cause and swap models here. That rule is the only thing
 * standing between this codebase and the failure mode it was written after —
 * a model starts returning errors, someone swaps it in the one function they
 * were looking at, and six months later nobody can say which functions are on
 * which model or why.
 *
 * A rule kept only in a comment erodes. So half of this file checks the
 * registry's internal consistency, and half scans the edge functions for IDs
 * that went around it.
 */

const FUNCTIONS = join(process.cwd(), "supabase", "functions");
const KNOWN_IDS = Object.values(MODEL_IDS) as string[];
const LINEUP_NAMES = Object.keys(MODEL_LINEUPS) as LineupName[];

describe("the lineups", () => {
  it("names a strategy every caller can dispatch on", () => {
    const strategies = new Set(["solo", "ensemble", "draft_critic", "council"]);

    for (const name of LINEUP_NAMES) {
      expect(strategies.has(MODEL_LINEUPS[name].strategy), `${name}`).toBe(true);
    }
  });

  it("gives every lineup at least one drafter", () => {
    for (const name of LINEUP_NAMES) {
      expect(MODEL_LINEUPS[name].drafters.length, `${name}`).toBeGreaterThan(0);
    }
  });

  it("builds every lineup from registry ids", () => {
    for (const name of LINEUP_NAMES) {
      const lineup = MODEL_LINEUPS[name];
      // A lineup naming an id that is not in MODEL_IDS is a hardcode hiding
      // inside the registry itself.
      for (const drafter of lineup.drafters) {
        expect(KNOWN_IDS, `${name} drafter`).toContain(drafter);
      }
      expect(KNOWN_IDS, `${name} judge`).toContain(lineup.judge);
    }
  });

  it("gives a solo lineup exactly one drafter", () => {
    // "Solo" is the cheap path; two drafters there would double its cost
    // without changing its strategy.
    expect(MODEL_LINEUPS.UTILITY.drafters).toHaveLength(1);
  });

  it("gives the multi-model strategies more than one drafter", () => {
    for (const name of ["TRANSLATION", "CONTENT", "REASONING"] as LineupName[]) {
      expect(MODEL_LINEUPS[name].drafters.length, name).toBeGreaterThan(1);
    }
  });

  it("names no drafter twice in one lineup", () => {
    for (const name of LINEUP_NAMES) {
      const drafters = MODEL_LINEUPS[name].drafters;
      // A duplicate would give one model two votes in the ensemble ranking.
      expect(new Set(drafters).size, name).toBe(drafters.length);
    }
  });

  it("hands back the lineup asked for", () => {
    for (const name of LINEUP_NAMES) {
      expect(getLineup(name)).toBe(MODEL_LINEUPS[name]);
    }
  });
});

describe("the aliases aiBrain reads", () => {
  it("points the default judge at the content lineup's judge", () => {
    // The aliases exist so changing the tandem in one place propagates to
    // every caller that does not pass models[] explicitly.
    expect(DEFAULT_JUDGE).toBe(MODEL_LINEUPS.CONTENT.judge);
  });

  it("points the default drafters at the translation lineup", () => {
    expect(DEFAULT_DRAFTERS).toBe(MODEL_LINEUPS.TRANSLATION.drafters);
  });

  it("points the fast default at a registry id", () => {
    expect(KNOWN_IDS).toContain(DEFAULT_FAST);
  });
});

describe("the voting weights", () => {
  it("weights every model a lineup can draft with", () => {
    const drafted = new Set(LINEUP_NAMES.flatMap((name) => MODEL_LINEUPS[name].drafters));

    for (const id of drafted) {
      // An unweighted drafter silently falls to the 0.8 default, which is a
      // different ranking from the one the lineup was tuned for.
      expect(MODEL_WEIGHTS, id).toHaveProperty(id);
    }
  });

  it("keeps every weight inside a usable range", () => {
    for (const [id, weight] of Object.entries(MODEL_WEIGHTS)) {
      expect(weight, id).toBeGreaterThan(0);
      expect(weight, id).toBeLessThanOrEqual(1);
    }
  });

  it("gives the two authoritative drafters equal weight", () => {
    // They are documented as co-equal; a thumb on either scale would decide
    // every close ensemble vote.
    expect(getModelWeight(MODEL_IDS.CLAUDE)).toBe(1);
    expect(getModelWeight(MODEL_IDS.GEMINI_FLASH)).toBe(1);
  });

  it("falls back for a model it has never heard of", () => {
    // Ranking has to produce a number for anything a caller passes, or one
    // unknown model takes down the whole ensemble.
    expect(getModelWeight("some/unreleased-model")).toBe(0.8);
  });
});

describe("the Fanar pins", () => {
  it("pins a specific generation rather than the bare alias", () => {
    // The bare "Fanar" alias silently tracks generation 1 with a 4k context,
    // so a pin that decayed to it would truncate every long prompt.
    expect(MODEL_IDS.FANAR).not.toBe("Fanar");
    expect(MODEL_IDS.FANAR).toMatch(/^Fanar-/);
  });

  it("does not point general work at the Islamic-RAG model", () => {
    // Fanar-Sadiq is retrieval-augmented over religious sources; using it for
    // curriculum or dialect validation colours everything it touches.
    expect(MODEL_IDS.FANAR).not.toContain("Sadiq");
  });
});

describe("the no-hardcoding rule", () => {
  /**
   * Every edge function file with its comments stripped.
   *
   * Stripping matters: several of these files carry comments *warning* against
   * a model — "do NOT use Fanar-Sadiq" — and a scan that reads them flags the
   * warning as the violation.
   */
  async function functionSources(): Promise<Array<{ path: string; text: string }>> {
    const files = await glob("**/*.ts", { cwd: FUNCTIONS, absolute: true });
    return files
      .filter((file) => !file.includes("modelRegistry.ts"))
      .filter((file) => !file.includes("/_test/"))
      .map((file) => ({
        path: file.slice(FUNCTIONS.length + 1),
        text: readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/(^|[^:])\/\/.*$/gm, "$1"),
      }));
  }

  /**
   * Files that already hardcode a registry-owned id.
   *
   * Pinned, not fixed. Every entry here is a place the registry's own rule was
   * not followed, so the next model upgrade is not one edit — it is seventeen,
   * across thirteen files, and missing one leaves that function silently on the
   * old model. The list is exhaustive on purpose: a new hardcode fails this
   * test, and so does fixing one, which is the prompt to strike it off.
   */
  const KNOWN_HARDCODES = new Set([
    "suggest-stories/index.ts → google/gemini-3-flash-preview",
    "generate-suggested-story-text/index.ts → google/gemini-3-flash-preview",
    "generate-story/index.ts → google/gemini-3-flash-preview",
    "free-chat/index.ts → google/gemini-2.5-pro",
    "curriculum-chat/index.ts → google/gemini-2.5-pro",
    "curriculum-chat/index.ts → google/gemini-3-flash-preview",
    "analyze-gulf-arabic/index.ts → anthropic/claude-sonnet-4.5",
    "analyze-gulf-arabic/index.ts → google/gemini-3.5-flash",
    "analyze-gulf-arabic/index.ts → qwen/qwen3-max",
    "analyze-gulf-arabic/index.ts → Fanar-C-2-27B",
    "ai-resegment-transcript/index.ts → google/gemini-3-flash-preview",
    "_shared/dialectValidator.ts → google/gemini-2.5-pro",
    "_shared/dialectValidator.ts → mistralai/mistral-saba",
    "_shared/aiBrain.ts → google/gemini-2.5-pro",
    "_shared/aiBrain.ts → google/gemini-3-flash-preview",
  ]);

  it("finds the sources it is scanning", async () => {
    // A scan that matches nothing passes forever.
    expect((await functionSources()).length).toBeGreaterThan(50);
  });

  it("never selects the bare Fanar alias as a model", async () => {
    // Scoped to model selection: "Fanar" is also the name of an ASR engine in
    // the transcription provenance, which is not what this rule is about.
    const offenders = (await functionSources())
      .filter(({ text }) => /model\s*[:=]\s*["']Fanar["']/.test(text))
      .map(({ path }) => path);

    expect(
      offenders,
      `These use the bare "Fanar" alias, which tracks generation 1 with a 4k ` +
        `context. Use MODEL_IDS.FANAR:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("never routes general work through Fanar-Sadiq", async () => {
    const offenders = (await functionSources())
      .filter(({ path }) => !path.includes("quran"))
      .filter(({ text }) => text.includes("Fanar-Sadiq"))
      .map(({ path }) => path);

    expect(
      offenders,
      `Fanar-Sadiq is the Islamic-RAG model and colours anything it drafts:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("has not grown a new hardcoded model id", async () => {
    const found: string[] = [];

    for (const { path, text } of await functionSources()) {
      for (const id of KNOWN_IDS) {
        // A quoted literal, not a MODEL_IDS reference.
        if (new RegExp(`["'\`]${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).test(text)) {
          found.push(`${path} → ${id}`);
        }
      }
    }

    const added = found.filter((entry) => !KNOWN_HARDCODES.has(entry));
    expect(
      added,
      `These hardcode a model ID the registry already owns. Import MODEL_IDS ` +
        `instead, so the next upgrade stays one edit:\n  ${added.join("\n  ")}`,
    ).toEqual([]);

    const fixed = [...KNOWN_HARDCODES].filter((entry) => !found.includes(entry));
    expect(
      fixed,
      `These were fixed — strike them off KNOWN_HARDCODES so the list keeps ` +
        `meaning something:\n  ${fixed.join("\n  ")}`,
    ).toEqual([]);
  });
});
