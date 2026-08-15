import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import type { ContinueEntry } from "@/lib/continueProgress";
import { ContinueCard } from "./ContinueCard";

/**
 * The "pick up where you left off" strip at the top of Home.
 *
 * It reads from two places on purpose. localStorage is the fast path — it is
 * there before any query resolves and it works signed out — but it holds one
 * entry, expires after a week and does not cross devices. The server's
 * in-progress lesson is the slow path that survives a new phone. The card's job
 * is to prefer the first and fall back to the second, and to stay scoped to the
 * dialect the learner is actually studying: offering a Gulf lesson to someone
 * who has switched to Egyptian is worse than offering nothing.
 */

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

interface Resumable {
  lessonId: string;
  title: string;
  lastWordIndex: number;
  wordsSeen: number;
  wordsTotal: number;
  updatedAt: string;
}
const lesson = vi.hoisted(() => ({ data: null as Resumable | null }));
vi.mock("@/hooks/useLessonProgress", () => ({
  useResumableLesson: () => ({ data: lesson.data }),
}));

const STORAGE_KEY = "ingleezy:continue:v1";
const NOW = new Date("2026-03-10T12:00:00Z");

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  navigate.mockReset();
  lesson.data = null;
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  localStorage.clear();
});

const anEntry = (over: Partial<ContinueEntry> = {}): ContinueEntry => ({
  kind: "story",
  route: "/stories/abc",
  title: "The Merchant of Muscat",
  dialect: "Gulf",
  updatedAt: NOW.getTime() - 5 * 60_000,
  ...over,
});

const aResumable = (over: Partial<Resumable> = {}): Resumable => ({
  lessonId: "lesson-1",
  title: "Ordering coffee",
  lastWordIndex: 3,
  wordsSeen: 4,
  wordsTotal: 10,
  updatedAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
  ...over,
});

interface Options {
  entry?: ContinueEntry | null;
  /** Raw localStorage payload, for the malformed cases. */
  raw?: string;
  resumable?: Resumable | null;
  activeDialect?: string;
}

function render({ entry, raw, resumable = null, activeDialect = "Gulf" }: Options = {}) {
  if (raw !== undefined) localStorage.setItem(STORAGE_KEY, raw);
  else if (entry) localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  localStorage.setItem("ingleezy_dialect_module", activeDialect);
  lesson.data = resumable;

  const harness = renderWithProviders(<ContinueCard />);
  cleanup = harness.cleanup;
  return harness;
}

const card = () => screen.queryByRole("button", { name: /^كمّل / });

describe("ContinueCard — with nothing to continue", () => {
  it("renders nothing at all", () => {
    const { container } = render();
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores an entry older than the week it is kept for", () => {
    // Seven days is the point at which "where you left off" stops being a
    // useful offer and starts being a reminder of an abandoned thing.
    render({ entry: anEntry({ updatedAt: NOW.getTime() - 8 * 24 * 3600_000 }) });
    expect(card()).not.toBeInTheDocument();
  });

  it("ignores a stored value that is not an entry", () => {
    render({ raw: "{{not json" });
    expect(card()).not.toBeInTheDocument();
  });

  it("ignores an entry with no timestamp", () => {
    render({ raw: JSON.stringify({ kind: "story", route: "/x", title: "X" }) });
    expect(card()).not.toBeInTheDocument();
  });
});

describe("ContinueCard — the local entry", () => {
  it("offers the thing the learner was last on", () => {
    render({ entry: anEntry() });
    expect(screen.getByText("The Merchant of Muscat")).toBeInTheDocument();
    expect(screen.getByText("كمّل القصة")).toBeInTheDocument();
  });

  it("says how long ago it was", () => {
    render({ entry: anEntry({ updatedAt: NOW.getTime() - 3 * 3600_000 }) });
    expect(screen.getByText("· 3h ago")).toBeInTheDocument();
  });

  it.each([
    ["story", "كمّل القصة"],
    ["video", "كمّل الفيديو"],
    ["lesson", "كمّل الدرس"],
  ] as const)("labels a %s entry", (kind, label) => {
    render({ entry: anEntry({ kind }) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows the position within the thing when it has one", () => {
    render({ entry: anEntry({ subtitle: "Scene 3 of 8" }) });
    expect(screen.getByText("Scene 3 of 8")).toBeInTheDocument();
  });

  it("names both the kind and the title for a screen reader", () => {
    render({ entry: anEntry({ kind: "video", title: "Souq walkthrough" }) });
    expect(
      screen.getByRole("button", { name: "كمّل الفيديو: Souq walkthrough" }),
    ).toBeInTheDocument();
  });

  it("goes to the saved route when tapped", () => {
    render({ entry: anEntry({ route: "/stories/abc" }) });
    fireEvent.click(card()!);
    expect(navigate).toHaveBeenCalledWith("/stories/abc");
  });
});

describe("ContinueCard — scoping to the active dialect", () => {
  it("hides an entry from a dialect the learner has left", () => {
    render({ entry: anEntry({ dialect: "Egyptian" }), activeDialect: "Gulf" });
    expect(card()).not.toBeInTheDocument();
  });

  it("keeps an entry that predates dialect tagging", () => {
    // Entries written before the field existed have no dialect. Dropping them
    // would silently break resume for anyone who had not started a new thing.
    render({ entry: anEntry({ dialect: undefined }), activeDialect: "Egyptian" });
    expect(screen.getByText("The Merchant of Muscat")).toBeInTheDocument();
  });

  it("falls through to the server lesson when the local entry is off-dialect", () => {
    render({
      entry: anEntry({ dialect: "Egyptian" }),
      resumable: aResumable(),
      activeDialect: "Gulf",
    });
    expect(screen.getByText("Ordering coffee")).toBeInTheDocument();
  });
});

describe("ContinueCard — falling back to the server", () => {
  it("offers the in-progress lesson when there is nothing stored locally", () => {
    render({ resumable: aResumable() });
    expect(screen.getByText("Ordering coffee")).toBeInTheDocument();
    expect(screen.getByText("كمّل الدرس")).toBeInTheDocument();
  });

  it("routes to the lesson", () => {
    render({ resumable: aResumable({ lessonId: "abc-123" }) });
    fireEvent.click(card()!);
    expect(navigate).toHaveBeenCalledWith("/learn/abc-123");
  });

  it("says how far through the lesson the learner got", () => {
    render({ resumable: aResumable({ lastWordIndex: 3, wordsTotal: 10 }) });
    expect(screen.getByText("Word 4 of 10")).toBeInTheDocument();
  });

  it("never claims a position past the end", () => {
    // last_word_index is written as the learner advances and can equal the
    // total once they finish the last word; "Word 11 of 10" reads as a bug.
    render({ resumable: aResumable({ lastWordIndex: 12, wordsTotal: 10 }) });
    expect(screen.getByText("Word 10 of 10")).toBeInTheDocument();
  });

  it("omits the position when the lesson has no word count", () => {
    render({ resumable: aResumable({ wordsTotal: 0 }) });
    expect(screen.getByText("Ordering coffee")).toBeInTheDocument();
    expect(screen.queryByText(/^Word /)).not.toBeInTheDocument();
  });

  it("prefers the local entry when both exist", () => {
    // The local one is by definition more recent — it is written as the learner
    // moves, whereas the lesson row is only touched on word boundaries.
    render({ entry: anEntry(), resumable: aResumable() });
    expect(screen.getByText("The Merchant of Muscat")).toBeInTheDocument();
    expect(screen.queryByText("Ordering coffee")).not.toBeInTheDocument();
  });

  it("stops offering a lesson abandoned months ago", () => {
    // The local entry expires after seven days; the lesson_progress row behind
    // the fallback had no cutoff at all, so a learner who opened one lesson in
    // January and never went back was still shown "Continue lesson … 250d ago"
    // in September, at the top of Home.
    render({
      resumable: aResumable({
        updatedAt: new Date(NOW.getTime() - 250 * 24 * 3600_000).toISOString(),
      }),
    });
    expect(card()).not.toBeInTheDocument();
  });

  it("still offers one from beyond the local seven days", () => {
    // The whole point of the server row is surviving a new device, a cleared
    // cache or a fortnight away, so its cutoff is deliberately longer.
    render({
      resumable: aResumable({
        updatedAt: new Date(NOW.getTime() - 14 * 24 * 3600_000).toISOString(),
      }),
    });
    expect(screen.getByText("Ordering coffee")).toBeInTheDocument();
  });

  it("drops one a day past the cutoff", () => {
    render({
      resumable: aResumable({
        updatedAt: new Date(NOW.getTime() - 31 * 24 * 3600_000).toISOString(),
      }),
    });
    expect(card()).not.toBeInTheDocument();
  });
});

describe("ContinueCard — dismissing", () => {
  it("takes the card away", () => {
    render({ entry: anEntry() });
    fireEvent.click(screen.getByTitle("أخفِ"));
    expect(card()).not.toBeInTheDocument();
  });

  it("forgets the stored entry", () => {
    render({ entry: anEntry() });
    fireEvent.click(screen.getByTitle("أخفِ"));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not navigate on the way out", () => {
    render({ entry: anEntry() });
    fireEvent.click(screen.getByTitle("أخفِ"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("stays away when the server would otherwise put it straight back", () => {
    // Clearing localStorage does not delete the lesson_progress row — the
    // learner really is mid-lesson — so without the dismissed-route guard the
    // card would reappear on the same render and the button would look broken.
    render({ resumable: aResumable() });
    fireEvent.click(screen.getByTitle("أخفِ"));
    expect(card()).not.toBeInTheDocument();
  });

  it("comes back for a different thing", () => {
    // Dismissal is keyed on the route rather than being a session-wide mute, so
    // starting something else still gets an offer to resume it.
    const { rerender } = render({ resumable: aResumable({ lessonId: "one" }) });
    fireEvent.click(screen.getByTitle("أخفِ"));

    lesson.data = aResumable({ lessonId: "two", title: "Haggling" });
    rerender(<ContinueCard />);
    expect(screen.getByText("Haggling")).toBeInTheDocument();
  });
});

describe("ContinueCard — keeping up with changes", () => {
  const emit = async (type: string) => {
    await act(async () => {
      window.dispatchEvent(new Event(type));
    });
  };

  it("appears when something is recorded in the same tab", async () => {
    render();
    expect(card()).not.toBeInTheDocument();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(anEntry()));
    await emit("ingleezy:continue-changed");

    expect(screen.getByText("The Merchant of Muscat")).toBeInTheDocument();
  });

  it("picks up a change made in another tab", async () => {
    render({ entry: anEntry() });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(anEntry({ title: "Newer thing" })));
    await emit("storage");

    expect(screen.getByText("Newer thing")).toBeInTheDocument();
  });

  it("re-reads when the window is focused again", async () => {
    // Coming back from another app is the commonest way the entry is stale —
    // the learner may have been in the app on their phone in between.
    render({ entry: anEntry() });

    localStorage.removeItem(STORAGE_KEY);
    await emit("focus");

    expect(card()).not.toBeInTheDocument();
  });

  it("stops listening once it is gone", async () => {
    const { unmount } = render({ entry: anEntry() });
    act(() => unmount());

    localStorage.setItem(STORAGE_KEY, JSON.stringify(anEntry()));
    await emit("ingleezy:continue-changed");

    expect(card()).not.toBeInTheDocument();
  });
});
