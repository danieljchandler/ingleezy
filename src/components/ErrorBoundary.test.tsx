import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * The last line of defence between a render-time throw and a white screen.
 *
 * App.tsx wraps the whole router in one of these, and pages that call out
 * to slow or flaky things (Transcribe, MemeAnalyzer, LearnFromX)
 * wrap themselves in another. So this component decides what a learner sees on
 * the worst day the app has, which is exactly why it classifies the error
 * rather than showing one generic panel: "check your connection" and "sign in
 * again" are acts the user can take, and "something went wrong" is not.
 *
 * The sink is mocked here. `logClientError` has its own tests, and it carries a
 * module-level rate-limit bucket of ten per minute that would silently swallow
 * the later assertions in a file that throws this many times.
 */

const logClientError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errorLog", () => ({ logClientError }));

let cleanup: (() => void) | undefined;
let consoleError: ReturnType<typeof vi.spyOn>;
let originalLocation: Location;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // React logs every boundary-caught error itself, on top of the component's
  // own console.error. Silenced rather than left to scroll past, so a real
  // unexpected warning in this file is still visible.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  reload = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, href: "/current", reload },
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
  logClientError.mockReset();
});

/** Throws on render until `stop` is flipped, so retry has something to recover to. */
const control = { throwing: true, error: new Error("boom") };

function Bomb(): ReactNode {
  if (control.throwing) throw control.error;
  return <p>child content</p>;
}

function render(error?: Error, name?: string) {
  control.throwing = error !== undefined;
  if (error) control.error = error;
  const harness = renderWithProviders(
    <ErrorBoundary name={name}>
      <Bomb />
    </ErrorBoundary>,
  );
  cleanup = harness.cleanup;
  return harness;
}

describe("ErrorBoundary — passing children through", () => {
  it("renders its children when nothing throws", () => {
    render();
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("shows no fallback panel while the tree is healthy", () => {
    render();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("keeps rendering children across a re-render", () => {
    const { rerender } = render();
    rerender(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });
});

describe("ErrorBoundary — catching", () => {
  it("replaces the throwing subtree with the fallback", () => {
    render(new Error("kaboom"));
    expect(screen.queryByText("child content")).not.toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("explains that the failure was logged", () => {
    render(new Error("kaboom"));
    expect(
      screen.getByText("This page hit an error while loading. The details have been logged."),
    ).toBeInTheDocument();
  });
});

describe("ErrorBoundary — classifying the error", () => {
  const network = [
    ["a failed fetch", "Failed to fetch"],
    ["the word network", "NetworkError when attempting to fetch resource"],
    ["a failed chunk load", "Failed to load dynamically imported module"],
    ["a timeout", "Request timeout after 30000ms"],
  ] as const;

  it.each(network)("treats %s as a connection problem", (_label, message) => {
    render(new Error(message));
    expect(screen.getByText("Connection problem")).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the server. Check your internet connection and try again."),
    ).toBeInTheDocument();
  });

  const auth = [
    ["the word auth", "auth session missing"],
    ["a JWT complaint", "JWT expired"],
    ["the word unauthorized", "Unauthorized"],
    ["a bare 401", "Request failed with status 401"],
  ] as const;

  it.each(auth)("treats %s as an expired session", (_label, message) => {
    render(new Error(message));
    expect(screen.getByText("Your session expired")).toBeInTheDocument();
    expect(screen.getByText("Please sign in again to continue.")).toBeInTheDocument();
  });

  it("matches keywords regardless of case", () => {
    render(new Error("FAILED TO FETCH"));
    expect(screen.getByText("Connection problem")).toBeInTheDocument();
  });

  it("prefers the connection reading when a message carries both signals", () => {
    // "failed to fetch token" hits the network branch first, which is the more
    // useful of the two — a token request that could not leave the device is a
    // connection problem, not an expired session.
    render(new Error("failed to fetch token"));
    expect(screen.getByText("Connection problem")).toBeInTheDocument();
  });

  it("falls back to the generic panel for anything unrecognised", () => {
    render(new Error("Cannot read properties of undefined (reading 'map')"));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("survives an error with no message at all", () => {
    render(new Error(""));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("does not read a JSON parse failure as an expired session", () => {
    // "Unexpected token < in JSON" is what a request that expected JSON and got
    // an HTML error page throws, and it is one of the commonest render-time
    // errors there is. Matching a bare "token" substring sent that user to
    // /auth, where signing in again fixed nothing.
    render(new SyntaxError("Unexpected token < in JSON at position 0"));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  const tokens = [
    ["a named access token", "access token is invalid"],
    ["a refresh token", "refresh_token not found"],
    ["a token that expired", "token has expired"],
    ["a token called invalid", "invalid token"],
  ] as const;

  it.each(tokens)("still reads %s as an expired session", (_label, message) => {
    // The narrowing has to keep the real cases: a token counts when something
    // says which kind it is, or what went wrong with it.
    render(new Error(message));
    expect(screen.getByText("Your session expired")).toBeInTheDocument();
  });
});

describe("ErrorBoundary — the details disclosure", () => {
  it("keeps the message collapsed behind a toggle", () => {
    render(new Error("secret internal detail"));
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
    expect(screen.queryByText("secret internal detail")).not.toBeInTheDocument();
  });

  it("reveals the raw message when expanded", () => {
    render(new Error("secret internal detail"));
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("secret internal detail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();
  });

  it("collapses again on a second click", () => {
    render(new Error("secret internal detail"));
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByText("secret internal detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
  });

  it("offers the details on a connection panel too", () => {
    // The friendly sentence is for the learner; the message is for whoever they
    // forward the screenshot to. Without it a misclassified error is
    // unreportable — the screen holds no fact about what actually failed.
    render(new Error("Failed to fetch /api/lessons"));
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Failed to fetch /api/lessons")).toBeInTheDocument();
  });

  it("offers the details on a session panel too", () => {
    render(new Error("JWT expired at 1700000000"));
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("JWT expired at 1700000000")).toBeInTheDocument();
  });

  it("still starts collapsed on a classified panel", () => {
    render(new Error("Failed to fetch /api/lessons"));
    expect(screen.queryByText("Failed to fetch /api/lessons")).not.toBeInTheDocument();
  });
});

describe("ErrorBoundary — recovery actions", () => {
  it("offers both a retry and a reload on a generic failure", () => {
    render(new Error("kaboom"));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أعد تحميل الصفحة" })).toBeInTheDocument();
  });

  it("labels the retry as a retry on a connection failure", () => {
    render(new Error("Failed to fetch"));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أعد تحميل الصفحة" })).toBeInTheDocument();
  });

  it("offers only sign-in on a session failure", () => {
    render(new Error("Unauthorized"));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    // Reloading an expired session just lands on the same panel, so it is
    // deliberately not offered.
    expect(screen.queryByRole("button", { name: "أعد تحميل الصفحة" })).not.toBeInTheDocument();
  });

  it("re-renders the children when the retry succeeds", () => {
    render(new Error("kaboom"));
    control.throwing = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("child content")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("catches again when the retry hits the same failure", () => {
    render(new Error("kaboom"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("child content")).not.toBeInTheDocument();
  });

  it("re-classifies on a second, different failure", () => {
    render(new Error("kaboom"));
    control.error = new Error("Failed to fetch");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Connection problem")).toBeInTheDocument();
  });

  it("forgets an expanded disclosure across a retry", () => {
    render(new Error("kaboom"));
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Show details" })).toBeInTheDocument();
    expect(screen.queryByText("kaboom")).not.toBeInTheDocument();
  });

  it("sends the user to the auth page from a session failure", () => {
    render(new Error("Unauthorized"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(window.location.href).toBe("/auth");
  });

  it("does not clear the panel when navigating to auth", () => {
    render(new Error("Unauthorized"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    // The navigation replaces the document; leaving the panel up is correct,
    // because clearing it would flash the still-broken subtree first.
    expect(screen.getByText("Your session expired")).toBeInTheDocument();
  });

  it("reloads the document from the reload button", () => {
    render(new Error("kaboom"));
    fireEvent.click(screen.getByRole("button", { name: "أعد تحميل الصفحة" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe("/current");
  });
});

describe("ErrorBoundary — reporting", () => {
  it("sends the failure to the client error sink", () => {
    const error = new Error("kaboom");
    render(error, "AppRoot");
    expect(logClientError).toHaveBeenCalledTimes(1);
    expect(logClientError.mock.calls[0][0]).toMatchObject({
      message: "kaboom",
      meta: { boundary: "AppRoot" },
    });
  });

  it("includes the stack and the component stack", () => {
    render(new Error("kaboom"), "AppRoot");
    const payload = logClientError.mock.calls[0][0] as {
      stack: string | null;
      meta: { componentStack?: string };
    };
    expect(payload.stack).toContain("Error: kaboom");
    expect(payload.meta.componentStack).toContain("Bomb");
  });

  it("reports an unnamed boundary with no name rather than failing", () => {
    render(new Error("kaboom"));
    expect(logClientError.mock.calls[0][0]).toMatchObject({
      message: "kaboom",
      meta: { boundary: undefined },
    });
  });

  it("substitutes a stringified error when the message is empty", () => {
    render(new Error(""));
    expect(logClientError.mock.calls[0][0]).toMatchObject({ message: "Error" });
  });

  it("writes the boundary name to the console for local debugging", () => {
    render(new Error("kaboom"), "Transcribe");
    const own = consoleError.mock.calls.find(
      (call) => call[0] === "ErrorBoundary caught error",
    );
    expect(own).toBeDefined();
    expect(own?.[1]).toMatchObject({ name: "Transcribe" });
  });

  it("reports each failure separately across a failed retry", () => {
    render(new Error("kaboom"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(logClientError).toHaveBeenCalledTimes(2);
  });

  it("reports nothing while the tree is healthy", () => {
    render();
    expect(logClientError).not.toHaveBeenCalled();
  });
});
