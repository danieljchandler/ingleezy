import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ReviewQuizCard } from "@/components/review/ReviewQuizCard";
import { VocabularyWord } from "@/hooks/useReview";

const makeWord = (overrides: Partial<VocabularyWord> = {}): VocabularyWord => ({
  id: "w1",
  word_arabic: "كلب",
  word_english: "dog",
  image_url: null,
  audio_url: null,
  topic_id: "t1",
  image_position: null,
  ...overrides,
});

const topicWords: VocabularyWord[] = [
  makeWord({ id: "w1", word_arabic: "كلب", word_english: "dog" }),
  makeWord({ id: "w2", word_arabic: "قطة", word_english: "cat" }),
  makeWord({ id: "w3", word_arabic: "طائر", word_english: "bird" }),
  makeWord({ id: "w4", word_arabic: "سمكة", word_english: "fish" }),
];

describe("ReviewQuizCard", () => {
  let onAnswer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAnswer = vi.fn();
  });

  it("renders 4 play buttons (one per option)", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const playButtons = screen.getAllByRole("button", { name: /play/i });
    expect(playButtons).toHaveLength(4);
  });

  it("renders all 4 Arabic word options", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    expect(screen.getByText("كلب")).toBeInTheDocument();
    expect(screen.getByText("قطة")).toBeInTheDocument();
    expect(screen.getByText("طائر")).toBeInTheDocument();
    expect(screen.getByText("سمكة")).toBeInTheDocument();
  });

  it("calls onAnswer(true) when correct Arabic option is selected", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const dogOption = screen.getByText("كلب").closest("[role='button']") as HTMLElement;
    fireEvent.click(dogOption);
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("calls onAnswer(false) when wrong Arabic option is selected", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catOption = screen.getByText("قطة").closest("[role='button']") as HTMLElement;
    fireEvent.click(catOption);
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("shows result feedback after answering", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const dogOption = screen.getByText("كلب").closest("[role='button']") as HTMLElement;
    fireEvent.click(dogOption);
    expect(screen.getByText(/correct/i)).toBeInTheDocument();
  });

  it("shows correct Arabic answer on wrong selection", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catOption = screen.getByText("قطة").closest("[role='button']") as HTMLElement;
    fireEvent.click(catOption);
    expect(screen.getByText(/the answer was: كلب/i)).toBeInTheDocument();
  });

  it("does not call onAnswer again after the first selection (disabled)", () => {
    render(
      <ReviewQuizCard word={topicWords[0]} topicWords={topicWords} onAnswer={onAnswer} />
    );
    const catOption = screen.getByText("قطة").closest("[role='button']") as HTMLElement;
    const dogOption = screen.getByText("كلب").closest("[role='button']") as HTMLElement;
    fireEvent.click(catOption);
    // Options should be marked aria-disabled after the first answer
    expect(catOption).toHaveAttribute("aria-disabled", "true");
    expect(dogOption).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(dogOption); // should be a no-op
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
