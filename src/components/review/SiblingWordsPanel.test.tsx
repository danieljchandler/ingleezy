import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary, TEST_USER_ID } from "@/test/support/factories";
import { saveRootFamiliesEnabled } from "@/lib/rootFamilyPrefs";
import { SiblingWordsPanel } from "./SiblingWordsPanel";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The footnote under a reviewed card listing the other words the learner knows
 * from the same word family.
 *
 * This file did not exist while the component did, which is how the component
 * shipped reading `user_vocabulary.stage` — a column created by no migration,
 * written only by the Anki importer, and absent from `aUserVocabulary`. Any
 * render here would have thrown on `s.stage.toLowerCase()`. The first test
 * below is the one that would have caught it.
 *
 * The rest are about restraint. The panel annotates a flashcard mid-recall, so
 * it has to stay collapsed until asked, disappear entirely when there is
 * nothing to say, and never claim a family is smaller than it is.
 */

const ROOT = "act";

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
    word_family: ROOT,
    dialect: "Gulf",
    ...over,
  });

function render(rows: Record<string, unknown>[], props: Partial<{ onOpenFamily: (key: string) => void; onPlayAudio: (url: string) => void }> = {}) {
  const harness = renderWithProviders(
    <SiblingWordsPanel
      root={ROOT}
      currentWordId="voc-0"
      dialect="Gulf"
      {...props}
    />,
    {
      persona: "free",
      seed: (backend: SupabaseBackend) => backend.db.seed("user_vocabulary", rows),
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

const summary = () => screen.findByRole("button", { name: /من نفس العائلة/ });

/**
 * Open the list, whatever it was showing when it mounted.
 *
 * Expansion is remembered for the session on purpose — a learner who opens it
 * on one card wants it open on the next — so a test cannot assume it starts
 * closed just because the previous test left it that way.
 */
async function expand(user: ReturnType<typeof userEvent.setup>) {
  const toggle = await summary();
  if (toggle.getAttribute("aria-expanded") === "false") await user.click(toggle);
  return toggle;
}

describe("rendering at all", () => {
  it("renders a family without a `stage` column in sight", async () => {
    // `aUserVocabulary` has no `stage` key because no migration creates one.
    // The panel this replaced read it unconditionally.
    render([aWord(0), aWord(1)]);

    expect(await summary()).toBeInTheDocument();
  });

  it("says nothing when the card is the only word on its root", async () => {
    const { container } = render([aWord(0)]);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("says nothing while the learner has the feature switched off", async () => {
    saveRootFamiliesEnabled(false);

    const { container } = render([aWord(0), aWord(1), aWord(2)]);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("staying out of the way", () => {
  it("starts collapsed, showing only how many words there are", async () => {
    render([aWord(0), aWord(1), aWord(2)]);

    expect(await screen.findByText("كلمتان تعرفهما من نفس العائلة")).toBeInTheDocument();
    // The words themselves are an opt-in: the learner is mid-recall.
    expect(screen.queryByText("word 1")).not.toBeInTheDocument();
  });

  it("counts one sibling in the singular", async () => {
    render([aWord(0), aWord(1)]);

    expect(await screen.findByText("كلمة واحدة تعرفها من نفس العائلة")).toBeInTheDocument();
  });

  it("shows the family as the English base form it is", async () => {
    render([aWord(0), aWord(1)]);

    await summary();
    expect(screen.getByText("act")).toBeInTheDocument();
  });

  it("opens and closes on click", async () => {
    const user = userEvent.setup();
    render([aWord(0), aWord(1)]);

    const toggle = await expand(user);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("word 1")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("word 1")).not.toBeInTheDocument();
  });

  it("keeps the learner's choice as they move to the next card", async () => {
    const user = userEvent.setup();
    const first = render([aWord(0), aWord(1)]);
    await expand(user);
    first.cleanup();

    // A fresh mount, as the next card in the session produces. Reopening the
    // list on every single card would be its own kind of nagging.
    render([aWord(0), aWord(1)]);

    expect(await summary()).toHaveAttribute("aria-expanded", "true");
    // Put it back for whatever runs next — the state is deliberately shared.
    await user.click(await summary());
  });
});

describe("the family behind the list", () => {
  it("orders the strongest-remembered word first", async () => {
    const user = userEvent.setup();
    render([
      aWord(0),
      aWord(1, { word_english: "weak", ease_factor: 2 }),
      aWord(2, { word_english: "strong", ease_factor: 90 }),
    ]);

    await expand(user);

    const listed = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(listed[0]).toContain("strong");
  });

  it("offers the rest of the family rather than pretending it ends at the cap", async () => {
    const user = userEvent.setup();
    const onOpenFamily = vi.fn();
    render(
      Array.from({ length: 9 }, (_, index) => aWord(index)),
      { onOpenFamily },
    );

    await expand(user);
    // Eight siblings, five shown.
    await user.click(screen.getByRole("button", { name: "+3 أخرى" }));

    expect(onOpenFamily).toHaveBeenCalledWith("act");
  });

  it("does not offer more when the whole family is already listed", async () => {
    const user = userEvent.setup();
    render([aWord(0), aWord(1), aWord(2)], { onOpenFamily: vi.fn() });

    await expand(user);

    expect(screen.queryByRole("button", { name: /أخرى/ })).not.toBeInTheDocument();
  });

  it("plays a sibling's audio, named for a screen reader", async () => {
    const user = userEvent.setup();
    const onPlayAudio = vi.fn();
    render([aWord(0), aWord(1, { word_audio_url: "https://cdn.test/book.mp3" })], {
      onPlayAudio,
    });

    await expand(user);
    await user.click(screen.getByRole("button", { name: "شغّل word 1" }));

    expect(onPlayAudio).toHaveBeenCalledWith("https://cdn.test/book.mp3");
  });
});
