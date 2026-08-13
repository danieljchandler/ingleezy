import { describe, it, expect, vi } from "vitest";

// Mock supabase to prevent env var check
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

import { calculateLevel, xpForNextLevel, xpProgressInLevel } from "@/hooks/useGamification";

describe("useGamification — pure utility functions", () => {
  describe("calculateLevel", () => {
    it("returns level 1 for 0 XP", () => {
      expect(calculateLevel(0)).toBe(1);
    });

    it("returns level 1 for 499 XP", () => {
      expect(calculateLevel(499)).toBe(1);
    });

    it("returns level 2 for 500 XP", () => {
      expect(calculateLevel(500)).toBe(2);
    });

    it("returns level 3 for 1000 XP", () => {
      expect(calculateLevel(1000)).toBe(3);
    });

    it("returns level 11 for 5000 XP", () => {
      expect(calculateLevel(5000)).toBe(11);
    });
  });

  describe("xpForNextLevel", () => {
    it("returns 500 for level 1", () => {
      expect(xpForNextLevel(1)).toBe(500);
    });

    it("returns 1000 for level 2", () => {
      expect(xpForNextLevel(2)).toBe(1000);
    });

    it("returns 2500 for level 5", () => {
      expect(xpForNextLevel(5)).toBe(2500);
    });
  });

  describe("xpProgressInLevel", () => {
    it("returns 0 progress at level boundary", () => {
      const result = xpProgressInLevel(500);
      expect(result.current).toBe(0);
      expect(result.needed).toBe(500);
      expect(result.percent).toBe(0);
    });

    it("returns half progress at 250 XP", () => {
      const result = xpProgressInLevel(250);
      expect(result.current).toBe(250);
      expect(result.needed).toBe(500);
      expect(result.percent).toBe(50);
    });

    it("returns correct progress at 750 XP (level 2, 250 into level)", () => {
      const result = xpProgressInLevel(750);
      expect(result.current).toBe(250);
      expect(result.needed).toBe(500);
      expect(result.percent).toBe(50);
    });

    it("returns 0 for exactly 0 XP", () => {
      const result = xpProgressInLevel(0);
      expect(result.current).toBe(0);
      expect(result.needed).toBe(500);
      expect(result.percent).toBe(0);
    });
  });
});
