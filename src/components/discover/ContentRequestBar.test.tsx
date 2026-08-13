import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { TEST_USER_ID } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { ContentRequestBar } from "./ContentRequestBar";

/**
 * "Show me something about X" — the request box under the Discover feed.
 *
 * The feed is curated by hand, so the thing that keeps it worth curating is
 * knowing what learners actually want. This is the only place they can say so,
 * which is why it asks for the *kind* of request as well as the text: a link,
 * a creator to follow, and a topic to go looking for are three different jobs
 * for whoever works the queue.
 *
 * It stays collapsed until asked for, because a permanent form under an
 * infinite feed is something a learner scrolls past rather than uses.
 */

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

function render({
  persona = "free",
  seed,
}: { persona?: "free" | "anonymous"; seed?: (backend: SupabaseBackend) => void } = {}) {
  const harness = renderWithProviders(<ContentRequestBar />, { persona, seed });
  cleanup = harness.cleanup;
  return harness;
}

/** `useAuth` resolves the session on a macrotask; submitting before it lands is refused. */
const settleAuth = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const openBar = async () => {
  await settleAuth();
  fireEvent.click(screen.getByRole("button", { name: /Request content/ }));
};

const field = () => screen.getByRole("textbox");
const sendButton = () => screen.getAllByRole("button").at(-2)!;

const submit = async (text: string) => {
  fireEvent.change(field(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(sendButton());
  });
};

const requests = (backend: SupabaseBackend) =>
  backend.db.writesTo("content_requests").flatMap((w) => w.payload);

describe("getting to the form", () => {
  it("is a single line until it is asked for", async () => {
    render();
    await settleAuth();

    // Under an endless feed, a permanent form is scenery. One line that says
    // what it is for is something a learner notices when they want it.
    expect(
      screen.getByRole("button", { name: /suggest a video, creator, or topic/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("opens into the form", async () => {
    render();

    await openBar();

    expect(screen.getByText("What do you want to see?")).toBeInTheDocument();
    expect(field()).toBeInTheDocument();
  });

  it("closes again and forgets what was typed", async () => {
    render();
    await openBar();
    fireEvent.change(field(), { target: { value: "half a thought" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Reopening to find an abandoned draft still there is worse than starting
    // clean — the learner has to notice and clear it.
    expect(screen.queryByRole("textbox")).toBeNull();
    await openBar();
    expect(field()).toHaveValue("");
  });
});

describe("saying what kind of request it is", () => {
  it("offers the three kinds, starting on a video", async () => {
    render();

    await openBar();

    // Video is the common case; the other two are for when the learner does not
    // have a link.
    expect(screen.getByRole("button", { name: /Video \/ Link/ }).className).toContain(
      "bg-primary",
    );
    expect(screen.getByRole("button", { name: /Creator/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Topic/ })).toBeInTheDocument();
  });

  it("changes what it asks for with the kind", async () => {
    render();
    await openBar();
    expect(field()).toHaveAttribute("placeholder", "Paste a link or describe a video you'd like…");

    fireEvent.click(screen.getByRole("button", { name: /Creator/ }));
    expect(field()).toHaveAttribute("placeholder", "Name an Arabic creator or influencer…");

    // The prompt is the only instruction there is; a generic one would produce
    // three kinds of answer in one box.
    fireEvent.click(screen.getByRole("button", { name: /Topic/ }));
    expect(field()).toHaveAttribute("placeholder", "What topic do you want to learn about?");
  });

  it("shows which kind is selected", async () => {
    render();
    await openBar();

    fireEvent.click(screen.getByRole("button", { name: /Topic/ }));

    expect(screen.getByRole("button", { name: /Topic/ }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: /Video \/ Link/ }).className).not.toContain(
      "bg-primary",
    );
  });

  it("keeps what was typed when the kind changes", async () => {
    render();
    await openBar();
    fireEvent.change(field(), { target: { value: "something about cooking" } });

    fireEvent.click(screen.getByRole("button", { name: /Topic/ }));

    // Realising halfway through that this is a topic rather than a video should
    // not cost the sentence already written.
    expect(field()).toHaveValue("something about cooking");
  });
});

describe("sending it", () => {
  it("records the request with the kind it was filed under", async () => {
    const { backend } = render();
    await openBar();
    fireEvent.click(screen.getByRole("button", { name: /Creator/ }));

    await submit("  أحمد الشقيري  ");

    // Trimmed, because a request that is all whitespace either side sorts badly
    // in the queue and reads as a mistake.
    await waitFor(() => expect(requests(backend)).toHaveLength(1));
    expect(requests(backend)[0]).toMatchObject({
      user_id: TEST_USER_ID,
      request_type: "creator",
      body: "أحمد الشقيري",
    });
  });

  it("can be sent with the Enter key", async () => {
    const { backend } = render();
    await openBar();
    fireEvent.change(field(), { target: { value: "a cooking channel" } });

    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" });
    });

    // It is one line in one field; reaching for the button is the slower path.
    await waitFor(() => expect(requests(backend)).toHaveLength(1));
  });

  it("thanks the learner and clears itself", async () => {
    render();
    await openBar();

    await submit("a cooking channel");

    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Request submitted! We'll look into it 🙏"),
    );
    // Collapsed again: the request is sent, and leaving the form open invites a
    // duplicate.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("will not send an empty request", async () => {
    const { backend } = render();
    await openBar();

    expect(sendButton()).toBeDisabled();
    fireEvent.change(field(), { target: { value: "   " } });
    expect(sendButton()).toBeDisabled();
    expect(requests(backend)).toHaveLength(0);
  });

  it("does nothing when Enter is pressed on an empty field", async () => {
    const { backend } = render();
    await openBar();

    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" });
    });

    expect(requests(backend)).toHaveLength(0);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("holds the learner to a request that can be read", async () => {
    render();
    await openBar();

    // The field caps input at 500 characters, so the guard only fires on text
    // that arrived some other way — a paste, or an autofill.
    fireEvent.change(field(), { target: { value: "x".repeat(501) } });
    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(toasts.error).toHaveBeenCalledWith("Request is too long (max 500 characters)");
  });

  it("stops a long request at the keyboard too", async () => {
    render();
    await openBar();

    expect(field()).toHaveAttribute("maxlength", "500");
  });

  it("says so when the request could not be filed", async () => {
    render({ seed: (b) => b.db.failInserts("content_requests") });
    await openBar();

    await submit("a cooking channel");

    // Silence would leave the learner believing it was sent.
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Failed to submit request"));
  });

  it("keeps the form open after a failure so it can be retried", async () => {
    render({ seed: (b) => b.db.failInserts("content_requests") });
    await openBar();

    await submit("a cooking channel");

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(field()).toHaveValue("a cooking channel");
  });
});

describe("when nobody is signed in", () => {
  it("says why it will not send", async () => {
    render({ persona: "anonymous" });
    await openBar();

    await submit("a cooking channel");

    // Discover is browsable signed out, so this is reachable and the refusal
    // has to name its reason rather than fail silently.
    expect(toasts.error).toHaveBeenCalledWith("Please log in to request content");
  });

  it("keeps what was typed so signing in does not cost it", async () => {
    const { backend } = render({ persona: "anonymous" });
    await openBar();

    await submit("a cooking channel");

    expect(field()).toHaveValue("a cooking channel");
    expect(requests(backend)).toHaveLength(0);
  });
});
