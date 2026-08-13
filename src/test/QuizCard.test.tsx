import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { QuizCard } from "@/components/learn/QuizCard";

// Mock supabase to prevent real auth network calls
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

// Shared play mock so we can assert on it in tests
const mockPlay = vi.fn().mockResolvedValue(undefined);

// Mock Audio globally – must be done before tests run
vi.stubGlobal(
  "Audio",
  vi.fn().mockImplementation(() => ({
    play: mockPlay,
    pause: vi.fn(),
    onended: null,
    onerror: null,
  }))
);

vi.stubGlobal("URL", {
  createObjectURL: vi.fn().mockReturnValue("blob:mock-generated-url"),
  revokeObjectURL: vi.fn(),
});

const makeWord = (overrides: Record<string, unknown> = {}) => ({
  id: "w1",
  word_arabic: "كلب",
  word_english: "dog",
  image_url: null as string | null,
  audio_url: null as string | null,
  ...overrides,
});

const otherWords = [
  { id: "w2", word_arabic: "قطة", word_english: "cat", image_url: null, audio_url: null },
  { id: "w3", word_arabic: "طائر", word_english: "bird", image_url: null, audio_url: null },
  { id: "w4", word_arabic: "سمكة", word_english: "fish", image_url: null, audio_url: null },
];

describe("QuizCard audio", () => {
  beforeEach(() => {
    mockPlay.mockClear();
    vi.mocked(Audio).mockClear();
    vi.mocked(URL.createObjectURL).mockClear();
  });

  // Use clearAllMocks (not restoreAllMocks) so stub implementations are preserved
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders the audio button", async () => {
    // Use a settled (rejected) fetch, not a never-resolving promise: this word
    // routes through the module-level munsit serial queue, and a hung request
    // would leave that queue pending and starve every later test's TTS call.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    render(<QuizCard word={makeWord()} otherWords={otherWords} onAnswer={vi.fn()} />);
    expect(screen.getByRole("button", { name: /play pronunciation/i })).toBeInTheDocument();

    // The rejected TTS fetch flips the hook out of loading a tick later; let it
    // land inside the test.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("auto-plays stored audio_url after 300 ms", async () => {
    vi.useFakeTimers();

    render(
      <QuizCard
        word={makeWord({ audio_url: "https://example.com/dog.mp3" })}
        otherWords={otherWords}
        onAnswer={vi.fn()}
      />
    );

    // Audio should NOT have played yet (timer hasn't fired)
    expect(mockPlay).not.toHaveBeenCalled();

    // Advance past the 300 ms auto-play delay
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(vi.mocked(Audio)).toHaveBeenCalledWith("https://example.com/dog.mp3");
    expect(mockPlay).toHaveBeenCalled();
  });

  it("plays stored audio_url when the audio button is clicked", () => {
    render(
      <QuizCard
        word={makeWord({ audio_url: "https://example.com/dog.mp3" })}
        otherWords={otherWords}
        onAnswer={vi.fn()}
      />
    );

    const btn = screen.getByRole("button", { name: /play pronunciation/i });
    fireEvent.click(btn);

    expect(vi.mocked(Audio)).toHaveBeenCalledWith("https://example.com/dog.mp3");
    expect(mockPlay).toHaveBeenCalled();
  });

  it("generates TTS and auto-plays when word has no audio_url", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "audio/mpeg" },
        blob: () => Promise.resolve(audioBlob),
      })
    );

    render(<QuizCard word={makeWord()} otherWords={otherWords} onAnswer={vi.fn()} />);

    // Wait for TTS generation and subsequent auto-play
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(vi.mocked(fetch as typeof global.fetch)).toHaveBeenCalledWith(
      expect.stringMatching(/munsit-tts|azure-tts/),
      expect.objectContaining({ method: "POST" })
    );
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalled();
    expect(vi.mocked(Audio)).toHaveBeenCalledWith("blob:mock-generated-url");
    expect(mockPlay).toHaveBeenCalled();
  });

  it("disables the audio button when TTS generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    render(<QuizCard word={makeWord()} otherWords={otherWords} onAnswer={vi.fn()} />);

    // Wait for generation to fail and state to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const btn = screen.getByRole("button", { name: /play pronunciation/i });
    expect(btn).toBeDisabled();
  });

  it("renders 4 multiple-choice answer options", () => {
    render(
      <QuizCard
        word={makeWord({ audio_url: "https://example.com/dog.mp3" })}
        otherWords={otherWords}
        onAnswer={vi.fn()}
      />
    );
    // The correct answer and 3 distractors should all be visible
    expect(screen.getByText("dog")).toBeInTheDocument();
    expect(screen.getByText("cat")).toBeInTheDocument();
    expect(screen.getByText("bird")).toBeInTheDocument();
    expect(screen.getByText("fish")).toBeInTheDocument();
  });

  it("calls onAnswer(true) after the correct option is selected", async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();

    render(
      <QuizCard
        word={makeWord({ audio_url: "https://example.com/dog.mp3" })}
        otherWords={otherWords}
        onAnswer={onAnswer}
      />
    );

    fireEvent.click(screen.getByText("dog"));

    // onAnswer is called after the 1500 ms result-display delay
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("waits for Continue after a wrong answer, then calls onAnswer(false)", async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();

    render(
      <QuizCard
        word={makeWord({ audio_url: "https://example.com/dog.mp3" })}
        otherWords={otherWords}
        onAnswer={onAnswer}
      />
    );

    fireEvent.click(screen.getByText("cat"));

    // Wrong answers no longer auto-advance — the learner must read the
    // correction and tap Continue.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Continue"));

    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("does not call onAnswer a second time when a second option is clicked", async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();

    render(
      <QuizCard
        word={makeWord({ audio_url: "https://example.com/dog.mp3" })}
        otherWords={otherWords}
        onAnswer={onAnswer}
      />
    );

    fireEvent.click(screen.getByText("dog"));
    fireEvent.click(screen.getByText("cat")); // should be a no-op

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
