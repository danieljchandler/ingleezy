import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { onTestFinished } from "vitest";
import { act, render, renderHook, type RenderHookOptions, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { DialectProvider } from "@/contexts/DialectContext";
import { AiAssistantProvider } from "@/contexts/AiAssistantContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installSupabaseFetch, type InstalledBackend } from "../transports/vitest";
import { isSignedIn, seedPersona, type Persona, type PersonaOptions } from "../personas";
import { TEST_USER_ID } from "../server/session";

/**
 * Renders components and hooks with the providers the app gives them, against
 * the in-memory Supabase backend.
 *
 * The backend is installed as `globalThis.fetch`, so the **real**
 * `@supabase/supabase-js` client runs: the URL a hook builds is the thing under
 * test. That is the difference that matters — a hand-mocked query builder
 * returns whatever the test told it to, so it can never catch a filter applied
 * to the wrong column or a select naming one that no longer exists.
 */

export interface HarnessOptions {
  /** Who is signed in. Defaults to a signed-out visitor. */
  persona?: Persona;
  personaOptions?: PersonaOptions;
  /** Router entry, for components that read the path or params. */
  route?: string;
  /** Seed fixtures before the component mounts. */
  seed?: (backend: InstalledBackend["backend"]) => void;
}

export interface Harness {
  backend: InstalledBackend["backend"];
  cleanup: () => void;
}

/**
 * Lets supabase-js finish resolving the session before the test tears down.
 *
 * `useAuth` asks for the session on mount and supabase-js answers it on a
 * macrotask, so a test that renders and asserts synchronously ends with that
 * request still in flight. It then lands *after* the file's `afterEach` has
 * called `cleanup()` — at which point `fetch` has been handed back to the
 * hermeticity guard in setup.ts, which throws, and any state update it would
 * have caused happens outside `act()`. That combination produced ~150 warnings
 * across the suite: all noise, but noise loud enough to hide a real one.
 *
 * `onTestFinished` is the hook that fits: it runs after the test body but
 * *before* any `afterEach`, so the component is still mounted and the backend
 * is still installed. One macrotask is enough — the request is already in
 * flight, this only gives it somewhere to land.
 *
 * Registered from the harness rather than from each test file so a new test
 * cannot forget it.
 */
function drainPendingAuthOnTestEnd(): void {
  try {
    onTestFinished(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
  } catch {
    // Only valid inside a running test. A harness built from a `beforeEach`
    // drains via that test's own registration instead.
  }
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The app uses retry:1 and a 30s staleTime. Both are wrong for tests:
        // a retry turns one deliberate failure into a slow one, and a stale
        // window lets data leak between tests through the shared cache.
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

function setUp(options: HarnessOptions): Harness & { wrapper: (props: { children: ReactNode }) => ReactElement } {
  // The session has to be in localStorage before the client reads it, which it
  // does at construction — so the persona is resolved first and handed to the
  // installer rather than applied afterwards. Without this `useAuth` sees no
  // user and every data hook short-circuits to an empty result, which looks
  // exactly like a query returning nothing.
  const userId =
    options.persona && isSignedIn(options.persona)
      ? (options.personaOptions?.userId ?? TEST_USER_ID)
      : null;

  const installed = installSupabaseFetch({ signedInAs: userId });
  const { backend } = installed;

  drainPendingAuthOnTestEnd();

  if (options.persona) {
    seedPersona(backend, options.persona, options.personaOptions);
  }
  options.seed?.(backend);

  const queryClient = createTestQueryClient();

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? "/"]}>
        <DialectProvider>
          <AiAssistantProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </AiAssistantProvider>
        </DialectProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  const cleanup = () => {
    queryClient.clear();
    installed.restore();
    /**
     * Put the process back online.
     *
     * TanStack Query's `onlineManager` is a module singleton that listens on
     * `window`, so a test that dispatches an `offline` event — the only way to
     * exercise the review queue's offline path — leaves *every* later test in
     * the worker with its mutations paused. That reads as a mutation which
     * simply never runs: no error, no write, and an assertion that times out
     * somewhere unrelated.
     */
    onlineManager.setOnline(true);
    // DialectProvider persists to localStorage and writes CSS variables onto
    // documentElement; both would otherwise carry into the next test.
    window.localStorage.clear();
    document.documentElement.removeAttribute("style");
  };

  return { backend, cleanup, wrapper };
}

/** Render a component with the app's providers and the in-memory backend. */
export function renderWithProviders(
  ui: ReactElement,
  options: HarnessOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  const { persona, personaOptions, route, seed, ...renderOptions } = options;
  const { backend, cleanup, wrapper } = setUp({ persona, personaOptions, route, seed });

  const result = render(ui, { wrapper, ...renderOptions });

  return { ...result, backend, cleanup };
}

/** Render a hook with the same providers and backend. */
export function renderHookWithProviders<Result, Props>(
  hook: (initialProps: Props) => Result,
  options: HarnessOptions & Omit<RenderHookOptions<Props>, "wrapper"> = {},
) {
  const { persona, personaOptions, route, seed, ...hookOptions } = options;
  const { backend, cleanup, wrapper } = setUp({ persona, personaOptions, route, seed });

  const result = renderHook(hook, { wrapper, ...hookOptions });

  return { ...result, backend, cleanup };
}

export { TEST_USER_ID };
