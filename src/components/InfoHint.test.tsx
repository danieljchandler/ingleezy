import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { InfoHint } from "./InfoHint";

/**
 * The small circled (i) beside a feature.
 *
 * The app has a lot of ideas in it — leeches, bridge mode, production reviews —
 * and explaining each one in place would drown the screen. So the explanation
 * hides behind an icon, and a learner who already knows can turn the whole lot
 * off in Settings. The other constraint is placement: these sit inside
 * clickable tiles, so every event has to be stopped from reaching the tile
 * behind them.
 */

const hints = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/hooks/useFeatureHints", () => ({
  useFeatureHints: () => ({ enabled: hints.enabled, setEnabled: vi.fn() }),
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  hints.enabled = true;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  title?: string;
  body?: string;
  cta?: string;
  size?: "sm" | "md";
}

async function render({
  title = "Leeches",
  body = "A word you keep forgetting.",
  cta,
  size,
}: Options = {}) {
  const harness = renderWithProviders(
    <InfoHint title={title} body={body} cta={cta} size={size} />,
  );
  cleanup = harness.cleanup;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return harness;
}

const trigger = () => screen.getByRole("button", { name: "Learn about Leeches" });

describe("InfoHint — whether it appears at all", () => {
  it("offers an explanation", async () => {
    await render();
    expect(trigger()).toBeInTheDocument();
  });

  it("names what it will explain", async () => {
    // "Learn about Leeches" rather than "info": a screen reader lists these out
    // of context, and a page can carry a dozen.
    await render({ title: "Bridge mode" });
    expect(screen.getByRole("button", { name: "Learn about Bridge mode" })).toBeInTheDocument();
  });

  it("disappears entirely when the learner has turned hints off", async () => {
    hints.enabled = false;
    const { container } = await render();
    expect(container).toBeEmptyDOMElement();
  });

  it("sizes itself small by default", async () => {
    await render();
    expect(trigger().className).toContain("h-5 w-5");
  });

  it("takes the larger size when asked", async () => {
    await render({ size: "md" });
    expect(trigger().className).toContain("h-6 w-6");
  });
});

describe("InfoHint — the explanation", () => {
  it("stays closed until asked", async () => {
    await render();
    expect(screen.queryByText("A word you keep forgetting.")).not.toBeInTheDocument();
  });

  it("opens on a tap", async () => {
    await render();
    fireEvent.click(trigger());
    expect(await screen.findByText("A word you keep forgetting.")).toBeInTheDocument();
  });

  it("leads with the feature's name", async () => {
    await render();
    fireEvent.click(trigger());
    expect(await screen.findByText("Leeches")).toBeInTheDocument();
  });

  it("shows a call to action when the caller supplies one", async () => {
    await render({ cta: "Open the leech helper from any review card." });
    fireEvent.click(trigger());
    expect(
      await screen.findByText("Open the leech helper from any review card."),
    ).toBeInTheDocument();
  });

  it("leaves the call to action out when there is none", async () => {
    await render();
    fireEvent.click(trigger());
    await screen.findByText("A word you keep forgetting.");
    expect(screen.queryByText(/Open the leech helper/)).not.toBeInTheDocument();
  });
});

describe("InfoHint — living inside a clickable tile", () => {
  const renderInsideTile = async () => {
    const onTileClick = vi.fn();
    const harness = renderWithProviders(
      <div onClick={onTileClick} data-testid="tile">
        <InfoHint title="Leeches" body="A word you keep forgetting." />
      </div>,
    );
    cleanup = harness.cleanup;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { onTileClick };
  };

  it("does not trigger the tile it sits in", async () => {
    // These are placed beside titles on tiles that navigate. Without the guard,
    // asking what a feature is would open it instead.
    const { onTileClick } = await renderInsideTile();
    fireEvent.click(trigger());
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("stops the pointer press as well as the click", async () => {
    // Several of the surrounding tiles act on pointerdown rather than click.
    const { onTileClick } = await renderInsideTile();
    fireEvent.pointerDown(trigger());
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it("keeps the popover's own clicks off the tile", async () => {
    const { onTileClick } = await renderInsideTile();
    fireEvent.click(trigger());
    const body = await screen.findByText("A word you keep forgetting.");
    fireEvent.click(body);
    expect(onTileClick).not.toHaveBeenCalled();
  });
});

describe("InfoHint — from the keyboard", () => {
  it("is reachable by tabbing", async () => {
    await render();
    trigger().focus();
    expect(trigger()).toHaveFocus();
  });

  it("is a real button rather than a span wearing the role", async () => {
    // A span does not synthesise a click from Enter or Space, and Radix's
    // asChild trigger only composes an onClick — so the control announced
    // itself as a button, took focus, and then did nothing. Every explanation
    // in the app sits behind one of these, which put the whole feature-hint
    // system out of reach of a keyboard or screen reader.
    await render();
    expect(trigger().tagName).toBe("BUTTON");
    expect(trigger()).toHaveAttribute("type", "button");
  });

  // userEvent rather than fireEvent for these two: only userEvent performs the
  // platform's default action, and "Enter on a focused button activates it" is
  // precisely the behaviour a span never had.
  it("opens when a keyboard user presses Enter", async () => {
    await render();
    trigger().focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("A word you keep forgetting.")).toBeInTheDocument();
  });

  it("opens when a keyboard user presses Space", async () => {
    await render();
    trigger().focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByText("A word you keep forgetting.")).toBeInTheDocument();
  });

  it("still keeps those keys off the tile behind it", async () => {
    // The guard half of the handler does work, which is why the gap is easy to
    // miss: the hint feels inert rather than broken.
    const onTileClick = vi.fn();
    const harness = renderWithProviders(
      <div onKeyDown={onTileClick}>
        <InfoHint title="Leeches" body="A word you keep forgetting." />
      </div>,
    );
    cleanup = harness.cleanup;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onTileClick).not.toHaveBeenCalled();
  });
});
