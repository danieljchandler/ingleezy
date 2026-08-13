import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "@/hooks/useAuth";

// Mock supabase client
const mockOnAuthStateChange = vi.fn();
const mockGetSession = vi.fn();
const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...args: unknown[]) => {
        mockOnAuthStateChange(...args);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}));

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  it("starts in loading state", async () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);

    // The session resolves on a macrotask. Letting it land here keeps the
    // update inside the test rather than after it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("resolves session from getSession", async () => {
    const mockUser = { id: "user-123", email: "test@example.com" };
    const mockSession = { user: mockUser, access_token: "token" };
    mockGetSession.mockResolvedValue({ data: { session: mockSession } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("signIn calls supabase signInWithPassword", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const { error } = await act(async () => {
      return result.current.signIn("test@test.com", "password123");
    });

    expect(error).toBeNull();
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "test@test.com",
      password: "password123",
    });
  });

  it("signUp calls supabase signUp with redirect", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignUp.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const { error } = await act(async () => {
      return result.current.signUp("new@test.com", "password123");
    });

    expect(error).toBeNull();
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "new@test.com",
      password: "password123",
      options: { emailRedirectTo: expect.stringContaining("/") },
    });
  });

  it("signOut calls supabase signOut", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignOut.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const { error } = await act(async () => {
      return result.current.signOut();
    });

    expect(error).toBeNull();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("returns error from signIn on failure", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const mockError = { message: "Invalid credentials" };
    mockSignInWithPassword.mockResolvedValue({ error: mockError });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const { error } = await act(async () => {
      return result.current.signIn("bad@test.com", "wrong");
    });

    expect(error).toEqual(mockError);
  });
});
