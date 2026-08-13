import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aUserVocabulary } from "@/test/support/factories";
import type { InstalledBackend } from "@/test/support/transports/vitest";
import { MyWordsSection } from "./MyWordsSection";

/**
 * The saved-words strip on Home.
 *
 * Words a learner has saved are the most personal content in the app — they
 * chose each one — so the section exists to keep them visible rather than
 * buried behind a tab. It shows the five most recent, a count, and the way back
 * to the full list; the point is recognition, not management, which is why the
 * only action on a row is deleting the one that turned out to be a mistake.
 *
 * The dialect toggle is the interesting part. Saved words are tagged with the
 * dialect they were saved in, and by default the section only shows the module
 * the learner is currently studying — but someone revising before a trip wants
 * everything at once, which is what "Mixed" is for.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

type Backend = InstalledBackend["backend"];

let cleanup: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
  toast.success.mockReset();
  toast.error.mockReset();
  navigate.mockReset();
});

interface Options {
  seed?: (backend: Backend) => void;
  activeDialect?: string;
}

function render({ seed, activeDialect = "Gulf" }: Options = {}) {
  localStorage.setItem("hakiya_dialect_module", activeDialect);
  const harness = renderWithProviders(<MyWordsSection />, {
    persona: "standard",
    personaOptions: { profile: { preferred_dialect: activeDialect } },
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

/** A saved word, dated so `created_at` ordering is deterministic. */
const aWord = (n: number, over: Record<string, unknown> = {}) =>
  aUserVocabulary({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    word_arabic: `كلمة${n}`,
    word_english: `word ${n}`,
    created_at: new Date(2026, 0, n).toISOString(),
    // Far in the future, so nothing is due unless a test says so.
    next_review_at: new Date(2030, 0, 1).toISOString(),
    production_next_review_at: null,
    ...over,
  });

const seedWords = (count: number, over: Record<string, unknown> = {}) => (backend: Backend) => {
  for (let n = count; n >= 1; n--) backend.db.add("user_vocabulary", aWord(n, over));
};

const heading = () => screen.findByRole("heading", { name: "My Words" });

describe("MyWordsSection — when there is nothing to show", () => {
  it("takes up no space at all for a learner with no saved words", async () => {
    const { container } = render();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows a spinner rather than a flash of nothing while loading", async () => {
    const { container } = render({ seed: seedWords(3) });
    // The query is disabled until useAuth resolves the session on a macrotask,
    // so the busy state only exists after that and before the rows land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("disappears again when every word is in another dialect", async () => {
    const { container } = render({
      seed: seedWords(3, { dialect: "Egyptian" }),
      activeDialect: "Gulf",
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("MyWordsSection — the list", () => {
  it("names itself and counts the words", async () => {
    render({ seed: seedWords(3) });
    await heading();
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("shows each word in Arabic with its English", async () => {
    render({ seed: seedWords(2) });
    await heading();
    expect(screen.getByText("كلمة1")).toBeInTheDocument();
    expect(screen.getByText("word 1")).toBeInTheDocument();
  });

  it("marks the Arabic as right-to-left", async () => {
    // Without dir the browser reorders a word ending in punctuation or a Latin
    // gloss, which for a single saved word is the difference between correct
    // and mirrored.
    render({ seed: seedWords(1) });
    await heading();
    expect(screen.getByText("كلمة1")).toHaveAttribute("dir", "rtl");
  });

  it("shows the root when the word has one", async () => {
    render({ seed: (b) => b.db.add("user_vocabulary", aWord(1, { root: "ك ت ب" })) });
    await heading();
    expect(screen.getByText("ك ت ب")).toBeInTheDocument();
  });

  it("leaves the root out when there is none", async () => {
    render({ seed: seedWords(1) });
    await heading();
    expect(screen.queryByText("ك ت ب")).not.toBeInTheDocument();
  });

  it("shows at most five, newest first", async () => {
    render({ seed: seedWords(8) });
    await heading();

    // Seeded with created_at ascending in n, so 8 is newest.
    expect(screen.getByText("كلمة8")).toBeInTheDocument();
    expect(screen.getByText("كلمة4")).toBeInTheDocument();
    expect(screen.queryByText("كلمة3")).not.toBeInTheDocument();
  });

  it("offers the way to the rest when there are more than five", async () => {
    render({ seed: seedWords(8) });
    expect(await screen.findByText("View all 8 words")).toBeInTheDocument();
  });

  it("offers no such link when everything is already on screen", async () => {
    render({ seed: seedWords(5) });
    await heading();
    expect(screen.queryByText(/^View all/)).not.toBeInTheDocument();
  });

  it("goes to the full list", async () => {
    render({ seed: seedWords(8) });
    fireEvent.click(await screen.findByText("View all 8 words"));
    expect(navigate).toHaveBeenCalledWith("/my-words");
  });
});

describe("MyWordsSection — the dialect toggle", () => {
  it("starts scoped to the module being studied", async () => {
    render({
      seed: (b) => {
        b.db.add("user_vocabulary", aWord(1, { dialect: "Gulf" }));
        b.db.add("user_vocabulary", aWord(2, { dialect: "Egyptian" }));
      },
      activeDialect: "Gulf",
    });
    await heading();

    expect(screen.getByText("كلمة1")).toBeInTheDocument();
    expect(screen.queryByText("كلمة2")).not.toBeInTheDocument();
  });

  it("names the current module on the toggle", async () => {
    render({ seed: seedWords(1, { dialect: "Egyptian" }), activeDialect: "Egyptian" });
    expect(await screen.findByRole("button", { name: /Egyptian/ })).toBeInTheDocument();
  });

  it("brings in every dialect when mixed", async () => {
    render({
      seed: (b) => {
        b.db.add("user_vocabulary", aWord(1, { dialect: "Gulf" }));
        b.db.add("user_vocabulary", aWord(2, { dialect: "Egyptian" }));
      },
      activeDialect: "Gulf",
    });
    fireEvent.click(await screen.findByRole("button", { name: /Gulf/ }));

    expect(await screen.findByText("كلمة2")).toBeInTheDocument();
    expect(screen.getByText("كلمة1")).toBeInTheDocument();
  });

  it("says so once it is mixed", async () => {
    render({ seed: seedWords(1) });
    fireEvent.click(await screen.findByRole("button", { name: /Gulf/ }));
    expect(await screen.findByRole("button", { name: /Mixed/ })).toBeInTheDocument();
  });

  it("goes back to the single module on a second press", async () => {
    render({
      seed: (b) => {
        b.db.add("user_vocabulary", aWord(1, { dialect: "Gulf" }));
        b.db.add("user_vocabulary", aWord(2, { dialect: "Egyptian" }));
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Gulf/ }));
    await screen.findByText("كلمة2");
    fireEvent.click(screen.getByRole("button", { name: /Mixed/ }));

    await waitFor(() => expect(screen.queryByText("كلمة2")).not.toBeInTheDocument());
  });

  it("re-counts for the wider scope", async () => {
    render({
      seed: (b) => {
        b.db.add("user_vocabulary", aWord(1, { dialect: "Gulf" }));
        b.db.add("user_vocabulary", aWord(2, { dialect: "Egyptian" }));
        b.db.add("user_vocabulary", aWord(3, { dialect: "Yemeni" }));
      },
    });
    await screen.findByText("(1)");
    fireEvent.click(screen.getByRole("button", { name: /Gulf/ }));
    expect(await screen.findByText("(3)")).toBeInTheDocument();
  });
});

describe("MyWordsSection — the review prompt", () => {
  const due = { next_review_at: new Date(2020, 0, 1).toISOString() };

  it("appears only when something is actually due", async () => {
    render({ seed: seedWords(3) });
    await heading();
    expect(screen.queryByRole("button", { name: /Review/ })).not.toBeInTheDocument();
  });

  it("says how many are waiting", async () => {
    render({ seed: seedWords(2, due) });
    expect(await screen.findByRole("button", { name: /Review 2 due/ })).toBeInTheDocument();
  });

  it("counts a production review separately from a recognition one", async () => {
    // The same word can be due in both directions, and the review deck will
    // serve it twice — so the count has to add them rather than count rows.
    render({
      seed: (b) =>
        b.db.add(
          "user_vocabulary",
          aWord(1, { ...due, production_next_review_at: new Date(2020, 0, 1).toISOString() }),
        ),
    });
    expect(await screen.findByRole("button", { name: /Review 2 due/ })).toBeInTheDocument();
  });

  it("goes to the saved-words deck", async () => {
    render({ seed: seedWords(2, due) });
    fireEvent.click(await screen.findByRole("button", { name: /Review 2 due/ }));
    expect(navigate).toHaveBeenCalledWith("/review/my-words");
  });

  it("tells the deck when the count is a mixed one", async () => {
    // The count is across every dialect with "Mixed" on, but the button used
    // to route to a bare /review/my-words. The deck reads the globally active
    // dialect, so a learner told "Review 2 due" across two modules arrived at
    // a session holding only one — with nothing on either screen explaining it.
    render({
      seed: (b) => {
        b.db.add("user_vocabulary", aWord(1, { ...due, dialect: "Gulf" }));
        b.db.add("user_vocabulary", aWord(2, { ...due, dialect: "Egyptian" }));
      },
      activeDialect: "Gulf",
    });
    fireEvent.click(await screen.findByRole("button", { name: /Gulf/ }));

    fireEvent.click(await screen.findByRole("button", { name: /Review 2 due/ }));
    expect(navigate).toHaveBeenCalledWith("/review/my-words?mixed=1");
  });

  it("leaves the deck scoped when the count is one dialect's", async () => {
    render({ seed: seedWords(2, due), activeDialect: "Gulf" });
    fireEvent.click(await screen.findByRole("button", { name: /Review 2 due/ }));
    expect(navigate).toHaveBeenCalledWith("/review/my-words");
  });
});

describe("MyWordsSection — deleting a word", () => {
  const rowFor = (arabic: string) => screen.getByText(arabic).closest("div.flex.items-center")!;

  const deleteButtons = () =>
    screen.getAllByRole("button").filter((b) => b.querySelector(".lucide-trash2"));

  it("removes the word from the learner's saved list", async () => {
    const { backend } = render({ seed: seedWords(3) });
    await heading();

    fireEvent.click(deleteButtons()[0]);

    await waitFor(() => expect(backend.db.rows("user_vocabulary")).toHaveLength(2));
  });

  it("deletes the row the button belongs to", async () => {
    const { backend } = render({ seed: seedWords(3) });
    await heading();

    // Newest first, so the first row is كلمة3.
    fireEvent.click(within(rowFor("كلمة3").parentElement!).getAllByRole("button")[0]);

    await waitFor(() =>
      expect(
        backend.db.rows("user_vocabulary").map((r) => r.word_arabic as string),
      ).not.toContain("كلمة3"),
    );
  });

  it("confirms the deletion", async () => {
    render({ seed: seedWords(3) });
    await heading();

    fireEvent.click(deleteButtons()[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Word deleted"));
  });

  it("takes the row off the list", async () => {
    render({ seed: seedWords(3) });
    await heading();

    fireEvent.click(deleteButtons()[0]);
    await waitFor(() => expect(screen.queryByText("كلمة3")).not.toBeInTheDocument());
  });

  it("says so when the deletion fails", async () => {
    const { backend } = render({ seed: seedWords(3) });
    await heading();
    backend.db.failAlways("user_vocabulary");

    fireEvent.click(deleteButtons()[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to delete word"));
  });

  it("leaves the word on screen when the deletion fails", async () => {
    const { backend } = render({ seed: seedWords(3) });
    await heading();
    backend.db.failAlways("user_vocabulary");

    fireEvent.click(deleteButtons()[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("كلمة3")).toBeInTheDocument();
  });

  it("disappears entirely once the last word is gone", async () => {
    const { container } = render({ seed: seedWords(1) });
    await heading();

    fireEvent.click(deleteButtons()[0]);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
