import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { showCapToast, showCapToastIfLimited } from "./handleCapResponse";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

/**
 * The client half of the daily usage cap.
 *
 * The server side is asserted in supabase/functions/_test/usageCap_test.ts;
 * this is what the learner actually sees when they hit it. The two have to
 * agree on the response shape, and they are in different languages with no
 * shared type, so the field names here are a contract held together by nothing
 * but these tests.
 *
 * Getting it wrong is quiet in the worst way: an unrecognised 429 means the
 * caller carries on as though the request succeeded, and the feature appears to
 * do nothing at all.
 */

const capBody = (over: Record<string, unknown> = {}) => ({
  error: "daily_limit_reached",
  message: "You've reached the free daily limit for this feature (20/day). Upgrade for unlimited access.",
  key: "grammar-drill",
  count: 21,
  limit: 20,
  upgrade_url: "/pricing",
  ...over,
});

/** supabase-js surfaces a non-2xx as an error carrying the raw Response. */
const functionsHttpError = (status: number, body: unknown) => ({
  name: "FunctionsHttpError",
  context: new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }),
});

const toastError = vi.mocked(toast.error);

beforeEach(() => toastError.mockClear());
afterEach(() => vi.restoreAllMocks());

describe("recognising a cap hit", () => {
  it("recognises the 429 supabase-js wraps in an error", async () => {
    const handled = showCapToastIfLimited(functionsHttpError(429, capBody()), null);

    expect(handled).toBe(true);
    // The body is read asynchronously off the cloned Response.
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it("recognises a cap body returned as data", async () => {
    // Some call sites get the body through rather than as an error.
    const handled = showCapToastIfLimited(null, capBody());

    expect(handled).toBe(true);
    expect(toastError).toHaveBeenCalled();
  });

  it("ignores a successful response", () => {
    expect(showCapToastIfLimited(null, { questions: [] })).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ignores an unrelated error", () => {
    // A 500 is a different problem and gets the caller's own handling.
    expect(showCapToastIfLimited(functionsHttpError(500, { error: "boom" }), null)).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("ignores a 401, which is the anonymous case and not a cap", () => {
    expect(
      showCapToastIfLimited(functionsHttpError(401, { error: "auth_required" }), null),
    ).toBe(false);
  });

  it("ignores a body whose error is something else", () => {
    expect(showCapToastIfLimited(null, { error: "auth_required" })).toBe(false);
  });

  it("survives null, undefined and non-objects", () => {
    expect(showCapToastIfLimited(null, null)).toBe(false);
    expect(showCapToastIfLimited(undefined, undefined)).toBe(false);
    expect(showCapToastIfLimited("boom", "boom")).toBe(false);
    expect(showCapToastIfLimited(null, 42)).toBe(false);
  });

  it("still reports the cap when the 429 body is unreadable", async () => {
    // A truncated or non-JSON body must not turn a handled cap into a silent
    // no-op — the status alone is enough to know what happened.
    const error = {
      name: "FunctionsHttpError",
      context: new Response("<html>gateway</html>", { status: 429 }),
    };

    expect(showCapToastIfLimited(error, null)).toBe(true);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][1]).toMatchObject({
      description: expect.stringMatching(/daily free limit/i),
    });
  });
});

describe("the toast", () => {
  it("uses the server's message when there is one", () => {
    showCapToast(capBody({ message: "You've used today's 20 free drills." }));

    expect(toastError).toHaveBeenCalledWith(
      "Daily free limit reached",
      expect.objectContaining({ description: "You've used today's 20 free drills." }),
    );
  });

  it("names the limit when the server sent no message", () => {
    showCapToast({ limit: 5 });

    expect(toastError.mock.calls[0][1]).toMatchObject({
      description: expect.stringContaining("5"),
    });
  });

  it("still says something useful with neither message nor limit", () => {
    showCapToast({});

    expect(toastError.mock.calls[0][1]).toMatchObject({
      description: expect.stringMatching(/upgrade/i),
    });
  });

  it("offers an Upgrade action", () => {
    // Without it the learner is told they are capped and given nowhere to go.
    showCapToast(capBody());

    expect(toastError.mock.calls[0][1]).toMatchObject({
      action: expect.objectContaining({ label: "Upgrade" }),
    });
  });

  it("sends the Upgrade action to the pricing page", () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });

    showCapToast(capBody());
    // sonner hands the action an event; the handler here ignores it, but the
    // signature has to match or this does not typecheck.
    const options = toastError.mock.calls[0][1] as {
      action: { onClick: (event: React.MouseEvent<HTMLButtonElement>) => void };
    };
    options.action.onClick({} as React.MouseEvent<HTMLButtonElement>);

    expect(assign).toHaveBeenCalledWith("/pricing");
  });

  it("stays up long enough to read and act on", () => {
    // The default toast duration is a few seconds, which is not enough for a
    // message whose whole point is a decision.
    showCapToast(capBody());

    expect(toastError.mock.calls[0][1]).toMatchObject({ duration: 8000 });
  });
});
