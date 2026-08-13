import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { RequestSituationCard } from "./RequestSituationCard";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { Persona } from "@/test/support/personas";

/**
 * "I need phrases for this exact situation" — the escape hatch from the fixed
 * set-phrase library.
 *
 * The library covers the situations somebody thought of in advance. A learner
 * about to visit a friend's grandfather in hospital, or meet their fiancée's
 * parents, needs the six things people actually say in that room, in their
 * dialect — and no curated list will ever have all of those. So this generates
 * them on demand and offers to keep them.
 *
 * Saving is the point rather than reading: a phrase read once and closed is
 * gone, and the source is stamped with the situation so that the deck later
 * remembers why the phrase is in it.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

const aPhrase = (over: Record<string, unknown> = {}) => ({
  phrase_arabic: "الله يرحمه",
  phrase_english: "May God have mercy on him",
  literal: "God have-mercy-on-him",
  transliteration: "allah yirhamah",
  notes: "The standard thing to say on hearing of a death.",
  ...over,
});

const ANOTHER_PHRASE = aPhrase({
  phrase_arabic: "البقية في حياتك",
  phrase_english: "May the rest of his life be added to yours",
  literal: "the-remainder in your-life",
  transliteration: "al-baqiya fi hayatak",
  notes: undefined,
});

const A_SITUATION = "Comforting a friend whose grandfather just passed away";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

interface Options {
  persona?: Persona;
  dialect?: string;
  seed?: (backend: SupabaseBackend) => void;
}

async function render({ persona = "free", dialect = "Gulf", seed }: Options = {}) {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const harness = renderWithProviders(<RequestSituationCard />, {
    persona,
    // DialectProvider syncs from the profile on mount and overwrites what is in
    // localStorage, so the profile has to agree or the component settles back on
    // the profile's dialect a tick after render.
    personaOptions: { profile: { preferred_dialect: dialect } },
    seed: (backend) => {
      backend.stubFunction("request-situation-phrases", {
        phrases: [aPhrase(), ANOTHER_PHRASE],
      });
      seed?.(backend);
    },
  });
  cleanup = harness.cleanup;
  // The prefs and bridge-mode hooks resolve a tick after mount, so a
  // synchronous assertion would race a re-render already on its way.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return harness;
}

const describeSituation = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText(/Comforting a friend/), {
    target: { value: text },
  });

const generate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /generate phrases/i }));
  });
};

const saveButtons = () => screen.getAllByRole("button", { name: /^Save$/ });

const phrasesWrittenTo = (backend: SupabaseBackend) =>
  backend.db.writesTo("user_phrases").flatMap((write) => write.payload);

describe("asking for phrases", () => {
  it("says what it will produce, in the learner's dialect", async () => {
    await render({ dialect: "Egyptian" });

    // "Authentic phrases" means nothing without saying authentic to whom.
    expect(screen.getByText(/authentic Egyptian phrases/)).toBeInTheDocument();
  });

  it("offers situations to start from", async () => {
    await render();

    fireEvent.click(screen.getByRole("button", { name: "Bargaining at the souq" }));

    // A blank box is the hardest thing to answer; the suggestions are there to
    // show the shape of a useful answer rather than to be used as-is.
    expect(screen.getByPlaceholderText(/Comforting a friend/)).toHaveValue(
      "Bargaining at the souq",
    );
  });

  it("asks for a real description before spending a call", async () => {
    const { backend } = await render();
    describeSituation("hi");

    await generate();

    expect(toasts.error).toHaveBeenCalledWith("Describe the situation in a sentence or two.");
    expect(backend.callsTo("request-situation-phrases")).toEqual([]);
  });

  it("sends the situation and the dialect", async () => {
    const { backend } = await render({ dialect: "Yemeni" });
    describeSituation(`  ${A_SITUATION}  `);

    await generate();

    // Trimmed, because the trailing space a learner leaves would otherwise be
    // part of the prompt and of the saved source.
    expect(backend.lastCallTo("request-situation-phrases")?.body).toMatchObject({
      situation: A_SITUATION,
      dialect: "Yemeni",
      count: 6,
    });
  });

  it("shows each phrase with everything needed to say it", async () => {
    await render();
    describeSituation(A_SITUATION);

    await generate();

    expect(screen.getByText("الله يرحمه")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("allah yirhamah")).toBeInTheDocument();
    expect(screen.getByText("May God have mercy on him")).toBeInTheDocument();
    // The literal is what explains the Arabic; the note is what stops a learner
    // using a condolence as a greeting.
    expect(screen.getByText(/God have-mercy-on-him/)).toBeInTheDocument();
    expect(screen.getByText(/standard thing to say on hearing of a death/)).toBeInTheDocument();
  });

  it("counts what came back", async () => {
    await render();
    describeSituation(A_SITUATION);

    await generate();

    expect(screen.getByText("2 phrases")).toBeInTheDocument();
  });

  it("says so when the model returned nothing usable", async () => {
    await render({ seed: (b) => b.stubFunction("request-situation-phrases", { phrases: [] }) });
    describeSituation("aaaaa");

    await generate();

    // Rephrasing is the fix, and a learner will not guess that from an empty
    // card.
    expect(toasts.error).toHaveBeenCalledWith("No phrases returned, try rephrasing.");
  });

  it("reports a refusal the function returned with a 200", async () => {
    await render({
      seed: (b) =>
        b.stubFunction("request-situation-phrases", {
          error: "refused",
          message: "That situation cannot be helped with phrases.",
        }),
    });
    describeSituation(A_SITUATION);

    await generate();

    expect(toasts.error).toHaveBeenCalledWith(
      "That situation cannot be helped with phrases.",
    );
  });

  it("reports a call that failed outright", async () => {
    await render({ seed: (b) => b.stubFunctionFailure("request-situation-phrases", 500) });
    describeSituation(A_SITUATION);

    await generate();

    expect(toasts.error).toHaveBeenCalled();
    expect(screen.queryByText("2 phrases")).toBeNull();
  });

  it("clears the previous answer before the next one", async () => {
    await render();
    describeSituation(A_SITUATION);
    await generate();

    describeSituation("Talking to a taxi driver in Kuwait City");
    await generate();

    // Phrases for the last situation sitting under a new one would be saved to
    // the deck with the wrong source.
    expect(screen.getAllByText("الله يرحمه")).toHaveLength(1);
  });
});

describe("keeping a phrase", () => {
  const generated = async (options: Options = {}) => {
    const harness = await render(options);
    describeSituation(A_SITUATION);
    await generate();
    return harness;
  };

  it("saves it with the situation that produced it", async () => {
    const { backend } = await generated();

    await act(async () => {
      fireEvent.click(saveButtons()[0]);
    });

    // The source is what lets My Phrases group a deck by why each phrase is in
    // it — otherwise every generated phrase is indistinguishable.
    await waitFor(() => expect(phrasesWrittenTo(backend)).toHaveLength(1));
    expect(phrasesWrittenTo(backend)[0]).toMatchObject({
      phrase_arabic: "الله يرحمه",
      phrase_english: "May God have mercy on him",
      transliteration: "allah yirhamah",
      source: `situation:${A_SITUATION}`,
      dialect: "Gulf",
    });
  });

  it("says so and stops offering to save it again", async () => {
    await generated();

    await act(async () => {
      fireEvent.click(saveButtons()[0]);
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /saved/i })).toBeInTheDocument(),
    );
    expect(toasts.success).toHaveBeenCalledWith("Saved to My Phrases");
    expect(saveButtons()).toHaveLength(1);
  });

  it("leaves the phrase saveable when the save failed", async () => {
    const { backend } = await generated({ seed: (b) => b.db.failInserts("user_phrases") });

    await act(async () => {
      fireEvent.click(saveButtons()[0]);
    });

    // A phrase the learner thinks they kept and did not is worse than an error.
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(saveButtons()).toHaveLength(2);
    expect(backend.db.rows("user_phrases")).toEqual([]);
  });

  it("saves the whole set in one go", async () => {
    const { backend } = await generated();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save all/i }));
    });

    // Six phrases for one situation are a set; saving them one at a time is six
    // decisions where there is really only one.
    await waitFor(() => expect(phrasesWrittenTo(backend)).toHaveLength(2));
    expect(phrasesWrittenTo(backend).map((p) => p.phrase_arabic)).toEqual([
      "الله يرحمه",
      "البقية في حياتك",
    ]);
  });

  it("does not save a phrase twice when saving them all", async () => {
    const { backend } = await generated();
    await act(async () => {
      fireEvent.click(saveButtons()[0]);
    });
    await waitFor(() => expect(phrasesWrittenTo(backend)).toHaveLength(1));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save all/i }));
    });

    await waitFor(() => expect(phrasesWrittenTo(backend)).toHaveLength(2));
  });

  it("reports saving them all even when none of them saved", async () => {
    await generated({ seed: (b) => b.db.failInserts("user_phrases") });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save all/i }));
    });

    // Pinned: Save all swallows each failure so that one duplicate cannot stop
    // the rest, then reports success unconditionally. When every insert fails —
    // signed out, offline, RLS — the learner is told the set was saved and finds
    // an empty deck later.
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Saved all phrases"));
    expect(toasts.error).not.toHaveBeenCalled();
    for (const button of saveButtons()) expect(button).toBeInTheDocument();
  });

  it("stamps the box's current text rather than what it generated from", async () => {
    const { backend } = await generated();

    describeSituation("Something else entirely");
    await act(async () => {
      fireEvent.click(saveButtons()[0]);
    });

    // Pinned: the source is read from the textarea at save time, not captured
    // when the phrases were generated. A learner who starts typing their next
    // situation before saving the current one files these phrases under the
    // wrong heading.
    await waitFor(() => expect(phrasesWrittenTo(backend)).toHaveLength(1));
    expect(phrasesWrittenTo(backend)[0].source).toBe("situation:Something else entirely");
  });
});
