import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, TEST_USER_ID } from "@/test/support/factories";
import { RootFamilySheet } from "./RootFamilySheet";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The whole of one root family, reached from the "+N more" under a reviewed
 * card.
 *
 * It exists because the footnote on the card has to stay short — five words at
 * most — and a learner who has built up a big family should still be able to
 * see it. Everything it shows comes from the index already in cache, so opening
 * it costs no query and no AI.
 *
 * The one deliberate difference from the card footnote is dialect. On the card
 * siblings are restricted to the card's own dialect, because a pattern that
 * only holds in one of them would teach the wrong thing mid-recall. Browsing a
 * family is the opposite: seeing the same root turn up across dialects is the
 * interesting part, so they are shown and labelled rather than filtered out.
 */

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const aWord = (index: number, over: Record<string, unknown> = {}) =>
  aUserVocabulary({
    id: `voc-${index}`,
    user_id: TEST_USER_ID,
    word_arabic: `كلمة${index}`,
    word_english: `word ${index}`,
    root: "ك ت ب",
    dialect: "Gulf",
    ...over,
  });

function render(
  rows: Record<string, unknown>[],
  props: { familyKey?: string | null; onOpenChange?: (open: boolean) => void; onPlayAudio?: (url: string) => void } = {},
) {
  const harness = renderWithProviders(
    <RootFamilySheet
      familyKey={props.familyKey === undefined ? "كتب" : props.familyKey}
      onOpenChange={props.onOpenChange ?? (() => {})}
      onPlayAudio={props.onPlayAudio}
    />,
    {
      persona: "free",
      seed: (backend: SupabaseBackend) => backend.db.seed("user_vocabulary", rows),
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("opening a family", () => {
  it("lists every word in it, however the root was spelled", async () => {
    render([
      aWord(0, { root: "ك-ت-ب" }),
      aWord(1, { root: "ك ت ب" }),
      aWord(2, { root: "كتب" }),
    ]);

    expect(await screen.findByText("word 0")).toBeInTheDocument();
    expect(screen.getByText("word 1")).toBeInTheDocument();
    expect(screen.getByText("word 2")).toBeInTheDocument();
  });

  it("titles itself with the root, spaced out", async () => {
    render([aWord(0), aWord(1)]);

    expect(await screen.findByText("ك · ت · ب")).toBeInTheDocument();
  });

  it("counts the family, in the singular when there is one", async () => {
    render([aWord(0)]);

    expect(
      await screen.findByText("1 word you know is built from this root"),
    ).toBeInTheDocument();
  });

  it("names how well each word is remembered", async () => {
    render([aWord(0, { repetitions: 0 }), aWord(1, { repetitions: 4, ease_factor: 90 })]);

    await screen.findByText("word 0");
    // Derived from FSRS stability, the same source the analytics use — not the
    // `stage` column, which no migration creates and only the Anki importer
    // ever wrote.
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Mastered")).toBeInTheDocument();
  });

  it("stays shut when there is no family to show", async () => {
    render([aWord(0)], { familyKey: null });

    await waitFor(() => expect(screen.queryByText("word 0")).not.toBeInTheDocument());
  });
});

describe("dialects inside a family", () => {
  it("labels them when the family spans more than one", async () => {
    render([aWord(0), aWord(1, { dialect: "Yemeni" })]);

    await screen.findByText("word 0");
    expect(screen.getByText("Yemeni")).toBeInTheDocument();
    expect(screen.getByText("Gulf")).toBeInTheDocument();
  });

  it("keeps quiet about dialect when every word is in the same one", async () => {
    render([aWord(0), aWord(1)]);

    await screen.findByText("word 0");
    // Repeating "Gulf" against every row of a single-dialect deck is noise.
    expect(screen.queryByText("Gulf")).not.toBeInTheDocument();
  });
});

describe("playing a word", () => {
  it("plays audio when a word has it, named for a screen reader", async () => {
    const user = userEvent.setup();
    const onPlayAudio = vi.fn();
    render([aWord(0, { word_audio_url: "https://cdn.test/book.mp3" })], { onPlayAudio });

    await user.click(await screen.findByRole("button", { name: "شغّل word 0" }));

    expect(onPlayAudio).toHaveBeenCalledWith("https://cdn.test/book.mp3");
  });

  it("offers nothing to press when a word has no audio", async () => {
    render([aWord(0)], { onPlayAudio: vi.fn() });

    await screen.findByText("word 0");
    expect(screen.queryByRole("button", { name: /^Play/ })).not.toBeInTheDocument();
  });
});
