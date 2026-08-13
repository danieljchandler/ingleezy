import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ReviewImageQuizCard } from "@/components/review/ReviewImageQuizCard";
import { VocabularyWord } from "@/hooks/useReview";

// Mock supabase client to avoid env var requirement
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

// Mock DialectContext used by useAzureTTS
vi.mock("@/contexts/DialectContext", () => ({
  useDialect: vi.fn(() => ({ dialect: "Gulf" })),
  DialectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Audio so auto-play doesn't error in jsdom
const mockPlay = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal(
  "Audio",
  vi.fn().mockImplementation(() => ({
    play: mockPlay,
    pause: vi.fn(),
    onended: null,
    onerror: null,
  }))
);

const makeWord = (overrides: Partial<VocabularyWord> = {}): VocabularyWord => ({
  id: "w1",
  word_arabic: "كلب",
  word_english: "dog",
  image_url: "https://example.com/dog.jpg",
  audio_url: "https://example.com/dog.mp3",
  topic_id: "t1",
  image_position: null,
  ...overrides,
});

const topicWords: VocabularyWord[] = [
  makeWord({ id: "w1", word_english: "dog", word_arabic: "كلب", image_url: "https://example.com/dog.jpg" }),
  makeWord({ id: "w2", word_english: "cat", word_arabic: "قطة", image_url: "https://example.com/cat.jpg" }),
  makeWord({ id: "w3", word_english: "bird", word_arabic: "طائر", image_url: "https://example.com/bird.jpg" }),
  makeWord({ id: "w4", word_english: "fish", word_arabic: "سمكة", image_url: "https://example.com/fish.jpg" }),
];

describe("ReviewImageQuizCard", () => {
  let onAnswer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAnswer = vi.fn();
    mockPlay.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders 4 image option buttons plus 1 listen-again button", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    // 1 listen-again + 4 image option buttons = 5
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(5);
  });

  it("auto-plays audio on mount", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    expect(mockPlay).toHaveBeenCalled();
  });

  it("calls onAnswer(true) when correct image is selected", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const dogButton = screen.getByRole("button", { name: /dog/i });
    fireEvent.click(dogButton);
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("calls onAnswer(false) when wrong image is selected", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catButton = screen.getByRole("button", { name: /cat/i });
    fireEvent.click(catButton);
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("shows correct feedback after answering correctly", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const dogButton = screen.getByRole("button", { name: /dog/i });
    fireEvent.click(dogButton);
    expect(screen.getByText(/correct/i)).toBeInTheDocument();
  });

  it("shows Arabic word feedback after wrong answer", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catButton = screen.getByRole("button", { name: /cat/i });
    fireEvent.click(catButton);
    expect(screen.getByText(/the word was: كلب/i)).toBeInTheDocument();
  });

  it("disables image buttons after the first selection", () => {
    render(
      <ReviewImageQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catButton = screen.getByRole("button", { name: /cat/i });
    const dogButton = screen.getByRole("button", { name: /dog/i });
    fireEvent.click(catButton);
    expect(catButton).toBeDisabled();
    expect(dogButton).toBeDisabled();
    fireEvent.click(dogButton);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
