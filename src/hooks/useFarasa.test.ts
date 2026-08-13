import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { useFarasa } from "./useFarasa";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The QCRI Farasa pipeline — five Arabic NLP tasks behind one call.
 *
 * Each task feeds a different part of the app, and none of them is decorative:
 *
 *   diac    — vowels before text reaches TTS. Unvoweled Arabic is genuinely
 *             ambiguous, and a synthesiser guessing wrong pronounces a
 *             different word.
 *   seg     — the prefix/stem/suffix split on a word card, which is how a
 *             learner sees كتاب inside وبالكتاب instead of memorising both.
 *   pos     — part-of-speech labels in grammar lessons.
 *   NER     — entity highlighting in transcripts.
 *   parsing — the dependency tree on the advanced grammar display.
 *
 * The failure model is the part worth pinning. Tasks run in parallel and fail
 * independently, and one of the reasons — `invalid_api_key` — means the secret
 * is missing rather than the service being flaky, so retrying achieves nothing
 * until somebody fixes the configuration.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(seed: (backend: SupabaseBackend) => void) {
  const harness = renderHookWithProviders(() => useFarasa(), { persona: "free", seed });
  cleanup = harness.cleanup;
  return harness;
}

const stub = (body: Record<string, unknown>) => (backend: SupabaseBackend) =>
  backend.stubFunction("farasa", body);

const A_SEG_TOKEN = {
  original: "وبالكتاب",
  segmented: "و+ب+ال+كتاب",
  prefixes: ["و", "ب", "ال"],
  stem: "كتاب",
  suffixes: [],
};

describe("running the pipeline", () => {
  it("asks for vowels by default", async () => {
    const { result, backend } = render(stub({ diac: { text: "وَين رحت" } }));

    await act(async () => {
      await result.current.analyze("وين رحت");
    });

    // Diacritisation is the commonest use — every TTS call goes through it — so
    // it is the single task a bare call pays for.
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({
      text: "وين رحت",
      tasks: ["diac"],
    });
  });

  it("runs several tasks in one call", async () => {
    const { result, backend } = render(stub({ diac: { text: "وَين" } }));

    await act(async () => {
      await result.current.analyze("وين", ["diac", "seg", "pos", "NER", "parsing"]);
    });

    // They run in parallel server-side; five separate calls would pay the round
    // trip five times for one sentence.
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({
      tasks: ["diac", "seg", "pos", "NER", "parsing"],
    });
  });

  it("trims the text before sending it", async () => {
    const { result, backend } = render(stub({ diac: { text: "وَين" } }));

    await act(async () => {
      await result.current.analyze("  وين  ");
    });

    expect(backend.lastCallTo("farasa")?.body).toMatchObject({ text: "وين" });
  });

  it("does not call out for empty text", async () => {
    const { result, backend } = render(stub({}));

    let analysed;
    await act(async () => {
      analysed = await result.current.analyze("   ");
    });

    expect(analysed).toBeNull();
    expect(backend.callsTo("farasa")).toEqual([]);
  });

  it("keeps the whole result for the caller to read", async () => {
    const { result } = render(
      stub({ diac: { text: "وَين" }, seg: { raw: "و+ين", tokens: [A_SEG_TOKEN] } }),
    );

    await act(async () => {
      await result.current.analyze("وين", ["diac", "seg"]);
    });

    expect(result.current.result?.diac?.text).toBe("وَين");
    expect(result.current.result?.seg?.tokens).toHaveLength(1);
  });

  it("clears the previous result before running again", async () => {
    const { result } = render((backend) => {
      let call = 0;
      backend.stubFunction("farasa", () => ({
        status: 200,
        body: { diac: { text: ++call === 1 ? "أوّل" : "ثاني" } },
      }));
    });
    await act(async () => {
      await result.current.analyze("وين");
    });

    await act(async () => {
      await result.current.analyze("رحت");
    });

    // Vowels shown against the wrong word are worse than no vowels: they would
    // be read as a pronunciation of the text on screen.
    expect(result.current.result?.diac?.text).toBe("ثاني");
  });
});

describe("the per-task wrappers", () => {
  it("diacritize returns the voweled text", async () => {
    const { result, backend } = render(stub({ diac: { text: "وَيْن" } }));

    let voweled: string | null = null;
    await act(async () => {
      voweled = await result.current.diacritize("وين");
    });

    expect(voweled).toBe("وَيْن");
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({ tasks: ["diac"] });
  });

  it("segment returns the clitic breakdown", async () => {
    const { result, backend } = render(stub({ seg: { raw: "و+ب+ال+كتاب", tokens: [A_SEG_TOKEN] } }));

    let tokens;
    await act(async () => {
      tokens = await result.current.segment("وبالكتاب");
    });

    // Three prefixes on one stem is the shape Arabic learners find hardest to
    // see, and the reason the word card shows this at all.
    expect(tokens).toEqual([A_SEG_TOKEN]);
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({ tasks: ["seg"] });
  });

  it("tagPOS returns the labelled tags", async () => {
    const { result, backend } = render(
      stub({ pos: { raw: "", tokens: [{ word: "ذهب", tag: "V", label: "Verb (past)" }] } }),
    );

    let tokens;
    await act(async () => {
      tokens = await result.current.tagPOS("ذهب الولد");
    });

    // The human-readable label matters more than the tag: "V" means nothing to
    // a learner reading a grammar lesson.
    expect(tokens).toEqual([{ word: "ذهب", tag: "V", label: "Verb (past)" }]);
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({ tasks: ["pos"] });
  });

  it("recognizeEntities returns the entities", async () => {
    const { result, backend } = render(
      stub({ NER: { raw: "", entities: [{ text: "دبي", type: "LOC", typeLabel: "Location" }] } }),
    );

    let entities;
    await act(async () => {
      entities = await result.current.recognizeEntities("رحت دبي");
    });

    expect(entities).toEqual([{ text: "دبي", type: "LOC", typeLabel: "Location" }]);
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({ tasks: ["NER"] });
  });

  it("parseDependencies returns the tree", async () => {
    const { result, backend } = render(
      stub({
        parsing: {
          raw: "",
          tokens: [{ index: 1, word: "يحب", head: 0, relation: "root", relationLabel: "Root" }],
        },
      }),
    );

    let tokens;
    await act(async () => {
      tokens = await result.current.parseDependencies("يحب الطفل الكتاب");
    });

    expect(tokens).toHaveLength(1);
    expect(backend.lastCallTo("farasa")?.body).toMatchObject({ tasks: ["parsing"] });
  });

  it("returns nothing rather than an empty shape when a task is unavailable", async () => {
    const { result } = render(
      stub({ diac: null, diacAvailable: false, diacError: "invalid_api_key" }),
    );

    let voweled: string | null = "unset";
    await act(async () => {
      voweled = await result.current.diacritize("وين");
    });

    // Null is the signal to send the bare text to TTS. An empty string would be
    // spoken as silence.
    expect(voweled).toBeNull();
  });
});

describe("when a task fails", () => {
  it("says which task failed and why", async () => {
    const { result } = render(
      stub({
        diac: { text: "وَين" },
        seg: null,
        segAvailable: false,
        segError: "timeout",
        errors: { seg: "timeout" },
      }),
    );

    await act(async () => {
      await result.current.analyze("وين", ["diac", "seg"]);
    });

    // Tasks are independent, so a slow segmentation must not cost the caller
    // the vowels it also asked for.
    expect(result.current.result?.diac?.text).toBe("وَين");
    expect(result.current.result?.segAvailable).toBe(false);
    expect(result.current.result?.errors?.seg).toBe("timeout");
    // Not an error: the call succeeded and reported a partial result.
    expect(result.current.error).toBeNull();
  });

  it("distinguishes a missing secret from a flaky service", async () => {
    const { result } = render(
      stub({
        diac: null,
        diacAvailable: false,
        diacError: "invalid_api_key",
        configHint: "Set FARASA_API_KEY",
      }),
    );

    await act(async () => {
      await result.current.analyze("وين");
    });

    // `invalid_api_key` is permanent until somebody sets the secret, so a
    // caller that retried on it would loop forever; the hint is what turns the
    // failure into something an admin can act on.
    expect(result.current.result?.diacError).toBe("invalid_api_key");
    expect(result.current.result?.configHint).toContain("FARASA_API_KEY");
  });

  it("reports a refused call instead of throwing", async () => {
    const { result } = render((backend) => backend.stubFunctionFailure("farasa", 500));

    let analysed: unknown = "unset";
    await act(async () => {
      analysed = await result.current.analyze("وين");
    });

    // This is called on a keystroke in places; an exception would take the page
    // down over an optional enrichment.
    expect(analysed).toBeNull();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
  });

  it("clears a stale error on the next successful run", async () => {
    const { result } = render((backend) => {
      let call = 0;
      backend.stubFunction("farasa", () =>
        ++call === 1
          ? { status: 500, body: { error: "boom" } }
          : { status: 200, body: { diac: { text: "وَين" } } },
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
    expect(result.current.result?.diac?.text).toBe("وَين");
  });

  it("clears everything on request", async () => {
    const { result } = render(stub({ diac: { text: "وَين" } }));
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
