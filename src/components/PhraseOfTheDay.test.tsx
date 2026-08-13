import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile, TEST_USER_ID } from "@/test/support/factories";
import { useAiAssistant } from "@/contexts/AiAssistantContext";
import { PhraseOfTheDay } from "./PhraseOfTheDay";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { Persona } from "@/test/support/personas";

/**
 * The card at the top of the home screen: one English phrase a day, glossed in
 * the learner's dialect.
 *
 * It is a recall exercise disguised as a widget. The Arabic meaning shows
 * first and the English is hidden behind a tap, because reading a phrase you
 * can already see teaches nothing — trying to produce it and then checking is
 * the whole exercise, and it is the same thing the review deck does, offered
 * to somebody who opened the app with no intention of studying.
 *
 * The caching is per dialect per day for a reason beyond cost: the point of a
 * phrase of the *day* is that it is the same phrase every time you come back
 * to it. Regenerating on each visit would make it a phrase of the moment, and
 * nothing would ever be learned from it.
 */

const TODAY = new Date().toISOString().slice(0, 10);

const aPhrase = (over: Record<string, unknown> = {}) => ({
  phrase_english: "How's it going?",
  phrase_arabic: "شخبارك؟",
  transliteration: "هاوز إت قوينق؟",
  notes: "تحية ودية بين الأصحاب، مو رسمية.",
  dialect: "Gulf",
  date: TODAY,
  category: "greetings",
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

/**
 * Reads what the card told the global assistant, the way the Ask AI panel
 * would: the published page context and the seed a chip click sets.
 */
function AssistantProbe() {
  const { pageContext, seed, isOpen } = useAiAssistant();
  return (
    <>
      <div data-testid="ai-page-context">{pageContext?.content ?? ""}</div>
      <div data-testid="ai-seed">{isOpen ? (seed?.arabic ?? "") : ""}</div>
    </>
  );
}

interface Options {
  persona?: Persona;
  dialect?: string;
  seed?: (backend: SupabaseBackend) => void;
}

function render({ persona = "free", dialect = "Gulf", seed }: Options = {}) {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const harness = renderWithProviders(
    <>
      <PhraseOfTheDay />
      <AssistantProbe />
    </>,
    {
      persona,
      seed: (backend) => {
        backend.db.seed("profiles", [
          aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect }),
        ]);
        backend.stubFunction("phrase-of-the-day", aPhrase());
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

const cacheKey = (dialect = "Gulf") => `phraseOfDay:${dialect}:${TODAY}`;

describe("showing today's phrase", () => {
  it("leads with the Arabic meaning and hides the English", async () => {
    render();

    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());
    // Reading a phrase you can already see teaches nothing. Reaching for the
    // English and then checking is the exercise.
    expect(screen.queryByText("How's it going?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reveal english/i })).toBeInTheDocument();
  });

  it("reveals the English and its phonetic reading together", async () => {
    render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /reveal english/i }));

    // The phonetic_ar is the answer key to the pronunciation, so it belongs
    // with the reveal rather than beside the prompt.
    expect(screen.getByText("How's it going?")).toBeInTheDocument();
    expect(screen.getByText("هاوز إت قوينق؟")).toBeInTheDocument();
  });

  it("can be hidden again for another go", async () => {
    render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reveal english/i }));

    fireEvent.click(screen.getByRole("button", { name: /hide english/i }));

    expect(screen.queryByText("How's it going?")).not.toBeInTheDocument();
  });

  it("shows the usage note when there is one", async () => {
    render();

    // The note arrives in the learner's own dialect — it is what makes the
    // difference between a phrase and a phrasebook entry.
    await waitFor(() =>
      expect(screen.getByText("تحية ودية بين الأصحاب، مو رسمية.")).toBeInTheDocument(),
    );
  });

  it("names the gloss dialect", async () => {
    render({ dialect: "Egyptian", seed: (b) => b.stubFunction("phrase-of-the-day", aPhrase()) });

    await waitFor(() =>
      expect(screen.getByText("English · glossed in Egyptian")).toBeInTheDocument(),
    );
  });

  it("asks for the learner's dialect", async () => {
    const { backend } = render({ dialect: "Yemeni" });

    await waitFor(() => expect(backend.callsTo("phrase-of-the-day")).toHaveLength(1));
    // A Gulf greeting shown to a Yemeni learner is a phrase they will be
    // corrected on the first time they use it.
    expect(backend.lastCallTo("phrase-of-the-day")?.body).toMatchObject({
      dialect: "Yemeni",
      seed: TODAY,
    });
  });
});

describe("keeping it the phrase of the day", () => {
  it("stores it so the next visit is the same phrase", async () => {
    render();

    await waitFor(() => expect(localStorage.getItem(cacheKey())).toBeTruthy());
    expect(JSON.parse(localStorage.getItem(cacheKey())!).phrase_english).toBe("How's it going?");
  });

  it("reads the stored phrase rather than generating another", async () => {
    localStorage.setItem(cacheKey(), JSON.stringify(aPhrase({ phrase_arabic: "صباح الخير" })));
    const { backend } = render();

    await waitFor(() => expect(screen.getByText("صباح الخير")).toBeInTheDocument());
    // The point of a phrase of the *day* is that it is the same phrase each
    // time you come back to it; regenerating would make it unlearnable.
    expect(backend.callsTo("phrase-of-the-day")).toEqual([]);
  });

  it("keeps a separate phrase per dialect", async () => {
    localStorage.setItem(cacheKey("Gulf"), JSON.stringify(aPhrase()));
    const { backend } = render({ dialect: "Egyptian" });

    // A learner studying two dialects gets a phrase in each, not one shared
    // between them.
    await waitFor(() => expect(backend.callsTo("phrase-of-the-day")).toHaveLength(1));
  });

  it("does not store a phrase that needed repairing", async () => {
    render({
      seed: (b) => b.stubFunction("phrase-of-the-day", aPhrase({ _meta: { msaRepairs: 2 } })),
    });

    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());
    // A phrase the MSA filter had to rewrite is borderline by definition;
    // pinning it for the day would give the learner a whole day of it.
    expect(localStorage.getItem(cacheKey())).toBeNull();
  });
});

describe("asking for another", () => {
  it("generates a fresh one rather than reusing the stored phrase", async () => {
    localStorage.setItem(cacheKey(), JSON.stringify(aPhrase({ phrase_arabic: "صباح الخير" })));
    const { backend } = render();
    await waitFor(() => expect(screen.getByText("صباح الخير")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh phrase/i }));
    });

    await waitFor(() => expect(backend.callsTo("phrase-of-the-day")).toHaveLength(1));
    // A different seed, or the model would return the same phrase it was
    // just asked for.
    const body = backend.lastCallTo("phrase-of-the-day")?.body as { seed: string };
    expect(body.seed).not.toBe(TODAY);
  });

  it("steers away from the category already seen today", async () => {
    const { backend } = render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh phrase/i }));
    });

    // Otherwise "another one" returns a third greeting, and the learner
    // concludes the feature only knows greetings.
    await waitFor(() =>
      expect(backend.lastCallTo("phrase-of-the-day")?.body).toMatchObject({
        avoidCategories: ["greetings"],
      }),
    );
  });

  it("hides the English again for the new phrase", async () => {
    render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reveal english/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh phrase/i }));
    });

    // A new phrase arriving already revealed would skip the exercise.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /reveal english/i })).toBeInTheDocument(),
    );
  });
});

describe("saving it", () => {
  it("keeps the phrase with its reading and note", async () => {
    const { backend } = render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save as flashcard/i }));
    });

    await waitFor(() =>
      expect(backend.db.lastWriteTo("user_phrases")?.payload[0]).toMatchObject({
        phrase_english: "How's it going?",
        phrase_arabic: "شخبارك؟",
        transliteration: "هاوز إت قوينق؟",
        source: "phrase-of-the-day",
      }),
    );
  });

  it("says so once it is saved", async () => {
    render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save as flashcard/i }));
    });

    // And stops being pressable, so a second tap cannot add the same phrase
    // to the deck twice.
    await waitFor(() => expect(screen.getByRole("button", { name: /saved/i })).toBeDisabled());
  });

  it("refuses for a signed-out visitor", async () => {
    const { backend } = render({ persona: "anonymous" });
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save as flashcard/i }));
    });

    // The card is worth showing to somebody who has not signed up — it is the
    // clearest sample of what the app teaches — but there is nowhere to keep it.
    expect(backend.db.writesTo("user_phrases")).toEqual([]);
  });
});

describe("telling the assistant what's on screen", () => {
  it("publishes today's phrase as the page context", async () => {
    render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    // "Tell me about the phrase of the day" must be answered about THIS
    // phrase; without the published context the assistant invents one.
    await waitFor(() =>
      expect(screen.getByTestId("ai-page-context").textContent).toContain("شخبارك؟"),
    );
    const ctx = screen.getByTestId("ai-page-context").textContent!;
    expect(ctx).toContain("هاوز إت قوينق؟");
    expect(ctx).toContain("How's it going?");
  });

  it("tells the assistant the English is still hidden until it is revealed", async () => {
    render();
    await waitFor(() =>
      expect(screen.getByTestId("ai-page-context").textContent).toContain("hidden"),
    );

    fireEvent.click(screen.getByRole("button", { name: /reveal english/i }));

    // Once revealed, the "hidden" caveat would just be wrong.
    await waitFor(() =>
      expect(screen.getByTestId("ai-page-context").textContent).not.toContain("hidden"),
    );
  });

  it("publishes nothing while there is no phrase to talk about", async () => {
    const { backend } = render({
      seed: (b) => b.stubFunctionFailure("phrase-of-the-day", 500, { error: "gateway down" }),
    });

    await waitFor(() => expect(backend.callsTo("phrase-of-the-day").length).toBeGreaterThan(0));
    // The route's generic hint is better than a stale or empty phrase block.
    expect(screen.getByTestId("ai-page-context").textContent).toBe("");
  });

  it("opens the assistant seeded with the phrase from the Ask AI chip", async () => {
    render();
    await waitFor(() => expect(screen.getByText("شخبارك؟")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));

    // The chip pins the conversation to this exact phrase, so follow-up
    // questions ("why this word order?") have a stable referent.
    expect(screen.getByTestId("ai-seed").textContent).toBe("شخبارك؟");
  });
});

describe("when there is no phrase", () => {
  it("renders the card without one rather than an error", async () => {
    const { backend } = render({
      seed: (b) => b.stubFunctionFailure("phrase-of-the-day", 500, { error: "gateway down" }),
    });

    // It is the first thing on the home screen. A failure here must not be the
    // first thing a learner sees, and the rest of the page is unaffected.
    await waitFor(() => expect(backend.callsTo("phrase-of-the-day").length).toBeGreaterThan(0));
    expect(screen.getByText("Phrase of the Day")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save as flashcard/i })).not.toBeInTheDocument();
  });

  it("reports the reason when the generator declines", async () => {
    const { backend } = render({
      seed: (b) =>
        b.stubFunction("phrase-of-the-day", {
          fallback: true,
          message: "Phrase of the day is resting",
        }),
    });

    // A deliberate fallback is not a network failure and must not be retried;
    // the learner is told once and the card stays quiet.
    await waitFor(() => expect(backend.callsTo("phrase-of-the-day")).toHaveLength(1));
  });
});
