import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast as sonnerToast } from "sonner";
import { toast, useToast } from "./use-toast";

/**
 * The compatibility shim between the app's `toast(...)` calls and sonner.
 *
 * The radix toaster was removed to drop about 6 kB from the main bundle — it
 * was double-mounted alongside sonner, so every notification had two possible
 * homes. This shim is what let that happen without touching the couple of
 * hundred call sites that already existed.
 *
 * Its whole job is faithful translation, and the two shapes disagree in ways
 * that matter: radix took `{ title, description, variant }` and accepted
 * arbitrary ReactNodes; sonner takes a message plus options and wants a string.
 * A mistranslation here does not throw — it shows an empty toast, which is how
 * an error message silently becomes a blank rectangle.
 */

vi.mock("sonner", () => {
  const fn = vi.fn(() => "toast-id");
  return {
    toast: Object.assign(fn, {
      error: vi.fn(() => "error-id"),
      dismiss: vi.fn(),
    }),
  };
});

/** The mocked module, typed for assertions. */
const sonner = sonnerToast as unknown as ReturnType<typeof vi.fn> & {
  error: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  sonner.mockClear();
  sonner.error.mockClear();
  sonner.dismiss.mockClear();
});

describe("translating a toast", () => {
  it("passes the title through as the message", () => {
    toast({ title: "Saved" });

    expect(sonner).toHaveBeenCalledWith("Saved", { description: undefined, duration: undefined });
  });

  it("accepts a bare string", () => {
    toast("Saved");

    // The shorthand a lot of call sites use; treating the string as an options
    // object would show a toast with no message at all.
    expect(sonner).toHaveBeenCalledWith("Saved", { description: undefined, duration: undefined });
  });

  it("carries the description under the title", () => {
    toast({ title: "Saved", description: "Your word was added" });

    expect(sonner).toHaveBeenCalledWith("Saved", {
      description: "Your word was added",
      duration: undefined,
    });
  });

  it("routes a destructive toast to the error style", () => {
    toast({ title: "Could not save", description: "Try again", variant: "destructive" });

    // The variant is the only signal that something went wrong; losing it makes
    // a failure look like a confirmation.
    expect(sonner.error).toHaveBeenCalledWith("Could not save", {
      description: "Try again",
      duration: undefined,
    });
    expect(sonner).not.toHaveBeenCalled();
  });

  it("carries the duration when one was asked for", () => {
    toast({ title: "Uploading", duration: 10_000 });

    // Long-running work sets its own duration so the toast outlasts the
    // operation it describes.
    expect(sonner).toHaveBeenCalledWith("Uploading", {
      description: undefined,
      duration: 10_000,
    });
  });

  it("substitutes a space for a title it cannot render", () => {
    toast({ description: "Something happened" });

    // Pinned. sonner needs a message, and a ReactNode or missing title cannot
    // be turned into one, so the shim sends a single space. The result is a
    // toast with a blank first line and the real text below it — visually odd,
    // but a toast that appears and says something beats one that does not
    // appear at all.
    expect(sonner).toHaveBeenCalledWith(" ", {
      description: "Something happened",
      duration: undefined,
    });
  });

  it("drops a description it cannot render rather than showing [object Object]", () => {
    toast({ title: "Saved", description: { type: "div" } as unknown as string });

    // Pinned. A ReactNode description is dropped, not stringified. Some call
    // sites pass JSX here and lose the detail line entirely — silently, and
    // only in the cases where the extra detail was worth writing.
    expect(sonner).toHaveBeenCalledWith("Saved", { description: undefined, duration: undefined });
  });

  it("renders a numeric title as its digits", () => {
    toast({ title: 42 as unknown as string });

    expect(sonner).toHaveBeenCalledWith("42", { description: undefined, duration: undefined });
  });
});

describe("the handle it returns", () => {
  it("gives back an id the caller can hold", () => {
    // The radix version returned one and several call sites still keep it to
    // dismiss the toast when the operation it describes finishes.
    expect(toast({ title: "Saved" }).id).toBe("toast-id");
  });

  it("dismisses the toast it created", () => {
    toast({ title: "Saved" }).dismiss();

    expect(sonner.dismiss).toHaveBeenCalledWith("toast-id");
  });

  it("accepts an update call without doing anything", () => {
    const handle = toast({ title: "Saved" });

    // sonner toasts are immutable once shown. The no-op is what keeps the few
    // call sites that call `update()` from throwing.
    expect(() => handle.update()).not.toThrow();
  });
});

describe("the hook form", () => {
  it("hands back the same toast function", () => {
    const { result } = renderHook(() => useToast());

    expect(result.current.toast).toBe(toast);
  });

  it("dismisses a specific toast by id", () => {
    const { result } = renderHook(() => useToast());

    result.current.dismiss("toast-id");

    expect(sonner.dismiss).toHaveBeenCalledWith("toast-id");
  });

  it("dismisses everything when given no id", () => {
    const { result } = renderHook(() => useToast());

    result.current.dismiss();

    expect(sonner.dismiss).toHaveBeenCalledWith(undefined);
  });

  it("reports an empty list of toasts", () => {
    const { result } = renderHook(() => useToast());

    // The radix version exposed the live queue and a couple of call sites read
    // it. sonner owns its own queue, so this is permanently empty — pinned
    // because anything rendering from it shows nothing and never will.
    expect(result.current.toasts).toEqual([]);
  });
});
