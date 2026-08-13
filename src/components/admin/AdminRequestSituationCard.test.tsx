import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { occasionId } from "@/test/support/factories";
import { AdminRequestSituationCard } from "./AdminRequestSituationCard";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The admin twin of the learner's situational-phrase request.
 *
 * The learner-facing card generates phrases into that one learner's own deck.
 * This one generates them into the shared library, which is a different kind of
 * act: whatever is added here will be taught to everyone studying that dialect.
 * So nothing it produces is published — every phrase lands as a draft for a
 * human to read, tagged with where it came from, and the situation is kept as
 * the scenario so a reviewer can judge whether the phrase actually fits it.
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
  transliteration: "allah yirhamah",
  notes: "Said on hearing of a death.",
  ...over,
});

const ANOTHER_PHRASE = aPhrase({
  phrase_arabic: "البقية في حياتك",
  phrase_english: "May the rest of his life be added to yours",
  transliteration: "al-baqiya fi hayatak",
  notes: undefined,
});

const OCCASIONS = [
  { id: occasionId(0), name: "Condolences" },
  { id: occasionId(1), name: "Weddings" },
];

const A_SITUATION = "Comforting someone whose father just passed away";

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
  dialect?: string;
  occasions?: Array<{ id: string; name: string }>;
  seed?: (backend: SupabaseBackend) => void;
}

function render({ dialect = "Gulf", occasions = OCCASIONS, seed }: Options = {}) {
  localStorage.setItem("hakiya_dialect_module", dialect);
  const onSaved = vi.fn();
  const harness = renderWithProviders(
    <AdminRequestSituationCard occasions={occasions} onSaved={onSaved} />,
    {
      persona: "admin",
      seed: (backend) => {
        backend.stubFunction("request-situation-phrases", {
          phrases: [aPhrase(), ANOTHER_PHRASE],
        });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return { ...harness, onSaved };
}

const describeSituation = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText(/Comforting someone/), {
    target: { value: text },
  });

const generate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /generate phrases/i }));
  });
};

const addButtons = () => screen.getAllByRole("button", { name: /^Add to drafts$/ });

const draftsWritten = (backend: SupabaseBackend) =>
  backend.db.writesTo("set_phrases").flatMap((write) => write.payload);

describe("asking for phrases", () => {
  it("says which dialect it is generating for", () => {
    render({ dialect: "Egyptian" });

    // The library is per dialect, and an admin with three modules open needs to
    // know which one this will land in.
    expect(screen.getByText("Request situational phrases (Egyptian)")).toBeInTheDocument();
  });

  it("says where the phrases will end up", () => {
    render();

    // Nothing here is published. Saying so up front is what makes the button
    // safe to press.
    expect(screen.getByText(/land in the draft queue below for your review/)).toBeInTheDocument();
  });

  it("will not spend a call on a situation too short to act on", async () => {
    const { backend } = render();
    describeSituation("hm");

    await generate();

    expect(toasts.error).toHaveBeenCalledWith("Describe the situation in a sentence or two.");
    expect(backend.callsTo("request-situation-phrases")).toEqual([]);
  });

  it("asks for six phrases by default", async () => {
    const { backend } = render();
    describeSituation(A_SITUATION);

    await generate();

    expect(backend.lastCallTo("request-situation-phrases")?.body).toMatchObject({
      situation: A_SITUATION,
      dialect: "Gulf",
      count: 6,
    });
  });

  it("asks for as many as the admin chose", async () => {
    const { backend } = render();
    describeSituation(A_SITUATION);

    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "10" } });
    await generate();

    // Ten at a time is worth it for a rich occasion; four for a narrow one.
    expect(backend.lastCallTo("request-situation-phrases")?.body).toMatchObject({ count: 10 });
  });

  it("shows each phrase with the reviewer's context", async () => {
    render();
    describeSituation(A_SITUATION);

    await generate();

    expect(screen.getByText("الله يرحمه")).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("allah yirhamah")).toBeInTheDocument();
    expect(screen.getByText("May God have mercy on him")).toBeInTheDocument();
    expect(screen.getByText("Said on hearing of a death.")).toBeInTheDocument();
    expect(screen.getByText("2 phrases")).toBeInTheDocument();
  });

  it("says so when nothing came back", async () => {
    render({ seed: (b) => b.stubFunction("request-situation-phrases", { phrases: [] }) });
    describeSituation(A_SITUATION);

    await generate();

    expect(toasts.error).toHaveBeenCalledWith("No phrases returned");
  });

  it("reports a refusal returned with a 200", async () => {
    render({
      seed: (b) =>
        b.stubFunction("request-situation-phrases", {
          error: "refused",
          message: "Cannot generate phrases for that.",
        }),
    });
    describeSituation(A_SITUATION);

    await generate();

    expect(toasts.error).toHaveBeenCalledWith("Cannot generate phrases for that.");
  });

  it("clears the previous batch before the next", async () => {
    render();
    describeSituation(A_SITUATION);
    await generate();

    describeSituation("Bargaining at the souq");
    await generate();

    expect(screen.getAllByText("الله يرحمه")).toHaveLength(1);
  });
});

describe("adding a phrase to the drafts", () => {
  const generated = async (options: Options = {}) => {
    const harness = render(options);
    describeSituation(A_SITUATION);
    await generate();
    return harness;
  };

  it("files it as a draft with the situation it came from", async () => {
    const { backend } = await generated();

    await act(async () => {
      fireEvent.click(addButtons()[0]);
    });

    await waitFor(() => expect(draftsWritten(backend)).toHaveLength(1));
    // Draft, not published — and tagged, so a reviewer can find everything that
    // arrived this way if a batch turns out to be poor.
    expect(draftsWritten(backend)[0]).toMatchObject({
      dialect: "Gulf",
      phrase_arabic: "الله يرحمه",
      phrase_transliteration: "allah yirhamah",
      phrase_english: "May God have mercy on him",
      cultural_note: "Said on hearing of a death.",
      scenario_english: A_SITUATION,
      status: "draft",
      tags: ["situation-request"],
    });
  });

  it("attaches the occasion the admin picked", async () => {
    const { backend } = await generated();

    fireEvent.change(screen.getByLabelText(/occasion/i), { target: { value: occasionId(0) } });
    await act(async () => {
      fireEvent.click(addButtons()[0]);
    });

    await waitFor(() => expect(draftsWritten(backend)).toHaveLength(1));
    expect(draftsWritten(backend)[0].occasion_id).toBe(occasionId(0));
  });

  it("leaves the occasion unset rather than guessing", async () => {
    const { backend } = await generated();

    await act(async () => {
      fireEvent.click(addButtons()[0]);
    });

    // Filing a condolence under Weddings because something had to be chosen is
    // worse than leaving it for the reviewer.
    await waitFor(() => expect(draftsWritten(backend)).toHaveLength(1));
    expect(draftsWritten(backend)[0].occasion_id).toBeNull();
  });

  it("says so and stops offering to add it again", async () => {
    const { onSaved } = await generated();

    await act(async () => {
      fireEvent.click(addButtons()[0]);
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /added/i })).toBeDisabled());
    expect(toasts.success).toHaveBeenCalledWith("Added to drafts");
    // The queue below has to refresh, or the admin adds the same phrase twice.
    expect(onSaved).toHaveBeenCalled();
  });

  it("leaves it addable when the insert failed", async () => {
    const { backend } = await generated({ seed: (b) => b.db.failInserts("set_phrases") });

    await act(async () => {
      fireEvent.click(addButtons()[0]);
    });

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(addButtons()).toHaveLength(2);
    expect(backend.db.rows("set_phrases")).toEqual([]);
  });
});

describe("adding the whole batch", () => {
  const generated = async (options: Options = {}) => {
    const harness = render(options);
    describeSituation(A_SITUATION);
    await generate();
    return harness;
  };

  const addAll = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add all to drafts/i }));
    });
  };

  it("files every phrase that is not already in", async () => {
    const { backend } = await generated();

    await addAll();

    await waitFor(() => expect(draftsWritten(backend)).toHaveLength(2));
    expect(draftsWritten(backend).map((p) => p.phrase_arabic)).toEqual([
      "الله يرحمه",
      "البقية في حياتك",
    ]);
  });

  it("does not file one twice", async () => {
    const { backend } = await generated();
    await act(async () => {
      fireEvent.click(addButtons()[0]);
    });
    await waitFor(() => expect(draftsWritten(backend)).toHaveLength(1));

    await addAll();

    await waitFor(() => expect(draftsWritten(backend)).toHaveLength(2));
  });

  it("counts what it actually managed to add", async () => {
    await generated();

    await addAll();

    // The count is the honest part: unlike the learner-facing twin, this one
    // tracks how many inserts succeeded rather than assuming they all did.
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Added 2 draft phrases for review"),
    );
  });

  it("reports adding none when every insert failed", async () => {
    await generated({ seed: (b) => b.db.failInserts("set_phrases") });

    await addAll();

    // Still a success toast, which reads oddly — but the number is right, and
    // "Added 0" is at least checkable against the queue below.
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Added 0 draft phrases for review"),
    );
    expect(addButtons()).toHaveLength(2);
  });

  it("refreshes the queue below afterwards", async () => {
    const { onSaved } = await generated();

    await addAll();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
