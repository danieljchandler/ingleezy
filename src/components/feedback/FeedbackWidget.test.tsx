import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { FeedbackWidget } from "./FeedbackWidget";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { Persona } from "@/test/support/personas";

/**
 * The in-app feedback button, shown only to beta testers.
 *
 * A bug report that says "the review screen was broken" is nearly useless; one
 * that arrives with the route, the dialect, the viewport and the last ten
 * console errors is usually enough to find the fault without a reply. That is
 * what this widget exists to collect — the tester writes a sentence and the
 * context comes along by itself.
 *
 * The screenshot is the part that needed care. It is taken before the sheet
 * opens, and the widget excludes itself from the capture, so what the tester
 * sends is the screen they were complaining about rather than the form they
 * complained in.
 */

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toasts.error(...a), success: (...a: unknown[]) => toasts.success(...a) },
}));

const capture = vi.hoisted(() => ({ toJpeg: vi.fn() }));
vi.mock("html-to-image", () => ({ toJpeg: (...a: unknown[]) => capture.toJpeg(...a) }));

const A_SHOT = "data:image/jpeg;base64,Ly8gc2NyZWVuc2hvdA==";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
  capture.toJpeg.mockReset().mockResolvedValue(A_SHOT);

  // jsdom never loads images and has no canvas, and the widget downscales the
  // capture through both. Neither is what these tests are about.
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      width = 1600;
      height = 900;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    },
  );
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => A_SHOT) as typeof HTMLCanvasElement.prototype.toDataURL;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

interface Options {
  persona?: Persona;
  betaTester?: boolean;
  route?: string;
  /** Make the screenshot bucket reject the upload. */
  failStorage?: boolean;
  seed?: (backend: SupabaseBackend) => void;
}

function render({
  persona = "free",
  betaTester = true,
  route = "/review",
  failStorage = false,
  seed,
}: Options = {}) {
  const harness = renderWithProviders(<FeedbackWidget />, {
    persona,
    route,
    seed: (backend) => {
      backend.stubRpc("is_beta_tester", betaTester);
      seed?.(backend);
    },
  });
  cleanup = harness.cleanup;

  // The widget reads its own screenshot back through fetch() to turn the data
  // URL into a blob. The backend fetch only serves Supabase, so let data URLs
  // through to a blob of their own.
  const supabaseFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.startsWith("data:")) {
        return new Response(new Blob([new Uint8Array(4)], { type: "image/jpeg" }));
      }
      if (failStorage && href.includes("/storage/v1/")) {
        return new Response(JSON.stringify({ message: "bucket full" }), { status: 500 });
      }
      return supabaseFetch(input, init);
    }),
  );

  return harness;
}

const widgetButton = () => screen.queryByRole("button", { name: "أرسل ملاحظة" });

/** Open the sheet the way a tester does — the capture happens on the way in. */
const openSheet = async () => {
  fireEvent.click(screen.getByRole("button", { name: "أرسل ملاحظة" }));
  await screen.findByRole("dialog");
};

/** The row the widget wrote, if it got that far. */
const reportIn = (backend: SupabaseBackend) =>
  backend.db.lastWriteTo("beta_feedback")?.payload[0] as Record<string, unknown> | undefined;

const write = (text: string) =>
  fireEvent.change(screen.getByLabelText("وش صار؟"), { target: { value: text } });

const send = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "أرسل الملاحظة" }));
  });
};

describe("who sees it", () => {
  it("stays away from a signed-out visitor", async () => {
    render({ persona: "anonymous", betaTester: false });

    await waitFor(() => expect(widgetButton()).toBeNull());
  });

  it("stays away from an ordinary learner", async () => {
    render({ betaTester: false });

    // Everyone gets a feedback button and the queue becomes unreadable; the
    // people who agreed to test get one.
    await waitFor(() => expect(widgetButton()).toBeNull());
  });

  it("appears for a beta tester", async () => {
    render();

    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
  });

  it.each(["/auth", "/onboarding", "/admin/videos", "/reset-password"])(
    "keeps out of the way on %s",
    async (route) => {
      render({ route });

      // Signing in and onboarding are where a floating button does the most
      // damage; admin has its own feedback screen.
      await waitFor(() => expect(widgetButton()).toBeNull());
    },
  );
});

describe("opening it", () => {
  it("takes the screenshot before the form covers the screen", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());

    await openSheet();

    // The tester is reporting the page, not the form. Capturing after the sheet
    // opened would send a picture of the sheet.
    expect(capture.toJpeg).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText("معاينة اللقطة")).toBeInTheDocument();
  });

  it("leaves itself out of its own picture", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());

    expect(widgetButton()).toHaveAttribute("data-feedback-ignore", "true");
  });

  it("opens on the keyboard for a tester whose hands are on it", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());

    act(() => {
      fireEvent.keyDown(window, { key: "/", metaKey: true });
    });

    // Reporting a bug the moment it happens is the only way the details get
    // written down accurately.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // No capture on this path: the shortcut is for a tester who is mid-keyboard,
    // and the screen behind the sheet is whatever they were looking at.
    expect(capture.toJpeg).not.toHaveBeenCalled();
  });

  it("says what will be sent along with the words", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    expect(screen.getByText("/review")).toBeInTheDocument();
    expect(screen.getByText(/last console errors/)).toBeInTheDocument();
  });

  it("carries on without a picture when the capture fails", async () => {
    capture.toJpeg.mockRejectedValue(new Error("tainted canvas"));
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());

    await openSheet();

    // A screenshot that will not render must not cost the tester their report.
    expect(toasts.error).toHaveBeenCalledWith("تعذّر التقاط الشاشة.");
    expect(screen.getByText(/ما التقطنا صورة/)).toBeInTheDocument();
  });
});

describe("writing the report", () => {
  it("starts on Bug and lets the tester say otherwise", async () => {
    const { backend } = render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    fireEvent.click(screen.getByRole("button", { name: "فكرة" }));
    write("the review screen could shuffle the deck");
    await send();

    // Most reports are bugs, so that is the default; sorting the rest is what
    // makes the queue readable.
    await waitFor(() => expect(reportIn(backend)).toMatchObject({ type: "idea" }));
  });

  it("will not send a report too short to act on", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    write("hm");

    expect(screen.getByRole("button", { name: "أرسل الملاحظة" })).toBeDisabled();
  });

  it("counts what is left of the limit", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    write("the deck froze");

    expect(screen.getByText("14/4000")).toBeInTheDocument();
  });

  it("stops at the limit rather than losing the overflow silently", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    write("x".repeat(5000));

    expect(screen.getByText("4000/4000")).toBeInTheDocument();
  });
});

describe("the screenshot", () => {
  it("can be dropped and taken again", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    fireEvent.click(screen.getByRole("button", { name: "احذف اللقطة" }));

    // A tester who caught something private on screen needs to be able to take
    // it out without abandoning the report.
    expect(screen.queryByAltText("معاينة اللقطة")).toBeNull();
    expect(screen.getByRole("button", { name: "التقط لقطة" })).toBeInTheDocument();
  });

  it("drops the picture when the tester turns the whole thing off", async () => {
    render();
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.queryByAltText("معاينة اللقطة")).toBeNull();
  });
});

describe("sending it", () => {
  const renderReady = async (options: Options = {}) => {
    const harness = render(options);
    await waitFor(() => expect(widgetButton()).toBeInTheDocument());
    await openSheet();
    return harness;
  };

  it("records what happened, where, and in which dialect", async () => {
    const { backend } = await renderReady();

    write("the review deck froze after the third card");
    await send();

    await waitFor(() => expect(reportIn(backend)).toBeTruthy());
    expect(reportIn(backend)).toMatchObject({
      type: "bug",
      message: "the review deck froze after the third card",
      route: "/review",
    });
    // The context is the difference between a report that can be reproduced and
    // one that needs a conversation.
    const context = reportIn(backend)!.context as Record<string, unknown>;
    expect(context.dialect).toBeTruthy();
    expect(context.viewport).toMatch(/\d+x\d+/);
  });

  it("trims the message before storing it", async () => {
    const { backend } = await renderReady();

    write("   spacing everywhere   ");
    await send();

    await waitFor(() => expect(reportIn(backend)).toBeTruthy());
    expect(reportIn(backend)!.message).toBe("spacing everywhere");
  });

  it("uploads the screenshot and keeps a path to it", async () => {
    const { backend } = await renderReady();

    write("the card overlaps the header here");
    await send();

    await waitFor(() => expect(reportIn(backend)).toBeTruthy());
    // The path rather than the image: the row stays small and the bucket owns
    // the bytes.
    expect(reportIn(backend)!.screenshot_url).toMatch(/\.jpg$/);
    expect(backend.uploads().some((key) => key.endsWith(".jpg"))).toBe(true);
  });

  it("sends the report anyway when the upload fails", async () => {
    const { backend } = await renderReady({ failStorage: true });

    write("the card overlaps the header here");
    await send();

    // Losing a report because its attachment failed would be the worst possible
    // trade — the words are the part that matters.
    await waitFor(() => expect(reportIn(backend)).toBeTruthy());
    expect(reportIn(backend)!.screenshot_url).toBeNull();
    expect(toasts.error).toHaveBeenCalledWith("ما رُفعت الصورة — نرسل بدونها.");
  });

  it("thanks the tester and clears the form", async () => {
    await renderReady();

    write("the review deck froze after the third card");
    await send();

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("شكراً — وصلتنا ملاحظتك!"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the words when the send fails", async () => {
    await renderReady({ seed: (b) => b.db.failInserts("beta_feedback") });

    write("the review deck froze after the third card");
    await send();

    // Retyping a bug report is how a tester stops reporting bugs.
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("ما وصلت الملاحظة. جرّب مرة ثانية."),
    );
    expect(screen.getByLabelText("وش صار؟")).toHaveValue(
      "the review deck froze after the third card",
    );
  });
});
