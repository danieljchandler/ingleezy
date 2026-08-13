import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useFushaLines } from "./useFushaLines";
import type { TranscriptLine } from "@/types/transcript";

/**
 * Filling in the Fusha row for lines that don't carry one.
 *
 * Two things here cost real money or real trust and are invisible when they
 * break: asking the model for lines that already have a rendering, and letting
 * a batched answer land out of order — line 3's Fusha under line 2 is a
 * mistake only a Fusha speaker could catch, which is exactly who this row is
 * for.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aLine = (id: string, arabic: string, over: Partial<TranscriptLine> = {}): TranscriptLine => ({
  id,
  arabic,
  translation: "a translation",
  tokens: [],
  ...over,
});

function render(lines: TranscriptLine[], enabled = true) {
  const harness = renderHookWithProviders(() => useFushaLines(lines, enabled, "Gulf"), {
    persona: "free",
  });
  cleanup = harness.cleanup;
  return harness;
}

describe("useFushaLines", () => {
  it("converts the lines that have no stored fusha", async () => {
    const lines = [aLine("l1", "شلونك"), aLine("l2", "وش تبغى")];
    const { result, backend } = render(lines);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.fushaFor(lines[0])).toBe("فصحى 1");
    expect(result.current.fushaFor(lines[1])).toBe("فصحى 2");

    const call = backend.functionCalls.find((c) => c.name === "convert-to-fusha");
    expect(call?.body).toMatchObject({ lines: ["شلونك", "وش تبغى"], dialect: "Gulf" });
  });

  it("prefers the stored rendering and never asks for it", async () => {
    const lines = [aLine("l1", "شلونك", { fusha: "كيف حالك" }), aLine("l2", "وش تبغى")];
    const { result, backend } = render(lines);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.fushaFor(lines[0])).toBe("كيف حالك");

    // Only the line without one was sent.
    const call = backend.functionCalls.find((c) => c.name === "convert-to-fusha");
    expect(call?.body).toMatchObject({ lines: ["وش تبغى"] });
  });

  it("calls nothing until the row is switched on", async () => {
    const lines = [aLine("l1", "شلونك")];
    const { result, backend } = render(lines, false);

    // Give the effect a chance to fire if it were going to.
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(backend.functionCalls.filter((c) => c.name === "convert-to-fusha")).toHaveLength(0);
    expect(result.current.fushaFor(lines[0])).toBeUndefined();
  });

  it("calls nothing when every line already has a rendering", async () => {
    const lines = [aLine("l1", "شلونك", { fusha: "كيف حالك" })];
    const { result, backend } = render(lines);

    await waitFor(() => expect(result.current.fushaFor(lines[0])).toBe("كيف حالك"));
    expect(backend.functionCalls.filter((c) => c.name === "convert-to-fusha")).toHaveLength(0);
  });

  it("asks for each line once, however often it re-renders", async () => {
    const lines = [aLine("l1", "شلونك")];
    const { result, rerender, backend } = render(lines);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender();
    rerender();

    expect(backend.functionCalls.filter((c) => c.name === "convert-to-fusha")).toHaveLength(1);
  });

  it("reports an error rather than silently showing nothing", async () => {
    const lines = [aLine("l1", "شلونك")];
    const harness = renderHookWithProviders(() => useFushaLines(lines, true, "Gulf"), {
      persona: "free",
      seed: (backend) => {
        backend.stubFunctionFailure("convert-to-fusha", 502, { error: "fusha_unavailable" });
      },
    });
    cleanup = harness.cleanup;

    await waitFor(() => expect(harness.result.current.status).toBe("error"));
    expect(harness.result.current.fushaFor(lines[0])).toBeUndefined();
  });
});
