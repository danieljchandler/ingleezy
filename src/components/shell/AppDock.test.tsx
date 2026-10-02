import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { AppDock, shouldShowDock, slotOwns } from "./AppDock";

/**
 * The dock: four tabs — اليوم · المكتبة · تكلّم · كلماتي.
 *
 * Each tab owns a family of routes, so the right one stays lit on the pages it
 * leads to. Getting that wrong is quiet: every link still works, but the
 * learner loses track of where they are.
 */

let cleanup: (() => void) | undefined;

afterEach(async () => {
  // The providers resolve a session in the background; let it land before the
  // stubbed fetch is restored, or it escapes as a real network request.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

function render(route: string) {
  const harness = renderWithProviders(<AppDock />, { persona: "free", route });
  cleanup = harness.cleanup;
  return harness;
}

const dock = () => screen.getByRole("navigation", { name: "التنقل الرئيسي" });
const current = () =>
  within(dock()).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");

describe("the tabs", () => {
  it("are the four, in order, with profile not among them", () => {
    render("/");

    expect(within(dock()).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "اليوم", "المكتبة", "تكلّم", "كلماتي",
    ]);
  });

  it("go where they say", () => {
    render("/");

    const hrefs = within(dock()).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/", "/library", "/talk", "/my-words"]);
  });
});

describe("which tab is lit", () => {
  it("lights Today only on the front door", () => {
    render("/");
    expect(current().map((link) => link.textContent)).toEqual(["اليوم"]);
  });

  it("lights the library on the clips feed it now owns", () => {
    render("/feed");
    expect(current().map((link) => link.textContent)).toEqual(["المكتبة"]);
  });

  it("lights تكلّم on the speaking tools", () => {
    render("/how-do-i-say");
    expect(current().map((link) => link.textContent)).toEqual(["تكلّم"]);
  });

  it("lights nothing on a page no tab owns", () => {
    render("/settings");
    expect(current()).toHaveLength(0);
  });
});

describe("matching a route to a tab", () => {
  it("never lets '/' claim the whole app", () => {
    expect(slotOwns(["/"], "/")).toBe(true);
    expect(slotOwns(["/"], "/library")).toBe(false);
  });

  it("matches a prefix only at a path boundary", () => {
    expect(slotOwns(["/listen"], "/listen/abc")).toBe(true);
    // /listening is its own page, not a child of /listen.
    expect(slotOwns(["/listen"], "/listening")).toBe(false);
  });
});

describe("where the dock steps aside", () => {
  it("hides over full-screen flows and shows elsewhere", () => {
    expect(shouldShowDock("/review")).toBe(false);
    expect(shouldShowDock("/discover/abc")).toBe(false);
    // The tutor chat has its own way out and a microphone where the dock sits.
    expect(shouldShowDock("/conversation")).toBe(false);
    // So does the pronunciation drill: a session, with its own exit and its
    // mic at the bottom.
    expect(shouldShowDock("/pronunciation")).toBe(false);
    expect(shouldShowDock("/talk")).toBe(true);
    expect(shouldShowDock("/library")).toBe(true);
    expect(shouldShowDock("/")).toBe(true);
  });
});
