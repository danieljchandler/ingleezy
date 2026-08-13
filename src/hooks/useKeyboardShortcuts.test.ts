import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewKeyboard } from "./useKeyboardShortcuts";

/**
 * Keyboard shortcuts on the flashcard review screen.
 *
 * A serious review session is hundreds of cards, and reaching for the mouse
 * between each one is what makes people stop doing them. So this is a
 * throughput feature, and its two failure modes are opposite: a shortcut that
 * stops working slows the session down, and one that fires while the learner is
 * typing rates a card they were mid-way through answering — unrecoverable,
 * because the scheduler has already committed.
 *
 * Ratings are only accepted once the answer is showing, which is the whole
 * honesty mechanism of spaced repetition: rate before you have seen it and the
 * number means nothing.
 */

let onFlip: ReturnType<typeof vi.fn>;
let onRate: ReturnType<typeof vi.fn>;

function mount(options: { showAnswer?: boolean; enabled?: boolean } = {}) {
  return renderHook(
    ({ showAnswer, enabled }) => useReviewKeyboard({ showAnswer, onFlip, onRate, enabled }),
    { initialProps: { showAnswer: options.showAnswer ?? false, enabled: options.enabled ?? true } },
  );
}

/** Press a key, optionally from inside a form control. */
function press(key: string, target?: HTMLElement) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (target ?? window).dispatchEvent(event);
  return event;
}

beforeEach(() => {
  onFlip = vi.fn();
  onRate = vi.fn();
  document.body.innerHTML = "";
});

describe("before the answer is shown", () => {
  it("flips on space", () => {
    mount();

    press(" ");

    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it("flips on enter", () => {
    mount();

    press("Enter");

    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it("stops the page scrolling on space", () => {
    mount();

    const event = press(" ");

    // Space is the browser's page-down. Without the preventDefault the card
    // scrolls out of view on every flip.
    expect(event.defaultPrevented).toBe(true);
  });

  it("takes no rating before the answer is visible", () => {
    mount();

    for (const key of ["1", "2", "3", "4", "a", "h", "g", "e"]) press(key);

    // Rating a card you have not seen is the one thing spaced repetition
    // cannot recover from — the interval is computed and stored either way.
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe("once the answer is shown", () => {
  const cases: Array<[string, string]> = [
    ["1", "again"],
    ["a", "again"],
    ["2", "hard"],
    ["h", "hard"],
    ["3", "good"],
    ["g", "good"],
    ["4", "easy"],
    ["e", "easy"],
  ];

  for (const [key, rating] of cases) {
    it(`rates ${rating} on "${key}"`, () => {
      mount({ showAnswer: true });

      press(key);

      // Two bindings per rating: the number row for the position, the letter
      // for the name.
      expect(onRate).toHaveBeenCalledWith(rating);
    });
  }

  it("stops the default action on a rating key", () => {
    mount({ showAnswer: true });

    expect(press("3").defaultPrevented).toBe(true);
  });

  it("does not flip again", () => {
    mount({ showAnswer: true });

    press(" ");
    press("Enter");

    // The card is already face up; flipping would hide the answer the learner
    // is about to rate.
    expect(onFlip).not.toHaveBeenCalled();
  });

  it("ignores a key that means nothing here", () => {
    mount({ showAnswer: true });

    for (const key of ["5", "0", "z", "Escape", "ArrowRight"]) press(key);

    expect(onRate).not.toHaveBeenCalled();
  });

  it("takes the uppercase letter as nothing", () => {
    mount({ showAnswer: true });

    press("A");

    // Pinned. The switch compares the raw `key`, so shift or caps lock turns
    // every letter shortcut off while the number row keeps working. A learner
    // with caps lock on finds half the keyboard dead and no indication why.
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe("while the learner is typing", () => {
  it("ignores keys from a text input", () => {
    mount({ showAnswer: true });
    const input = document.createElement("input");
    document.body.append(input);

    press("3", input);
    press("a", input);

    // The review screen has a note field; rating a card mid-sentence would
    // schedule it on a keystroke meant for the note.
    expect(onRate).not.toHaveBeenCalled();
  });

  it("ignores keys from a textarea", () => {
    mount({ showAnswer: true });
    const textarea = document.createElement("textarea");
    document.body.append(textarea);

    press("3", textarea);

    expect(onRate).not.toHaveBeenCalled();
  });

  it("ignores keys from a select", () => {
    mount({ showAnswer: true });
    const select = document.createElement("select");
    document.body.append(select);

    press("3", select);

    expect(onRate).not.toHaveBeenCalled();
  });

  it("ignores a flip from an input too", () => {
    mount();
    const input = document.createElement("input");
    document.body.append(input);

    press(" ", input);

    // Space in a note field is a space, not a flip.
    expect(onFlip).not.toHaveBeenCalled();
  });

  it("still fires from a contenteditable element", () => {
    mount({ showAnswer: true });
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);

    press("3", editable);

    // Pinned. The guard is a tag-name check, so a rich-text editor built on
    // contenteditable — which is not an input, textarea or select — still lets
    // every rating key through. Nothing on the review screen uses one today,
    // which is exactly why this would go unnoticed if one were added.
    expect(onRate).toHaveBeenCalledWith("good");
  });
});

describe("turning the shortcuts off", () => {
  it("takes no key when disabled", () => {
    mount({ showAnswer: true, enabled: false });

    press(" ");
    press("3");

    // Dialogs and the session-complete screen disable them so their own
    // handling is not fighting the card's.
    expect(onFlip).not.toHaveBeenCalled();
    expect(onRate).not.toHaveBeenCalled();
  });

  it("starts working again when re-enabled", () => {
    const { rerender } = mount({ showAnswer: true, enabled: false });

    rerender({ showAnswer: true, enabled: true });
    press("3");

    expect(onRate).toHaveBeenCalledWith("good");
  });
});

describe("the listener's lifetime", () => {
  it("stops listening once unmounted", () => {
    const { unmount } = mount({ showAnswer: true });

    unmount();
    press("3");

    // Leaving it attached would rate a card on a page that no longer shows
    // one, and leak a listener per visit.
    expect(onRate).not.toHaveBeenCalled();
  });

  it("does not double-fire after a rerender", () => {
    const { rerender } = mount({ showAnswer: true });

    rerender({ showAnswer: true, enabled: true });
    press("3");

    // The effect re-subscribes on every dependency change; a missing cleanup
    // would rate the card twice and skip a card.
    expect(onRate).toHaveBeenCalledTimes(1);
  });

  it("follows the card being flipped", () => {
    const { rerender } = mount({ showAnswer: false });

    press("3");
    expect(onRate).not.toHaveBeenCalled();

    rerender({ showAnswer: true, enabled: true });
    press("3");

    expect(onRate).toHaveBeenCalledWith("good");
  });
});
