import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_CAP_OPTIONS, formatCap, useNewCardCap } from "./useNewCardCap";

/**
 * How many unseen words a review session is allowed to introduce.
 *
 * This is the one lever a learner has over how fast their deck grows, and it
 * compounds: fifty new words a day is four hundred reviews a week later, which
 * is where people quit. The value is deliberately constrained to a short list
 * rather than a free number, so an accidental keystroke cannot commit someone
 * to a workload they will not notice until it arrives.
 */

const KEY = "mywords.newCap";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the default", () => {
  it("starts at ten a day", async () => {
    const { result } = renderHook(() => useNewCardCap());

    // Ten is roughly what a daily habit sustains — enough to feel like
    // progress, few enough that a missed week is recoverable.
    await waitFor(() => expect(result.current.cap).toBe(10));
  });

  it("renders the default on the very first paint", () => {
    localStorage.setItem(KEY, "50");

    // `renderHook` flushes effects before handing back `result`, so the
    // transient value has to be recorded from inside the render itself.
    const seen: number[] = [];
    renderHook(() => {
      const { cap } = useNewCardCap();
      seen.push(cap);
      return cap;
    });

    // Pinned. The stored value is read in an effect rather than in the state
    // initialiser, so the first render always says 10 whatever the learner
    // chose. A settings row shows "10 / day" for a frame before snapping to
    // "50 / day", and anything that reads `cap` during that first render — a
    // session builder assembling its queue synchronously — uses the default
    // rather than the choice.
    expect(seen[0]).toBe(10);
    expect(seen.at(-1)).toBe(50);
  });
});

describe("reading a stored value", () => {
  it("restores each of the offered options", async () => {
    for (const option of NEW_CAP_OPTIONS) {
      localStorage.setItem(KEY, String(option));

      const { result } = renderHook(() => useNewCardCap());

      await waitFor(() => expect(result.current.cap).toBe(option));
    }
  });

  it("ignores a value that is not on the list", async () => {
    localStorage.setItem(KEY, "37");

    const { result } = renderHook(() => useNewCardCap());

    // The picker only offers five values, so a stored 37 came from a hand
    // edit or an older build; falling back beats honouring a number no
    // control can express.
    await waitFor(() => expect(result.current.cap).toBe(10));
  });

  it("ignores a value that is not a number at all", async () => {
    localStorage.setItem(KEY, "lots");

    const { result } = renderHook(() => useNewCardCap());

    await waitFor(() => expect(result.current.cap).toBe(10));
  });

  it("ignores a negative cap", async () => {
    localStorage.setItem(KEY, "-5");

    // A negative cap would introduce nothing and give no reason why.
    const { result } = renderHook(() => useNewCardCap());

    await waitFor(() => expect(result.current.cap).toBe(10));
  });

  it("falls back when storage cannot be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { result } = renderHook(() => useNewCardCap());

    await waitFor(() => expect(result.current.cap).toBe(10));
  });
});

describe("changing the cap", () => {
  it("applies immediately and persists", async () => {
    const { result } = renderHook(() => useNewCardCap());
    await waitFor(() => expect(result.current.cap).toBe(10));

    act(() => {
      result.current.setCap(20);
    });

    expect(result.current.cap).toBe(20);
    expect(localStorage.getItem(KEY)).toBe("20");
  });

  it("round-trips through a remount", async () => {
    const { result } = renderHook(() => useNewCardCap());
    await waitFor(() => expect(result.current.cap).toBe(10));
    act(() => {
      result.current.setCap(50);
    });

    const remounted = renderHook(() => useNewCardCap());

    await waitFor(() => expect(remounted.result.current.cap).toBe(50));
  });

  it("still applies when the write fails", async () => {
    const { result } = renderHook(() => useNewCardCap());
    await waitFor(() => expect(result.current.cap).toBe(10));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    act(() => {
      result.current.setCap(20);
    });

    // The session in front of the learner honours the choice; only its
    // persistence is lost.
    expect(result.current.cap).toBe(20);
  });
});

describe("labelling the cap", () => {
  it("shows a number for the finite options", () => {
    expect(formatCap(5)).toBe("5");
    expect(formatCap(10)).toBe("10");
    expect(formatCap(50)).toBe("50");
  });

  it("shows infinity for the unlimited option", () => {
    // 999 is the sentinel for "no limit"; showing it as a number would read as
    // a strangely specific daily target.
    expect(formatCap(999)).toBe("∞");
  });

  it("shows infinity for anything past the sentinel", () => {
    expect(formatCap(5000)).toBe("∞");
  });
});
