import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import WritingPractice from "./WritingPractice";
import { buildDrill } from "@/lib/typingDrills";

/**
 * The written-production page. What matters: the Write tab round-trips through
 * the writing-coach function (prompt on mount, review on submit) and renders
 * the corrections it gets back — and the Typing tab advances through a drill
 * on correct keystrokes and counts the wrong ones, entirely client-side.
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

const prompt = {
  scenario_english: "Your friend is planning the weekend.",
  message_arabic: "وش رايك نروح البر بكرة؟",
  message_transliteration: "wish rayik nrooh al-barr bukra?",
  message_english: "What do you think about going to the desert tomorrow?",
};

const review = {
  understandable: true,
  verdict: "Solid — one small fix.",
  corrected_arabic: "وش رايك نروح السوق",
  corrected_transliteration: "wish rayik nrooh as-souq",
  corrected_english: "What do you think about going to the market?",
  corrections: [
    {
      original: "ماذا",
      corrected: "وش",
      kind: "msa_leak",
      explanation: "ماذا is MSA — Gulf speakers text وش.",
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
    expect(await screen.findByText(prompt.message_arabic)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(
      "writing-coach",
      expect.objectContaining({ body: expect.objectContaining({ action: "prompt", dialect: "Gulf" }) }),
    );
  });

  it("submits the reply for review and renders each correction", async () => {
    mount();
    await screen.findByText(prompt.message_arabic);

    fireEvent.change(screen.getByPlaceholderText("اكتب ردك هنا…"), {
      target: { value: "ماذا رأيك" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Get corrections/ }));

    expect(await screen.findByText("Solid — one small fix.")).toBeInTheDocument();
    expect(screen.getByText(review.corrected_arabic)).toBeInTheDocument();
    expect(screen.getByText(/Gulf speakers text/)).toBeInTheDocument();
    // The review call carries the prompt so the coach knows the context.
    expect(invoke).toHaveBeenLastCalledWith(
      "writing-coach",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "review",
          text: "ماذا رأيك",
          promptArabic: prompt.message_arabic,
        }),
      }),
    );
  });

  it("keeps the button disabled until something is typed", async () => {
    mount();
    await screen.findByText(prompt.message_arabic);
    expect(screen.getByRole("button", { name: /Get corrections/ })).toBeDisabled();
  });
});

describe("WritingPractice — typing tab", () => {
  async function openTypingTab() {
    mount();
    // Radix tabs switch on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Typing/ }));
    await screen.findByTestId("arabic-keyboard");
  }

  it("advances to the next target on a correct keystroke", async () => {
    await openTypingTab();
    const drill = buildDrill(0);
    // First item is the first letter of stage 1 — alif.
    expect(drill[0].target).toBe("ا");
    expect(screen.getByText(/1 \/ \d+/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "key ا" }));
    await waitFor(() => expect(screen.getByText(/2 \/ \d+/)).toBeInTheDocument());
    // Still 100% — no wrong keys yet.
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("counts a wrong key against accuracy without advancing", async () => {
    await openTypingTab();
    // Target is ا; press ب.
    fireEvent.click(screen.getByRole("button", { name: "key ب" }));
    await waitFor(() => expect(screen.getByText(/0%/)).toBeInTheDocument());
    expect(screen.getByText(/1 \/ \d+/)).toBeInTheDocument();
  });
});
