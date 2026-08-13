import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { anMsaRule, msaRuleId } from "@/test/support/factories";
import { useMsaRules } from "./useMsaRules";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The MSA-to-dialect transformation rules the Bridge screen teaches.
 *
 * Someone arriving with classroom fusha does not need to learn Gulf Arabic from
 * scratch — they need the swaps: ماذا becomes شنو, the negation changes shape,
 * a sound shifts. Those swaps are the fastest route from "I studied Arabic for
 * two years and cannot follow a conversation" to being understood, which is why
 * they get a screen of their own.
 *
 * They are also the easiest content in the app to get wrong, because a
 * half-written rule states a false equivalence with total confidence. Hence the
 * status column and the filter on it.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(rows: Record<string, unknown>[], dialect = "Gulf") {
  const seed = (backend: SupabaseBackend) => backend.db.seed("msa_transformation_rules", rows);
  const harness = renderHookWithProviders(() => useMsaRules(dialect), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("listing the rules", () => {
  it("returns the published rules in their taught order", async () => {
    const { result } = render([
      anMsaRule({ id: msaRuleId(1), rule_name: "Second", display_order: 2 }),
      anMsaRule({ id: msaRuleId(0), rule_name: "First", display_order: 1 }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The order is pedagogical — sound shifts before pronouns before vocabulary
    // — so it is curated rather than alphabetical.
    expect(result.current.data?.map((rule) => rule.rule_name)).toEqual(["First", "Second"]);
  });

  it("never shows a draft rule", async () => {
    const { result } = render([
      anMsaRule({ id: msaRuleId(0), rule_name: "Ready", status: "published" }),
      anMsaRule({ id: msaRuleId(1), rule_name: "Half-written", status: "draft" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A draft rule is a confident statement nobody has checked. Teaching a
    // wrong equivalence is worse than teaching nothing — the learner will use
    // it and be misunderstood, with no way to know why.
    expect(result.current.data?.map((rule) => rule.rule_name)).toEqual(["Ready"]);
  });

  it("leaves out another dialect's rules", async () => {
    const { result } = render([
      anMsaRule({ id: msaRuleId(0), rule_name: "Gulf swap", dialect: "Gulf" }),
      anMsaRule({ id: msaRuleId(1), rule_name: "Egyptian swap", dialect: "Egyptian" }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // ماذا maps to شنو in Gulf and إيه in Egyptian; showing both would teach
    // the learner a swap that marks them as speaking the wrong dialect.
    expect(result.current.data?.map((rule) => rule.rule_name)).toEqual(["Gulf swap"]);
  });

  it("asks for the dialect it was given", async () => {
    const { result } = render(
      [anMsaRule({ dialect: "Yemeni", rule_name: "Yemeni swap" })],
      "Yemeni",
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((rule) => rule.rule_name)).toEqual(["Yemeni swap"]);
  });

  it("carries both sides of the swap and its example", async () => {
    const { result } = render([
      anMsaRule({
        category: "vocab_swap",
        msa_pattern: "ماذا",
        dialect_pattern: "شنو",
        example_msa: "ماذا تفعل؟",
        example_dialect: "شنو تسوي؟",
        example_audio_url: "https://cdn.test/rule.mp3",
        notes: "Also شنهو in some speech",
      }),
    ]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Both patterns and both examples: the rule is only usable if the learner
    // can see the sentence change, not just the word.
    expect(result.current.data?.[0]).toMatchObject({
      category: "vocab_swap",
      msa_pattern: "ماذا",
      dialect_pattern: "شنو",
      example_msa: "ماذا تفعل؟",
      example_dialect: "شنو تسوي؟",
      example_audio_url: "https://cdn.test/rule.mp3",
      notes: "Also شنهو in some speech",
    });
  });

  it("returns an empty list for a dialect with no published rules", async () => {
    const { result } = render([anMsaRule({ status: "draft" })]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("is available to a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useMsaRules("Gulf"), {
      persona: "anonymous",
      seed: (backend) => backend.db.seed("msa_transformation_rules", [anMsaRule()]),
    });
    cleanup = harness.cleanup;

    // The table grants SELECT to anon, and the bridge is the clearest argument
    // the app can make to someone with fusha who has not signed up.
    await waitFor(() => expect(harness.result.current.data).toHaveLength(1));
  });
});

describe("when the read fails", () => {
  it("surfaces the error rather than an empty rulebook", async () => {
    const harness = renderHookWithProviders(() => useMsaRules("Gulf"), {
      persona: "free",
      seed: (backend) =>
        backend.db.failAlways("msa_transformation_rules", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;

    // "No rules for this dialect" and "the query failed" look identical on the
    // screen; only the caller can tell them apart, and only if it is told.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});
