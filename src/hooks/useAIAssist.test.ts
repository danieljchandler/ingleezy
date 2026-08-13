import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAIAssist } from "./useAIAssist";
import type { Segment } from "@/types/transcript";

/**
 * The two AI helpers on the transcript editor.
 *
 * Both exist because ASR on dialect Arabic fails in specific, predictable ways
 * — a particle misheard, a dialect word "corrected" into its MSA equivalent —
 * and those are exactly the errors an editor has to hunt for line by line. The
 * prompts name the failure modes per dialect for that reason: ده and دي are
 * Egyptian problems, حق is a Yemeni one, and a model told to fix "Arabic" will
 * happily replace the dialect word with the fusha one the ASR was already
 * drifting towards.
 *
 * Every call is user-triggered and cancellable. The editor is working on one
 * line at a time, and an abandoned request must not overwrite the line they
 * moved on to.
 */

const aSegment = (over: Partial<Segment> = {}): Segment => ({
  id: "seg-1",
  video_id: "vid-1",
  start: 0,
  end: 2,
  text: "شخبارك",
  translation: "how are you",
  confidence: 0.72,
  words: [],
  ...over,
});

/** Capture the prompt the hook builds, which is the thing worth asserting. */
function capturingCall(reply = "شخبارك") {
  const prompts: string[] = [];
  const call = vi.fn(async (prompt: string) => {
    prompts.push(prompt);
    return reply;
  });
  return { call, prompts };
}

const anAbort = () => {
  const error = new DOMException("aborted", "AbortError");
  return () => Promise.reject(error);
};

describe("suggesting subtitle breaks", () => {
  it("returns the restructured segments", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call } = capturingCall(JSON.stringify([{ id: "a" }, { id: "b" }]));

    let suggested: Segment[] | null = null;
    await act(async () => {
      suggested = await result.current.suggestBreaks([aSegment()], call);
    });

    expect(suggested!.map((segment) => segment.id)).toEqual(["a", "b"]);
    expect(result.current.suggestedSegments).toHaveLength(2);
  });

  it("insists the words come back unchanged", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall("[]");

    await act(async () => {
      await result.current.suggestBreaks([aSegment()], call);
    });

    // The one thing this feature must not do is rewrite the transcript. It is
    // re-breaking a native speaker's words, and a paraphrase would put words in
    // their mouth in a subtitle presented as what they said.
    expect(prompts[0]).toContain("Preserve all original words exactly");
    expect(prompts[0]).toContain("do not paraphrase or translate");
  });

  it("asks for breaks a learner can read", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall("[]");

    await act(async () => {
      await result.current.suggestBreaks([aSegment()], call);
    });

    // Three to seven seconds at a clause boundary is the difference between a
    // subtitle you can follow and one that flashes past mid-phrase.
    expect(prompts[0]).toContain("3–7 seconds");
    expect(prompts[0]).toContain("Never break mid-phrase");
  });

  it("sends the segments themselves, not a summary", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall("[]");

    await act(async () => {
      await result.current.suggestBreaks([aSegment({ text: "شخبارك اليوم" })], call);
    });

    // Timestamps have to come from the original word data, so the model needs
    // the real rows rather than a rendering of them.
    expect(prompts[0]).toContain("شخبارك اليوم");
  });

  it("reports an error when the reply is not JSON", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call } = capturingCall("Here are your segments!");

    let suggested: Segment[] | null = [];
    await act(async () => {
      suggested = await result.current.suggestBreaks([aSegment()], call);
    });

    // A model answering in prose is common enough to be a state, not a crash:
    // the editor keeps the transcript they had and can try again.
    expect(suggested).toBeNull();
    expect(result.current.status).toBe("error");
    expect(result.current.suggestedSegments).toBeNull();
  });

  it("treats a cancelled request as nothing happening", async () => {
    const { result } = renderHook(() => useAIAssist());

    let suggested: Segment[] | null = [];
    await act(async () => {
      suggested = await result.current.suggestBreaks([aSegment()], anAbort());
    });

    // Cancelling is a decision, not a failure — an error banner would make the
    // editor think something broke.
    expect(suggested).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("clears the previous suggestion before running again", async () => {
    const { result } = renderHook(() => useAIAssist());
    await act(async () => {
      await result.current.suggestBreaks([aSegment()], capturingCall('[{"id":"a"}]').call);
    });

    await act(async () => {
      await result.current.suggestBreaks([aSegment()], anAbort());
    });

    // A stale preview left on screen after a cancelled second run is a diff the
    // editor might apply believing it is the new one.
    expect(result.current.suggestedSegments).toBeNull();
  });
});

describe("fixing one line's Arabic", () => {
  it("returns the corrected text, trimmed", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call } = capturingCall("  شخبارك اليوم  ");

    let fixed: string | null = null;
    await act(async () => {
      fixed = await result.current.fixArabic(aSegment(), null, null, call);
    });

    // The value is written straight into the segment; stray whitespace would
    // show as a leading space in the subtitle.
    expect(fixed).toBe("شخبارك اليوم");
  });

  it("gives the model the lines either side", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall();

    await act(async () => {
      await result.current.fixArabic(
        aSegment({ text: "وين" }),
        aSegment({ id: "prev", text: "قبل" }),
        aSegment({ id: "next", text: "بعد" }),
        call,
      );
    });

    // A three-word subtitle out of context is unfixable; the surrounding lines
    // are what make a misheard particle obvious.
    expect(prompts[0]).toContain('Previous segment: "قبل"');
    expect(prompts[0]).toContain('Next segment: "بعد"');
  });

  it("handles the first and last line having no neighbour", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall();

    await act(async () => {
      await result.current.fixArabic(aSegment(), null, null, call);
    });

    // Empty strings rather than "null" reaching the prompt as a word.
    expect(prompts[0]).toContain('Previous segment: ""');
    expect(prompts[0]).toContain('Next segment: ""');
  });

  it("tells the model how confident the recogniser was", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall();

    await act(async () => {
      await result.current.fixArabic(aSegment({ confidence: 0.418 }), null, null, call);
    });

    // A line the ASR was sure of deserves a lighter touch than one it guessed
    // at; the score is the only signal of which is which.
    expect(prompts[0]).toContain("Confidence score: 0.42");
  });

  it("allows the model to change nothing", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall();

    await act(async () => {
      await result.current.fixArabic(aSegment(), null, null, call);
    });

    // Without this the model invents a correction for every line, and an editor
    // reviewing a hundred segments learns to ignore all of them.
    expect(prompts[0]).toContain("If no correction is needed, return the\noriginal unchanged");
  });

  it("reports an error when the call fails", async () => {
    const { result } = renderHook(() => useAIAssist());

    let fixed: string | null = "unset";
    await act(async () => {
      fixed = await result.current.fixArabic(aSegment(), null, null, () =>
        Promise.reject(new Error("gateway down")),
      );
    });

    expect(fixed).toBeNull();
    expect(result.current.status).toBe("error");
  });

  it("treats a cancelled fix as nothing happening", async () => {
    const { result } = renderHook(() => useAIAssist());

    await act(async () => {
      await result.current.fixArabic(aSegment(), null, null, anAbort());
    });

    expect(result.current.status).toBe("idle");
  });
});

describe("briefing the model on the dialect", () => {
  const dialectPrompt = async (dialect: string) => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall();
    await act(async () => {
      await result.current.fixArabic(aSegment(), null, null, call, dialect);
    });
    return prompts[0];
  };

  it("names the Egyptian particles and the ج→g shift", async () => {
    const prompt = await dialectPrompt("Egyptian");

    // ده and دي are the words an MSA-trained recogniser mangles most, and a
    // model not told to expect them "corrects" them into fusha.
    expect(prompt).toContain("Egyptian Arabic");
    expect(prompt).toContain("ده، دي، بتاع");
  });

  it("names the Yemeni particles and the ق→g shift", async () => {
    const prompt = await dialectPrompt("Yemeni");

    expect(prompt).toContain("Yemeni Arabic");
    expect(prompt).toContain("حق");
    // Yemeni gets mistranscribed towards Gulf as well as towards MSA, which is
    // a failure mode the other two dialects do not have.
    expect(prompt).toContain("Gulf equivalents");
  });

  it("names the Gulf particles", async () => {
    const prompt = await dialectPrompt("Gulf");

    expect(prompt).toContain("Khaleeji");
    expect(prompt).toContain("لي، لك، عليه، ما");
  });

  it("falls back to Gulf for a dialect it has no brief for", async () => {
    const prompt = await dialectPrompt("Levantine");

    // Gulf is the app's primary module. Falling back to no brief at all would
    // leave the model correcting dialect into MSA, which is the exact failure
    // the brief exists to prevent.
    expect(prompt).toContain("Khaleeji");
  });

  it("defaults to Gulf when no dialect is passed", async () => {
    const { result } = renderHook(() => useAIAssist());
    const { call, prompts } = capturingCall("[]");
    await act(async () => {
      await result.current.suggestBreaks([aSegment()], call);
    });

    expect(prompts[0]).toContain("Khaleeji");
  });
});

describe("cancelling", () => {
  it("aborts the request in flight", async () => {
    const { result } = renderHook(() => useAIAssist());
    let seen: AbortSignal | null = null;

    await act(async () => {
      const running = result.current.suggestBreaks([aSegment()], (_prompt, signal) => {
        seen = signal;
        return new Promise<string>(() => {});
      });
      void running;
    });

    act(() => {
      result.current.cancel();
    });

    // The signal is handed to the caller's own fetch, so cancelling actually
    // stops the request rather than only ignoring its answer.
    expect(seen!.aborted).toBe(true);
    expect(result.current.status).toBe("idle");
  });

  it("is harmless when nothing is running", () => {
    const { result } = renderHook(() => useAIAssist());

    expect(() =>
      act(() => {
        result.current.cancel();
      }),
    ).not.toThrow();
  });
});
