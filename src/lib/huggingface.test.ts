import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ---- mock the supabase client ---- */
const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      functions: { invoke: invokeMock },
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/* --- dynamic import so the mock is installed first --- */
async function loadModule() {
  return import("./huggingface");
}

describe("getDialectResponse", () => {
  it("returns content from a successful API call", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { content: "مرحبا" },
      error: null,
    });

    const { getDialectResponse } = await loadModule();
    const result = await getDialectResponse("Say hello", "standard");
    expect(result).toBe("مرحبا");

    expect(invokeMock).toHaveBeenCalledWith(
      "hf-chat",
      expect.objectContaining({
        body: { prompt: "Say hello", modelTier: "standard" },
      }),
    );
  });

  it("uses the premium model when requested", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { content: "أهلاً" },
      error: null,
    });

    const { getDialectResponse } = await loadModule();
    await getDialectResponse("Greet me", "premium");

    expect(invokeMock).toHaveBeenCalledWith(
      "hf-chat",
      expect.objectContaining({
        body: { prompt: "Greet me", modelTier: "premium" },
      }),
    );
  });

  it("retries on a 503 error and eventually succeeds", async () => {
    const busyError = Object.assign(new Error("503 Service Unavailable"), {
      status: 503,
    });

    invokeMock
      .mockResolvedValueOnce({ data: null, error: busyError })
      .mockResolvedValueOnce({ data: { content: "نجحنا" }, error: null });

    const { getDialectResponse } = await loadModule();
    const promise = getDialectResponse("Try again", "standard");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result).toBe("نجحنا");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("returns a fallback message after exhausting retries", async () => {
    const busyError = Object.assign(new Error("503 Service Unavailable"), {
      status: 503,
    });

    invokeMock
      .mockResolvedValueOnce({ data: null, error: busyError })
      .mockResolvedValueOnce({ data: null, error: busyError })
      .mockResolvedValueOnce({ data: null, error: busyError });

    const { getDialectResponse } = await loadModule();
    const promise = getDialectResponse("Fail", "standard");
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toContain("Sorry, the service is temporarily busy");
  });

  it("returns a fallback message for an empty response", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { content: null },
      error: null,
    });

    const { getDialectResponse } = await loadModule();
    const result = await getDialectResponse("Empty", "standard");
    expect(result).toContain("Sorry, the service is temporarily busy");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

