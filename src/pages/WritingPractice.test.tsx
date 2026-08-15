import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import WritingPractice from "./WritingPractice";
import { buildDrill } from "@/lib/typingDrills";

/**
 * The written-production page. What matters: the Write tab round-trips through
 * the writing-coach function (prompt on mount, review on submit) and renders
 * the corrections it gets back — and the Spelling tab advances through a
 * drill on correct spelling and counts the wrong letters, entirely
 * client-side.
 *
 * Post-flip the learner writes ENGLISH: the incoming message is English, the
 * reply is English, and every correction is explained in their dialect. The
 * Spelling tab replaced a leftover Arabic-keyboard drill once the English
 * Sounds rebuild landed — see src/lib/typingDrills.ts.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("@/contexts/DialectContext", () => ({
  useDialect: () => ({ activeDialect: "Gulf" }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/sounds/SoundAudioButton", () => ({
  SoundAudioButton: ({ label }: { label?: string }) => <button aria-label={label} />,
}));

const prompt = {
  scenario_arabic: "صاحبك يرتب لنهاية الأسبوع.",
  message_english: "hey, what do you think about heading to the beach tomorrow?",
  message_arabic: "هلا، وش رايك نروح البحر بكرة؟",
};

const review = {
  understandable: true,
  verdict_arabic: "حلو — بس تصحيح صغير.",
  corrected_english: "I went to the market.",
  corrected_arabic: "رحت السوق.",
  corrections: [
    {
      original: "I go",
      corrected: "I went",
      kind: "verb_tense",
      explanation: "الكلام عن الماضي، فالفعل يصير went.",
    },
  ],
  tips: [],
};

function mount() {
  return render(
    <MemoryRouter>
      <WritingPractice />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  invoke.mockImplementation((_name: string, opts: { body?: { action?: string } }) =>
    Promise.resolve(
      opts?.body?.action === "prompt"
        ? { data: { prompt }, error: null }
        : { data: { review }, error: null },
    ),
  );
});

describe("WritingPractice — write tab", () => {
  it("fetches a prompt on mount and shows the incoming message", async () => {
    mount();
    expect(await screen.findByText(prompt.message_english)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(
      "writing-coach",
      expect.objectContaining({ body: expect.objectContaining({ action: "prompt", dialect: "Gulf" }) }),
    );
  });

  it("submits the reply for review and renders each correction", async () => {
    mount();
    await screen.findByText(prompt.message_english);

    fireEvent.change(screen.getByPlaceholderText("اكتب ردك بالإنجليزي هنا…"), {
      target: { value: "I go to market" },
    });
    fireEvent.click(screen.getByRole("button", { name: /صحّح لي/ }));

    expect(await screen.findByText("حلو — بس تصحيح صغير.")).toBeInTheDocument();
    expect(screen.getByText(review.corrected_english)).toBeInTheDocument();
    expect(screen.getByText(/الفعل يصير went/)).toBeInTheDocument();
    // The review call carries the prompt so the coach knows the context.
    expect(invoke).toHaveBeenLastCalledWith(
      "writing-coach",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "review",
          text: "I go to market",
          promptEnglish: prompt.message_english,
        }),
      }),
    );
  });

  it("keeps the button disabled until something is typed", async () => {
    mount();
    await screen.findByText(prompt.message_english);
    expect(screen.getByRole("button", { name: /صحّح لي/ })).toBeDisabled();
  });
});

describe("WritingPractice — spelling tab", () => {
  async function openSpellingTab() {
    mount();
    // Radix tabs switch on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /التهجئة/ }));
    return screen.findByLabelText("اكتب الكلمة");
  }

  it("advances to the next target on correct spelling", async () => {
    const input = await openSpellingTab();
    const drill = buildDrill(0);
    expect(screen.getByText(/1 \/ \d+/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: drill[0].target } });
    await waitFor(() => expect(screen.getByText(/2 \/ \d+/)).toBeInTheDocument());
    // Still 100% — nothing mis-typed.
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("counts a wrong letter against accuracy without advancing", async () => {
    const input = await openSpellingTab();
    // None of stage 1's example words start with z.
    fireEvent.change(input, { target: { value: "z" } });
    await waitFor(() => expect(screen.getByText(/0%/)).toBeInTheDocument());
    expect(screen.getByText(/1 \/ \d+/)).toBeInTheDocument();
  });
});
