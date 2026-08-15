import { screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { SOUNDS_BY_CODE } from "@/data/englishSounds";
import { MinimalPairGame } from "./MinimalPairGame";

/**
 * "Which word did you hear?" — a minimal-pair listening discrimination
 * round. The whole point is that the options are real, confusable words
 * (park/bark, not park/banana), so getting it right has to mean hearing the
 * sound correctly.
 */

vi.mock("./SoundAudioButton", () => ({
  SoundAudioButton: ({ text, label }: { text: string; label?: string }) => (
    <button aria-label={label}>{text}</button>
  ),
}));

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0.9); // stable shuffles/picks across the suite
});

function render(soundCode = "p") {
  const onComplete = vi.fn();
  const sound = SOUNDS_BY_CODE[soundCode];
  const harness = renderWithProviders(
    <MinimalPairGame sound={sound} onComplete={onComplete} />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onComplete, sound };
}

const tiles = () => screen.getAllByRole("button").filter((b) => !b.getAttribute("aria-label"));

describe("posing the question", () => {
  it("says what to do", () => {
    render();
    expect(
      screen.getByText("اضغط على السماعة، ثم اختر الكلمة التي سمعتها"),
    ).toBeInTheDocument();
  });

  it("offers four words drawn from real minimal pairs", () => {
    const { sound } = render();
    const wordSet = new Set(sound.minimalPairs.flatMap((p) => [p.target, p.confuse]));
    for (const tile of tiles()) {
      expect(wordSet.has(tile.textContent ?? "")).toBe(true);
    }
  });

  it("never offers the same word twice", () => {
    render();
    const shown = tiles().map((b) => b.textContent);
    expect(new Set(shown).size).toBe(shown.length);
  });
});

/** The word MinimalPairGame is currently asking about, read off the mocked audio button. */
const spokenWord = () => screen.getByRole("button", { name: "شغّل الكلمة" }).textContent!;

describe("answering", () => {
  it("scores full marks and says so for the right word", () => {
    const { onComplete } = render();
    // The spoken word is always one of the rendered tiles.
    const spoken = spokenWord();
    fireEvent.click(screen.getByRole("button", { name: spoken }));

    expect(screen.getByText(/صحيح!/)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith(100);
  });

  it("names the word it actually was after a wrong answer", () => {
    render();
    const spoken = spokenWord();
    const wrong = tiles().find((t) => t.textContent !== spoken)!;

    fireEvent.click(wrong);

    const answer = screen.getByText(/الكلمة كانت/).textContent ?? "";
    expect(answer).toContain(spoken);
  });

  it("takes no second answer", () => {
    const { onComplete } = render();
    const [first, second] = tiles();
    fireEvent.click(first);
    fireEvent.click(second);

    expect(onComplete).toHaveBeenCalledTimes(1);
    for (const tile of tiles()) expect(tile).toBeDisabled();
  });
});

describe("the next sound", () => {
  it("starts over rather than carrying the last answer across", () => {
    const { rerender } = render("p");
    fireEvent.click(tiles()[0]);
    expect(screen.queryByText(/صحيح!|الكلمة كانت/)).toBeInTheDocument();

    rerender(<MinimalPairGame sound={SOUNDS_BY_CODE.v} onComplete={vi.fn()} />);

    expect(screen.queryByText(/صحيح!|الكلمة كانت/)).not.toBeInTheDocument();
    for (const tile of tiles()) expect(tile).toBeEnabled();
  });
});
