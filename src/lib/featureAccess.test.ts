import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURE_REQUIREMENTS,
  FREE_TIER_LIMITS,
  STANDARD_TIER_LIMITS,
  featureLabel,
  type PremiumFeature,
} from "./featureAccess";

/**
 * The premium tier table.
 *
 * Worth pinning even though nothing enforces it yet. `RequireSubscription`,
 * `useFeatureAccess` and this module are all written and none of them is
 * imported by a page — the paid features are currently reachable on every tier.
 * That makes this file a specification of intent rather than a description of
 * behaviour, and the risk is that it drifts out of agreement with the Pricing
 * page in the meantime, so that wiring it up later silently locks or unlocks
 * the wrong things.
 *
 * These tests therefore do two jobs: pin the table itself, and check it against
 * the numbers Pricing.tsx actually shows a prospective subscriber.
 */

const ALL_FEATURES = Object.keys(FEATURE_REQUIREMENTS) as PremiumFeature[];

describe("the tier table", () => {
  it("requires a paid tier for every listed feature", () => {
    // A feature mapped to 'free' would be a premium feature nothing gates —
    // the type forbids it, and this is the runtime half of that.
    for (const feature of ALL_FEATURES) {
      expect(["standard", "allin"]).toContain(FEATURE_REQUIREMENTS[feature]);
    }
  });

  it("puts the AI tools on Standard", () => {
    expect(FEATURE_REQUIREMENTS.transcribe).toBe("standard");
    expect(FEATURE_REQUIREMENTS.meme_analyzer).toBe("standard");
    expect(FEATURE_REQUIREMENTS.how_do_i_say).toBe("standard");
    expect(FEATURE_REQUIREMENTS.learn_from_x).toBe("standard");
  });

  it("reserves the uncapped features for All-In", () => {
    expect(FEATURE_REQUIREMENTS.unlimited_vocab).toBe("allin");
    expect(FEATURE_REQUIREMENTS.full_discover).toBe("allin");
    expect(FEATURE_REQUIREMENTS.priority_ai).toBe("allin");
    expect(FEATURE_REQUIREMENTS.early_access).toBe("allin");
  });

  it("names every feature it lists", () => {
    // `featureLabel` is a switch with no default, so a feature added to the
    // union without a case returns undefined and renders as an empty paywall
    // heading.
    for (const feature of ALL_FEATURES) {
      expect(featureLabel(feature)).toBeTruthy();
      expect(typeof featureLabel(feature)).toBe("string");
    }
  });

  it("gives each feature its own label", () => {
    const labels = ALL_FEATURES.map(featureLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the free and standard caps", () => {
  it("caps free vocabulary below standard", () => {
    // The ordering is the invariant: a cap that did not increase with the tier
    // would make upgrading a downgrade.
    expect(FREE_TIER_LIMITS.vocabularyWords).toBeLessThan(STANDARD_TIER_LIMITS.vocabularyWords);
  });

  it("caps free Discover by the day rather than in total", () => {
    // A lifetime cap on browsing would end the free tier rather than sample it.
    expect(FREE_TIER_LIMITS.discoverVideosPerDay).toBeGreaterThan(0);
  });
});

describe("agreement with the Pricing page", () => {
  const pricing = readFileSync(resolve(__dirname, "../pages/Pricing.tsx"), "utf8");
  const subscription = readFileSync(resolve(__dirname, "../hooks/useSubscription.ts"), "utf8");

  it("shows the free vocabulary cap this module enforces", () => {
    // Pricing.tsx hardcodes its bullet list rather than reading this file, so
    // the two can disagree without anything failing to compile. Someone
    // charging for a limit is entitled to have the page state the same one.
    expect(pricing).toContain(`${FREE_TIER_LIMITS.vocabularyWords} vocabulary words`);
  });

  it("shows the standard vocabulary cap this module enforces", () => {
    expect(subscription).toContain(`${STANDARD_TIER_LIMITS.vocabularyWords} vocabulary words`);
  });

  it("sells the Standard features this module gates behind Standard", () => {
    // Matched loosely against the marketing copy: the bullets are written for
    // a buyer, not generated from the feature ids.
    expect(subscription).toMatch(/Transcribe/i);
    expect(subscription).toMatch(/Meme Analyzer/i);
    expect(subscription).toMatch(/How Do I Say/i);
  });

  it("sells the All-In features this module gates behind All-In", () => {
    expect(subscription).toMatch(/Unlimited vocabulary/i);
    expect(subscription).toMatch(/Full Discover/i);
    expect(subscription).toMatch(/Priority AI/i);
    expect(subscription).toMatch(/Early access/i);
  });
});

describe("what is not wired up yet", () => {
  it("is imported by no page", () => {
    // The finding this file exists to keep visible. When a page starts gating
    // on `FEATURE_REQUIREMENTS`, this test fails and should be deleted — that
    // failure is the signal that the gate went live, which is worth noticing
    // deliberately rather than discovering from a support ticket.
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    expect(app).not.toMatch(/featureAccess|RequireSubscription|useFeatureAccess/);
  });
});
