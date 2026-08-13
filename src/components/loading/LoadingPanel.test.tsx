import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoadingPanel } from "./LoadingPanel";

/**
 * The shared wait screen for the app's long AI operations.
 *
 * Transcription, story generation and lesson drafting all take tens of seconds,
 * and a bare spinner over that length reads as "stuck". So this rotates
 * bilingual copy from a per-task deck, and — the part that matters more —
 * stays invisible for the first stretch, because most waits finish quickly and
 * flashing a whole panel at them is worse than showing nothing.
 */

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("@/lib/uiPrefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/uiPrefs")>()),
  useReducedMotion: () => motion.reduced,
}));

const loading = vi.hoisted(() => ({
  message: { ar: "جارٍ التحميل…", en: "Working on it…" },
  index: 0,
  elapsedSeconds: 0,
  asked: [] as Array<{ task?: string; intervalMs?: number; override?: string | null }>,
}));
vi.mock("@/hooks/useLoadingMessage", () => ({
  useLoadingMessage: (options: { task?: string; intervalMs?: number; override?: string | null }) => {
    loading.asked.push(options);
    return {
      message: options.override ? { ar: options.override, en: options.override } : loading.message,
      index: loading.index,
      elapsedSeconds: loading.elapsedSeconds,
    };
  },
}));

vi.mock("./LoadingEmblem", () => ({
  LoadingEmblem: ({ size }: { size?: string }) => <div data-testid="emblem" data-size={size} />,
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  motion.reduced = false;
  loading.message = { ar: "جارٍ التحميل…", en: "Working on it…" };
  loading.index = 0;
  loading.elapsedSeconds = 0;
  loading.asked = [];
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("LoadingPanel — holding off on short waits", () => {
  it("shows nothing at first", () => {
    // Most waits finish inside the delay. Flashing a whole panel at them reads
    // as a stutter.
    const { container } = render(<LoadingPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears once the wait has lasted", () => {
    render(<LoadingPanel />);
    tick(600);
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
  });

  it("takes a caller's own delay", () => {
    render(<LoadingPanel showAfterMs={2000} />);
    tick(1500);
    expect(screen.queryByText("Working on it…")).not.toBeInTheDocument();
    tick(600);
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
  });

  it("shows immediately when the caller knows the wait is long", () => {
    render(<LoadingPanel showAfterMs={0} />);
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
  });
});

describe("LoadingPanel — the copy", () => {
  const shown = () => {
    const view = render(<LoadingPanel showAfterMs={0} />);
    return view;
  };

  it("shows both languages", () => {
    shown();
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
    expect(screen.getByText("جارٍ التحميل…")).toBeInTheDocument();
  });

  it("marks the Arabic as Arabic and right-to-left", () => {
    shown();
    const arabic = screen.getByText("جارٍ التحميل…");
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(arabic).toHaveAttribute("lang", "ar");
  });

  it("hides the Arabic from screen readers", () => {
    // An English voice reads Arabic as noise, and the English line underneath
    // already says the same thing.
    shown();
    expect(screen.getByText("جارٍ التحميل…")).toHaveAttribute("aria-hidden", "true");
  });

  it("announces the wait once, not once per message", () => {
    // A 110-second wait rotates through dozens of messages; aria-live on the
    // copy would fire dozens of announcements.
    shown();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading, please wait");
    expect(status.className).toContain("sr-only");
  });

  it("runs the deck the caller asked for", () => {
    render(<LoadingPanel task="transcribeAnalysis" showAfterMs={0} />);
    expect(loading.asked.at(-1)).toMatchObject({ task: "transcribeAnalysis" });
  });

  it("passes a caller's interval through", () => {
    render(<LoadingPanel intervalMs={2500} showAfterMs={0} />);
    expect(loading.asked.at(-1)).toMatchObject({ intervalMs: 2500 });
  });

  it("lets a real progress label replace the rotating copy", () => {
    // Once there is a genuine stage to report, inventing one is worse.
    render(<LoadingPanel statusOverride="Aligning word timings" showAfterMs={0} />);
    expect(screen.getAllByText("Aligning word timings").length).toBeGreaterThan(0);
  });
});

describe("LoadingPanel — the elapsed counter", () => {
  it("stays hidden early on", () => {
    loading.elapsedSeconds = 2;
    render(<LoadingPanel showAfterMs={0} />);
    expect(screen.queryByText("2s")).not.toBeInTheDocument();
  });

  it("appears once the wait is long enough to worry about", () => {
    loading.elapsedSeconds = 7;
    render(<LoadingPanel showAfterMs={0} />);
    expect(screen.getByText("7s")).toBeInTheDocument();
  });

  it("appears exactly on the threshold", () => {
    loading.elapsedSeconds = 5;
    render(<LoadingPanel showAfterMs={0} />);
    expect(screen.getByText("5s")).toBeInTheDocument();
  });

  it("takes a caller's own threshold", () => {
    loading.elapsedSeconds = 12;
    render(<LoadingPanel showElapsedAfterSeconds={20} showAfterMs={0} />);
    expect(screen.queryByText("12s")).not.toBeInTheDocument();
  });

  it("can be turned off entirely", () => {
    loading.elapsedSeconds = 90;
    render(<LoadingPanel showElapsedAfterSeconds={0} showAfterMs={0} />);
    expect(screen.queryByText("90s")).not.toBeInTheDocument();
  });
});

describe("LoadingPanel — layout and motion", () => {
  it("fills the viewport as a page", () => {
    const { container } = render(<LoadingPanel variant="page" showAfterMs={0} />);
    expect(container.querySelector(".min-h-\\[60vh\\]")).toBeInTheDocument();
  });

  it("sits inside a card when inline", () => {
    const { container } = render(<LoadingPanel showAfterMs={0} />);
    expect(container.querySelector(".min-h-\\[60vh\\]")).toBeNull();
  });

  it("sizes the emblem", () => {
    render(<LoadingPanel size="lg" showAfterMs={0} />);
    expect(screen.getByTestId("emblem")).toHaveAttribute("data-size", "lg");
  });

  it("fades each new message in", () => {
    const { container } = render(<LoadingPanel showAfterMs={0} />);
    expect(container.querySelector(".animate-fade-up")).toBeInTheDocument();
  });

  it("drops the fade for a learner who asked for less motion", () => {
    motion.reduced = true;
    const { container } = render(<LoadingPanel showAfterMs={0} />);
    expect(container.querySelector(".animate-fade-up")).toBeNull();
    expect(screen.getByText("Working on it…")).toBeInTheDocument();
  });

  it("shows whatever the caller put inside it", () => {
    render(
      <LoadingPanel showAfterMs={0}>
        <button>Cancel</button>
      </LoadingPanel>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("hides the caller's children along with the panel", () => {
    // A cancel button floating alone before the panel appears would be odd.
    render(
      <LoadingPanel>
        <button>Cancel</button>
      </LoadingPanel>,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });
});
