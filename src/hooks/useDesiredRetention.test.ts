import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useDesiredRetention, DEFAULT_RETENTION } from "./useDesiredRetention";

/**
 * The FSRS retention dial's read side. Every scheduler call site consumes
 * this, so the failure posture is the whole point: signed out, fetch error,
 * missing column, out-of-range value — all resolve to the classic 90%
 * default, because scheduling must never wait on or break over a preference.
 */

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user }) }));

const profile = vi.hoisted(() => ({
  row: null as { desired_retention: number | null } | null,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile.row, error: profile.error }),
        }),
      }),
    }),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  auth.user = { id: "learner-1" };
  profile.row = null;
  profile.error = null;
});

describe("useDesiredRetention", () => {
  it("returns the saved target", async () => {
    profile.row = { desired_retention: 0.85 };
    const { result } = renderHook(() => useDesiredRetention(), { wrapper });
    await waitFor(() => expect(result.current).toBe(0.85));
  });

  it("defaults while signed out", () => {
    auth.user = null;
    const { result } = renderHook(() => useDesiredRetention(), { wrapper });
    expect(result.current).toBe(DEFAULT_RETENTION);
  });

  it("defaults when nothing is saved", async () => {
    const { result } = renderHook(() => useDesiredRetention(), { wrapper });
    await waitFor(() => expect(result.current).toBe(DEFAULT_RETENTION));
  });

  it("defaults on a fetch error rather than blocking the scheduler", async () => {
    profile.error = { message: "column does not exist" };
    const { result } = renderHook(() => useDesiredRetention(), { wrapper });
    await waitFor(() => expect(result.current).toBe(DEFAULT_RETENTION));
  });

  it("rejects an out-of-range stored value", async () => {
    profile.row = { desired_retention: 0.2 };
    const { result } = renderHook(() => useDesiredRetention(), { wrapper });
    await waitFor(() => expect(result.current).toBe(DEFAULT_RETENTION));
  });
});
