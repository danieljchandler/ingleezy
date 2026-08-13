import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { DialectRitualSwitcher } from "./DialectRitualSwitcher";

/**
 * The dialect switcher, done as a deliberate ritual rather than a dropdown.
 *
 * Choosing a dialect is not a preference in this app — it re-tunes the prompts,
 * the voices and the review queue, and a learner who flips it by accident finds
 * their next session in a language they were not studying. So the switch is a
 * full-screen choice with the three dialects described, and the screen says
 * what changing it does.
 *
 * The chip itself is the other half: it has to be readable at a glance from
 * anywhere in the app, because knowing which dialect you are in is the thing a
 * learner needs most often and asks for least.
 */

const STORAGE_KEY = "ingleezy_dialect_module";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
  document.body.style.overflow = "";
  vi.useRealTimers();
});

function render(dialect = "Gulf") {
  localStorage.setItem(STORAGE_KEY, dialect);
  const harness = renderWithProviders(<DialectRitualSwitcher />);
  cleanup = harness.cleanup;
  return harness;
}

const chip = () => screen.getByRole("button", { name: /active dialect:/i });
const openPicker = () => fireEvent.click(chip());
/** A dialect card inside the overlay — scoped, because the chip behind it
 *  carries the active dialect's name too. */
const card = (english: string) =>
  within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .find((b) => b.textContent?.includes(english))!;

describe("the chip", () => {
  it("says which dialect is live, in both scripts", () => {
    render();

    // A learner who cannot tell which dialect they are in will not trust
    // anything the app tells them about how something is said.
    expect(chip()).toHaveTextContent("Active dialect");
    expect(chip()).toHaveTextContent("Gulf Arabic");
    expect(chip()).toHaveTextContent("خليجي");
  });

  it("follows the dialect the learner last chose", () => {
    render("Egyptian");

    expect(chip()).toHaveTextContent("Egyptian Arabic");
  });

  it("names the current dialect to a screen reader", () => {
    render();

    expect(chip()).toHaveAttribute(
      "aria-label",
      "Active dialect: Gulf Arabic. Tap to change.",
    );
  });

  it("falls back to Gulf for a dialect it does not know", () => {
    render("Levantine");

    // The stored value outlives the list of supported dialects; an unknown one
    // must not blank the chip.
    expect(chip()).toHaveTextContent("Gulf Arabic");
  });
});

describe("opening the picker", () => {
  it("stays out of the way until the chip is pressed", () => {
    render();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers all three dialects with something to choose between them", () => {
    render();

    openPicker();

    // The names alone mean nothing to a beginner. The one-line sketch is what
    // makes this a choice rather than a guess.
    expect(screen.getByRole("dialog", { name: /choose dialect/i })).toBeInTheDocument();
    expect(screen.getByText(/unhurried cadence of the majlis/)).toBeInTheDocument();
    expect(screen.getByText(/lingua franca of Arab cinema/)).toBeInTheDocument();
    expect(screen.getByText(/Mountain Arabic/)).toBeInTheDocument();
  });

  it("says what switching actually does", () => {
    render();

    openPicker();

    // Nobody expects a language toggle to change their review queue.
    expect(
      screen.getByText(/re-tunes prompts, audio voices, and your review queue/),
    ).toBeInTheDocument();
  });

  it("marks the dialect already in use", () => {
    render();
    openPicker();

    expect(card("Gulf Arabic").className).toContain("border-current");
    expect(card("Egyptian Arabic").className).toContain("border-border");
  });

  it("stops the page behind it from scrolling", () => {
    render();

    openPicker();

    // It is a full-screen choice; the page scrolling underneath makes it read
    // as a layer that can be ignored.
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("gives the scroll back when it closes", () => {
    render();
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("closing it without choosing", () => {
  it("closes on the cross", () => {
    render();
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on the backdrop", () => {
    render();
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: /close dialect picker/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", () => {
    render();
    openPicker();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes nothing on the way out", () => {
    render();
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe("Gulf");
  });

  it("just closes when the learner picks the dialect they are already in", () => {
    render();
    openPicker();

    fireEvent.click(card("Gulf Arabic"));

    // No wash, no flip, no re-tuning: choosing what you already have is a
    // decision to leave things alone.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("Gulf");
  });
});

describe("switching", () => {
  it("changes the dialect the moment it is chosen", () => {
    vi.useFakeTimers();
    render();
    openPicker();

    fireEvent.click(card("Egyptian Arabic"));

    // The switch is not held back for the animation — the rest of the app is
    // already re-keying its queries.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("Egyptian");
  });

  it("holds the overlay open for the transition, then closes it", () => {
    vi.useFakeTimers();
    render();
    openPicker();

    fireEvent.click(card("Egyptian Arabic"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(260);
    });

    // Long enough to read as a deliberate change of mode rather than a
    // flicker, short enough not to be in the way.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses a second choice while the first is landing", () => {
    vi.useFakeTimers();
    render();
    openPicker();

    fireEvent.click(card("Egyptian Arabic"));
    for (const dialect of ["Gulf Arabic", "Egyptian Arabic", "Yemeni Arabic"]) {
      expect(card(dialect)).toBeDisabled();
    }
    fireEvent.click(card("Yemeni Arabic"));

    // Two dialect changes in flight at once would leave the queries keyed to
    // one and the chip showing the other.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("Egyptian");
  });

  it("cannot be dismissed while it is landing", () => {
    vi.useFakeTimers();
    render();
    openPicker();
    fireEvent.click(card("Egyptian Arabic"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("leaves the chip showing the new dialect", () => {
    vi.useFakeTimers();
    render();
    openPicker();

    fireEvent.click(card("Yemeni Arabic"));
    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(chip()).toHaveTextContent("Yemeni Arabic");
    expect(chip()).toHaveTextContent("يمني");
  });

  it("does not close the overlay after the switcher has gone", () => {
    vi.useFakeTimers();
    const { unmount } = render();
    openPicker();
    fireEvent.click(card("Egyptian Arabic"));

    unmount();
    act(() => {
      vi.advanceTimersByTime(260);
    });

    // The timer outlives the component by a quarter of a second, which is
    // exactly long enough for a learner to navigate away mid-switch.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
