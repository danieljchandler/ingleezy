import { describe, it, expect } from "vitest";
import {
  decideCriticOutcome,
  type CriticDecisionInput,
} from "../../supabase/functions/_shared/criticDecision";

/** A complete draft, a complete rewrite, no leaks either side, no drift. */
const base: CriticDecisionInput = {
  draftGateReason: null,
  criticGateReason: null,
  draftLeakCount: 0,
  criticLeakCount: 0,
  dialectDrift: false,
};

describe("decideCriticOutcome", () => {
  describe("dialect drift", () => {
    // This is the regression that shipped fusha Yemeni reading passages twice.
    // The draft reads as fusha, so the native-speaker validator orders a
    // rewrite — but fusha register trips no token blacklist, so the draft
    // scores 0 leaks while the authentic dialect rewrite contains one flagged
    // word. The old rule read that as "the critic regressed" and shipped the
    // fusha draft.
    it("takes the rewrite even when it leaks more tokens than the draft", () => {
      const d = decideCriticOutcome({
        ...base,
        dialectDrift: true,
        draftLeakCount: 0,
        criticLeakCount: 1,
      });
      expect(d.keep).toBe("critic");
      expect(d.reason).toMatch(/repair pass/);
    });

    it("takes the rewrite when leak counts are equal", () => {
      expect(
        decideCriticOutcome({ ...base, dialectDrift: true, draftLeakCount: 2, criticLeakCount: 2 }).keep,
      ).toBe("critic");
    });

    it("takes the rewrite when it cleaned leaks up too", () => {
      expect(
        decideCriticOutcome({ ...base, dialectDrift: true, draftLeakCount: 3, criticLeakCount: 0 }).keep,
      ).toBe("critic");
    });

    // Completeness still outranks register: a rewrite missing a field the UI
    // renders is unusable no matter how authentic its Arabic is.
    it("keeps the draft when the rewrite dropped a field the draft had", () => {
      const d = decideCriticOutcome({
        ...base,
        dialectDrift: true,
        criticGateReason: "line missing literal gloss",
      });
      expect(d.keep).toBe("draft");
      expect(d.reason).toMatch(/completeness/);
    });
  });

  describe("completeness", () => {
    it("takes a rewrite that fixed what the draft was missing", () => {
      const d = decideCriticOutcome({ ...base, draftGateReason: "too short: 2 lines, need 5" });
      expect(d.keep).toBe("critic");
      expect(d.reason).toMatch(/fixed completeness/);
    });

    it("takes the fixing rewrite even if it leaked more", () => {
      expect(
        decideCriticOutcome({
          ...base,
          draftGateReason: "no questions",
          draftLeakCount: 0,
          criticLeakCount: 2,
        }).keep,
      ).toBe("critic");
    });

    it("keeps the draft when the rewrite broke a complete draft", () => {
      expect(
        decideCriticOutcome({ ...base, criticGateReason: "no vocabulary" }).keep,
      ).toBe("draft");
    });

    it("still compares leaks when both sides are incomplete", () => {
      expect(
        decideCriticOutcome({
          ...base,
          draftGateReason: "no questions",
          criticGateReason: "no questions",
          draftLeakCount: 1,
          criticLeakCount: 4,
        }).keep,
      ).toBe("draft");
    });
  });

  describe("no drift, no completeness change", () => {
    // alwaysCritique callers land here: nothing was wrong with the draft, so a
    // rewrite that drifted further into MSA is not worth taking.
    it("keeps the draft when the rewrite leaked more and fixed nothing", () => {
      const d = decideCriticOutcome({ ...base, draftLeakCount: 1, criticLeakCount: 5 });
      expect(d.keep).toBe("draft");
      expect(d.reason).toMatch(/fixed nothing/);
    });

    it("takes the rewrite when it leaked fewer", () => {
      expect(
        decideCriticOutcome({ ...base, draftLeakCount: 5, criticLeakCount: 1 }).keep,
      ).toBe("critic");
    });

    it("takes the rewrite when nothing separates them", () => {
      expect(decideCriticOutcome(base).keep).toBe("critic");
    });
  });
});
