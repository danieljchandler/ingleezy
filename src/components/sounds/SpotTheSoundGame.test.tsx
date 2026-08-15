import { screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { SOUNDS_BY_CODE, type EnglishSound } from "@/data/englishSounds";
import { SpotTheSoundGame } from "./SpotTheSoundGame";

/**
 * "Tap every word with this sound."
 *
 * Unlike the Arabic version this replaces, membership can't be derived from
 * the letters on screen — English spelling doesn't reveal which words carry
 * a given sound — so every word in the grid comes from the sound's own
 * curated `spotWords`, each already tagged `hasSound`.
 */

let cleanup: (() => void) | undefined;

function render(sound: EnglishSound = SOUNDS_BY_CODE.p) {
  const onComplete = vi.fn();
  const harness = renderWithProviders(
    <SpotTheSoundGame sound={sound} onComplete={onComplete} />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onComplete };
}

function afterEachCleanup() {
  cleanup?.();
  cleanup = undefined;
}

describe("SpotTheSoundGame", () => {
  it("shows every word from the sound's curated pool", () => {
    const sound = SOUNDS_BY_CODE.p;
    render(sound);
    for (const w of sound.spotWords) {
      expect(screen.getByText(w.word)).toBeInTheDocument();
    }
    afterEachCleanup();
  });

  it("scores 100 when every tap matches the curated answer", () => {
    const sound = SOUNDS_BY_CODE.p;
    const { onComplete } = render(sound);

    for (const w of sound.spotWords) {
      if (w.hasSound) fireEvent.click(screen.getByText(w.word));
    }
    fireEvent.click(screen.getByRole("button", { name: "تحقّق من الإجابات" }));

    expect(onComplete).toHaveBeenCalledWith(100);
    afterEachCleanup();
  });

  it("scores 0 when every answer is the opposite of the curated one", () => {
    const sound = SOUNDS_BY_CODE.p;
    const { onComplete } = render(sound);

    for (const w of sound.spotWords) {
      if (!w.hasSound) fireEvent.click(screen.getByText(w.word));
    }
    fireEvent.click(screen.getByRole("button", { name: "تحقّق من الإجابات" }));

    expect(onComplete).toHaveBeenCalledWith(0);
    afterEachCleanup();
  });

  it("locks the grid once submitted", () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: "تحقّق من الإجابات" }));

    expect(
      screen.queryByRole("button", { name: "تحقّق من الإجابات" }),
    ).not.toBeInTheDocument();
    afterEachCleanup();
  });

  it("starts over on a new sound", () => {
    const { rerender } = render(SOUNDS_BY_CODE.p);
    fireEvent.click(screen.getByRole("button", { name: "تحقّق من الإجابات" }));
    expect(screen.getByText("%", { exact: false })).toBeInTheDocument();

    rerender(<SpotTheSoundGame sound={SOUNDS_BY_CODE.v} onComplete={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "تحقّق من الإجابات" }),
    ).toBeInTheDocument();
    afterEachCleanup();
  });
});
