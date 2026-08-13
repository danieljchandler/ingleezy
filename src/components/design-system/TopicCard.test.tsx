import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopicCard, type TopicCardTopic } from "./TopicCard";

/**
 * The tile a learner picks a topic from.
 *
 * Arabic leads and English follows, because the point of the grid is to start
 * recognising the word rather than to translate it. The gradient stripe is the
 * only per-topic colour, and it has to survive three generations of data: the
 * brand classes used now, the Tailwind gradients the seed data still carries,
 * and topics created since with neither.
 */

const aTopic = (over: Partial<TopicCardTopic> = {}): TopicCardTopic => ({
  id: "t1",
  name: "Food",
  nameArabic: "طعام",
  gradient: "bg-gradient-green",
  ...over,
});

const stripe = (container: HTMLElement) => container.querySelector(".absolute.top-0")!;

describe("TopicCard — what it shows", () => {
  it("leads with the Arabic", () => {
    render(<TopicCard topic={aTopic()} onClick={vi.fn()} />);
    expect(screen.getByText("طعام")).toBeInTheDocument();
  });

  it("follows with the English", () => {
    render(<TopicCard topic={aTopic()} onClick={vi.fn()} />);
    expect(screen.getByText("Food")).toBeInTheDocument();
  });

  it("names both for a screen reader", () => {
    render(<TopicCard topic={aTopic()} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Food — طعام" })).toBeInTheDocument();
  });

  it("opens the topic when tapped", () => {
    const onClick = vi.fn();
    render(<TopicCard topic={aTopic()} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows how many words the topic holds", () => {
    render(<TopicCard topic={aTopic({ wordCount: 24 })} onClick={vi.fn()} />);
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("shows a genuine zero rather than hiding it", () => {
    // An empty topic is worth seeing — it is usually one an admin has half
    // built.
    render(<TopicCard topic={aTopic({ wordCount: 0 })} onClick={vi.fn()} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("leaves the badge off when the count is unknown", () => {
    render(<TopicCard topic={aTopic()} onClick={vi.fn()} />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("TopicCard — choosing the stripe colour", () => {
  it("passes a brand gradient straight through", () => {
    const { container } = render(
      <TopicCard topic={aTopic({ gradient: "bg-gradient-olive" })} onClick={vi.fn()} />,
    );
    expect(stripe(container).className).toContain("bg-gradient-olive");
  });

  it("maps a legacy Tailwind gradient onto the brand palette", () => {
    // The seed data predates the brand classes and still says "from-yellow-400
    // to-orange-500"; rendering that literally would put a non-brand colour on
    // the grid.
    const { container } = render(
      <TopicCard topic={aTopic({ gradient: "from-yellow-400 to-orange-500" })} onClick={vi.fn()} />,
    );
    expect(stripe(container).className).toContain("bg-gradient-sand");
  });

  it.each([
    ["from-green-400 to-emerald-600", "bg-gradient-green"],
    ["from-blue-400 to-cyan-500", "bg-gradient-indigo"],
    ["from-gray-500 to-gray-700", "bg-gradient-charcoal"],
    ["from-rose-500 to-rose-700", "bg-gradient-red"],
  ])("maps %s to %s", (legacy, brand) => {
    const { container } = render(
      <TopicCard topic={aTopic({ gradient: legacy })} onClick={vi.fn()} />,
    );
    expect(stripe(container).className).toContain(brand);
  });

  it("falls back to a colour derived from the name", () => {
    // A topic created since the mapping was written has a gradient in neither
    // list; hashing the name keeps it stable rather than random per render.
    const { container } = render(
      <TopicCard topic={aTopic({ name: "Weather", gradient: "from-fuchsia-300 to-lime-900" })} onClick={vi.fn()} />,
    );
    expect(stripe(container).className).toMatch(/bg-gradient-(green|sand|olive|indigo|red|charcoal)/);
  });

  it("gives the same topic the same colour every time", () => {
    const unknown = { gradient: "from-fuchsia-300 to-lime-900", name: "Weather" };
    const first = render(<TopicCard topic={aTopic(unknown)} onClick={vi.fn()} />);
    const firstClass = stripe(first.container).className;
    first.unmount();

    const second = render(<TopicCard topic={aTopic(unknown)} onClick={vi.fn()} />);
    expect(stripe(second.container).className).toBe(firstClass);
  });

  it("gives two different topics a chance at different colours", () => {
    const render1 = render(
      <TopicCard topic={aTopic({ name: "A", gradient: "unknown" })} onClick={vi.fn()} />,
    );
    const a = stripe(render1.container).className;
    render1.unmount();

    const render2 = render(
      <TopicCard topic={aTopic({ name: "B", gradient: "unknown" })} onClick={vi.fn()} />,
    );
    expect(stripe(render2.container).className).not.toBe(a);
  });
});
