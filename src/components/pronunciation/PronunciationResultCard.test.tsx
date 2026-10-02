import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { PronunciationResult } from "@/hooks/useAzurePronunciation";
import { PronunciationResultCard } from "./PronunciationResultCard";

/**
 * The result of one take. A bare "73" does not tell a learner what to do, so
 * the card leads with the sound that went worst and how to fix it.
 */

const result = (over: Partial<PronunciationResult> = {}): PronunciationResult => ({
  overall: 64,
  accuracy: 60,
  fluency: 80,
  completeness: 100,
  recognizedText: "bark",
  locale: "en-US",
  words: [
    {
      word: "park",
      accuracy: 55,
      errorType: "Mispronunciation",
      phonemes: [
        { phoneme: "p", accuracy: 30 },
        { phoneme: "ɑ", accuracy: 92 },
        { phoneme: "ɹ", accuracy: 88 },
        { phoneme: "k", accuracy: 95 },
      ],
    },
  ],
  ...over,
});

function renderCard(r = result(), { withTake = true } = {}) {
  const onPlayModel = vi.fn();
  const onPlayTake = withTake ? vi.fn() : undefined;
  render(
    <MemoryRouter>
      <PronunciationResultCard result={r} referenceText="park" onPlayModel={onPlayModel} onPlayTake={onPlayTake} />
    </MemoryRouter>,
  );
  return { onPlayModel, onPlayTake };
}

describe("PronunciationResultCard", () => {
  it("leads with the score and its band", () => {
    renderCard();
    expect(screen.getByText("64")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "مقبول" })).toBeInTheDocument();
  });

  it("names the sound that went worst, the word it was in, and what was heard instead", () => {
    renderCard();
    const card = screen.getByRole("region", { name: "نتيجة النطق" });
    expect(card).toHaveTextContent("انتبه لصوت /p/ في park");
    expect(card).toHaveTextContent("سمعنا bark");
  });

  it("explains the sound from the English Sounds journey and links to its stop", () => {
    renderCard();
    expect(screen.getByText(/park \/ bark/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تدرّب على هذا الصوت" })).toHaveAttribute("href", "/sounds/p");
  });

  it("says nothing extra about a clean take", () => {
    renderCard(
      result({
        overall: 95,
        recognizedText: "park",
        words: [{ word: "park", accuracy: 95, errorType: "None", phonemes: [{ phoneme: "p", accuracy: 94 }] }],
      }),
    );
    expect(screen.queryByText(/انتبه لصوت/)).toBeNull();
    expect(screen.queryByText(/سمعنا/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("labels a word's error in Arabic", () => {
    renderCard();
    expect(screen.getByText("نطق غير صحيح")).toBeInTheDocument();
  });

  it("plays the model and the learner's own take", () => {
    const { onPlayModel, onPlayTake } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /النطق الصحيح/ }));
    fireEvent.click(screen.getByRole("button", { name: /تسجيلك/ }));
    expect(onPlayModel).toHaveBeenCalledOnce();
    expect(onPlayTake).toHaveBeenCalledOnce();
  });

  it("offers no playback of a take it does not have", () => {
    renderCard(result(), { withTake: false });
    expect(screen.queryByRole("button", { name: /تسجيلك/ })).toBeNull();
  });
});
