import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { LOADING_DECKS } from "@/data/loadingMessages";

/** Force the reduced-motion query on or off for one test. */
function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

afterEach(() => setReducedMotion(false));

describe("LoadingPanel", () => {
  it("shows both lines of the first message", () => {
    const { container } = render(
      <LoadingPanel task="passage" showAfterMs={0} />,
    );
    const first = LOADING_DECKS.passage[0];
    expect(screen.getByText(first.en)).toBeInTheDocument();

    const arabic = screen.getByText(first.ar);
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(arabic).toHaveAttribute("lang", "ar");
    // Announced in English only — see the comment in LoadingPanel.
    expect(arabic).toHaveAttribute("aria-hidden", "true");
    expect(container).toBeTruthy();
  });

  it("announces once, statically, rather than on every rotation", () => {
    render(<LoadingPanel task="passage" showAfterMs={0} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading, please wait");
    expect(status).not.toHaveAttribute("aria-live", "assertive");
  });

  it("plays the emblem, muted and looping, hidden from assistive tech", () => {
    const { container } = render(
      <LoadingPanel task="passage" showAfterMs={0} />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute("playsinline");
    // H.264 first so mainstream browsers never fetch the VP9 sibling.
    const srcs = Array.from(container.querySelectorAll("video source")).map((el) =>
      el.getAttribute("src"),
    );
    expect(srcs[0]).toMatch(/\.mp4$/);
    expect(srcs[1]).toMatch(/\.webm$/);
    expect(video.closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("clips the emblem to a circle", () => {
    // clip-path, not border-radius: Safari won't clip a <video> with the latter.
    const { container } = render(
      <LoadingPanel task="passage" showAfterMs={0} />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.clipPath).toContain("circle");
    // The wrapper has to stay square or the circle turns into an ellipse.
    expect(video.parentElement!.className).toContain("aspect-square");
  });

  it("holds a still frame when the user prefers reduced motion", () => {
    setReducedMotion(true);
    const { container } = render(
      <LoadingPanel task="passage" showAfterMs={0} />,
    );
    expect(container.querySelector("video")).toBeNull();
    const still = container.querySelector("img")! as HTMLElement;
    expect(still).toBeTruthy();
    // The still is clipped to the same circle as the video.
    expect(still.style.clipPath).toContain("circle");
    // The copy still rotates — changing text isn't motion.
    expect(screen.getByText(LOADING_DECKS.passage[0].en)).toBeInTheDocument();
  });

  it("falls back to the still frame when the video cannot play", () => {
    // Headless Chromium has no H.264, and iOS Low Power Mode blocks autoplay.
    const { container } = render(
      <LoadingPanel task="passage" showAfterMs={0} />,
    );
    // The browser walks the <source> list and errors on the last candidate when
    // nothing playable is left, so that's where the handler lives.
    const sources = container.querySelectorAll("video source");
    expect(sources.length).toBeGreaterThan(1);
    act(() => {
      sources[sources.length - 1].dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.getByText(LOADING_DECKS.passage[0].en)).toBeInTheDocument();
  });

  it("stays out of the way until a wait proves slow", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <LoadingPanel task="passage" showAfterMs={600} />,
      );
      expect(container).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders call-site extras like the cancel button", () => {
    render(
      <LoadingPanel task="passage" showAfterMs={0}>
        <button>Cancel</button>
      </LoadingPanel>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows a real progress label verbatim", () => {
    render(
      <LoadingPanel
        showAfterMs={0}
        statusOverride="Generating images (3 of 12)…"
      />,
    );
    expect(
      screen.getByText("Generating images (3 of 12)…"),
    ).toBeInTheDocument();
    expect(screen.getByText("الرسام يرسم")).toBeInTheDocument();
  });
});
