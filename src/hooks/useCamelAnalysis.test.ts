import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useCamelAnalysis } from "./useCamelAnalysis";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Arabic morphological analysis: vowels, segmentation, parts of speech, and
 * which dialect a snippet actually is.
 *
 * Four jobs behind one call because they share an expensive pipeline. Each has
 * a different consumer and a different consequence:
 *
 *   diacritize — vowels before text goes to TTS. Unvoweled Arabic is ambiguous,
 *                and a synthesiser guessing wrong says a different word.
 *   segment    — the prefix/stem/suffix breakdown on a word card, which is how
 *                a learner sees that four words share one root.
 *   pos        — part-of-speech labels on lesson vocabulary.
 *   dialect    — whether generated "Gulf" content is genuinely Gulf.
 *
 * The convenience wrappers exist so a caller wanting one of them does not have
 * to know the shape of the other three.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(seed: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(() => useCamelAnalysis(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

const A_DIALECT_RESULT = {
  code: "KWT",
  dialect: "Kuwaiti",
  country: "Kuwait",
  confidence: 0.82,
  isGulf: true,
  topPredictions: [{ code: "KWT", dialect: "Kuwaiti", score: 0.82 }],
  source: "camel-hf",
};

const A_SEGMENT = { raw: "وكتابهم", prefixes: ["و"], stem: "كتاب", suffixes: ["هم"] };

const stubAnalyze = (body: Record<string, unknown>) => (backend: SupabaseBackend) =>
  backend.stubFunction("camel-analyze", body);

describe("running an analysis", () => {
  it("asks for diacritics by default", async () => {
    const { result, backend } = render(stubAnalyze({ diacritized: "وَين رحت" }));

    await act(async () => {
      await result.current.analyze("وين رحت");
    });

    // The commonest use by far is voweling text on its way to TTS, so the
    // cheapest single action is the default.
    expect(backend.lastCallTo("camel-analyze")?.body).toMatchObject({
      text: "وين رحت",
      actions: ["diacritize"],
    });
  });

  it("runs several actions in one call", async () => {
    const { result, backend } = render(stubAnalyze({ diacritized: "وَين", segments: [A_SEGMENT] }));

    await act(async () => {
      await result.current.analyze("وين", ["diacritize", "segment", "pos", "dialect"]);
    });

    // They share a pipeline; four separate calls would pay for the tokenisation
    // four times.
    expect(backend.lastCallTo("camel-analyze")?.body).toMatchObject({
      actions: ["diacritize", "segment", "pos", "dialect"],
    });
  });

  it("trims the text before sending it", async () => {
    const { result, backend } = render(stubAnalyze({ diacritized: "وَين" }));

    await act(async () => {
      await result.current.analyze("  وين  ");
    });

    // Whitespace from a textarea would be tokenised as part of the input and
    // shift the segmentation offsets.
    expect(backend.lastCallTo("camel-analyze")?.body).toMatchObject({ text: "وين" });
  });

  it("keeps the result for the caller to read", async () => {
    const { result } = render(stubAnalyze({ diacritized: "وَين رحت" }));

    await act(async () => {
      await result.current.analyze("وين رحت");
    });

    expect(result.current.result?.diacritized).toBe("وَين رحت");
    expect(result.current.error).toBeNull();
  });

  it("does not call out for empty text", async () => {
    const { result, backend } = render(stubAnalyze({}));

    let analysed;
    await act(async () => {
      analysed = await result.current.analyze("   ");
    });

    // A blank textarea is the resting state of every screen that uses this.
    expect(analysed).toBeNull();
    expect(backend.callsTo("camel-analyze")).toEqual([]);
  });

  it("clears the previous result before running again", async () => {
    const { result } = render((backend) => {
      let call = 0;
      backend.stubFunction("camel-analyze", () => ({
        status: 200,
        body: ++call === 1 ? { diacritized: "أوّل" } : { diacritized: "ثاني" },
      }));
    });
    await act(async () => {
      await result.current.analyze("وين");
    });

    await act(async () => {
      await result.current.analyze("رحت");
    });

    // A stale analysis shown against new input is worse than none — the vowels
    // would belong to a different word.
    expect(result.current.result?.diacritized).toBe("ثاني");
  });
});

describe("the convenience wrappers", () => {
  it("diacritize returns just the voweled text", async () => {
    const { result, backend } = render(stubAnalyze({ diacritized: "وَيْن" }));

    let voweled: string | null = null;
    await act(async () => {
      voweled = await result.current.diacritize("وين");
    });

    expect(voweled).toBe("وَيْن");
    expect(backend.lastCallTo("camel-analyze")?.body).toMatchObject({ actions: ["diacritize"] });
  });

  it("diacritize returns nothing when the model could not vowel it", async () => {
    const { result } = render(stubAnalyze({ diacritized: null, diacritizeAvailable: false }));

    let voweled: string | null = "unset";
    await act(async () => {
      voweled = await result.current.diacritize("وين");
    });

    // Null is the signal to send the bare text to TTS rather than nothing at
    // all — unvoweled speech is imperfect, silence is broken.
    expect(voweled).toBeNull();
  });

  it("identifyDialect returns the prediction", async () => {
    const { result, backend } = render(stubAnalyze({ dialect: A_DIALECT_RESULT }));

    let identified;
    await act(async () => {
      identified = await result.current.identifyDialect("شخبارك");
    });

    // The `isGulf` flag is what the content validator reads: a "Gulf" lesson
    // that identifies as Egyptian is the failure this exists to catch.
    expect(identified).toMatchObject({ dialect: "Kuwaiti", isGulf: true });
    expect(backend.lastCallTo("camel-analyze")?.body).toMatchObject({ actions: ["dialect"] });
  });

  it("identifyDialect returns nothing when the model is unavailable", async () => {
    const { result } = render(stubAnalyze({ dialect: null, dialectError: "model cold" }));

    let identified: unknown = "unset";
    await act(async () => {
      identified = await result.current.identifyDialect("شخبارك");
    });

    // The validator has to be able to tell "not Gulf" from "could not check";
    // treating the second as the first would block valid content.
    expect(identified).toBeNull();
  });

  it("segmentWord returns the morphological breakdown", async () => {
    const { result, backend } = render(stubAnalyze({ segments: [A_SEGMENT] }));

    let segments;
    await act(async () => {
      segments = await result.current.segmentWord("وكتابهم");
    });

    // The stem is the payload: seeing كتاب inside وكتابهم is how a learner
    // stops treating every inflected form as a new word.
    expect(segments).toEqual([A_SEGMENT]);
    expect(backend.lastCallTo("camel-analyze")?.body).toMatchObject({ actions: ["segment"] });
  });

  it("segmentWord returns nothing when segmentation failed", async () => {
    const { result } = render(stubAnalyze({ segments: null }));

    let segments: unknown = "unset";
    await act(async () => {
      segments = await result.current.segmentWord("وكتابهم");
    });

    // The word card omits the breakdown rather than rendering an empty one.
    expect(segments).toBeNull();
  });
});

describe("when the analysis fails", () => {
  it("reports the failure instead of throwing", async () => {
    const { result } = render((backend) =>
      backend.stubFunctionFailure("camel-analyze", 500, { error: "farasa unavailable" }),
    );

    let analysed: unknown = "unset";
    await act(async () => {
      analysed = await result.current.analyze("وين");
    });

    // Callers use this on a keystroke; an exception would take the whole editor
    // down over an optional enrichment.
    expect(analysed).toBeNull();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
  });

  it("clears a stale error on the next successful run", async () => {
    const { result } = render((backend) => {
      let call = 0;
      backend.stubFunction("camel-analyze", () =>
        ++call === 1
          ? { status: 500, body: { error: "boom" } }
          : { status: 200, body: { diacritized: "وَين" } },
      );
    });
    await act(async () => {
      await result.current.analyze("وين");
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    await act(async () => {
      await result.current.analyze("وين");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.result?.diacritized).toBe("وَين");
  });

  it("clears everything on request", async () => {
    const { result } = render(stubAnalyze({ diacritized: "وَين" }));
    await act(async () => {
      await result.current.analyze("وين");
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
