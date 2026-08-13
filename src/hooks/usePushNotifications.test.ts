import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Web push — the only way the app can reach a learner who has closed the tab.
 *
 * `useSmartNotifications` already knows what is worth saying, but it can only
 * say it to somebody who is already looking at the app, which is precisely the
 * person who does not need reminding. This hook is the plumbing that carries a
 * nudge to a browser that is not running.
 *
 * Two things make it delicate. The permission prompt can only be asked for once
 * per origin in practice — a learner who declines is unreachable and there is no
 * second chance — so it is only requested when they explicitly ask to be
 * reminded. And the browser's idea of the subscription and the server's row have
 * to stay in step: an endpoint the browser has dropped but the server still
 * holds is a push into the void, and the sender retries it for days.
 *
 * Everything here is mocked at the module boundary rather than run against the
 * in-memory backend. The VAPID key is read from `import.meta.env` at module
 * scope, so exercising the configured branch at all requires re-importing the
 * module with a different environment — and once the module registry is reset,
 * the shared Supabase client the harness installs is a different instance from
 * the one the hook holds.
 */

const VAPID = "BBwEM_afvC6pOZbrTLE03u1Z4475caC2IeFoo8TBLo_5gKL-mAu74mR98dAg-Ea9TgTeMM3ddAqt-aULaMLv1_s";
const USER_ID = "00000000-0000-4000-8000-000000000001";

type PostgrestError = { message: string } | null;

const upsert = vi.fn(
  async (_row: Record<string, unknown>, _options?: { onConflict?: string }) => ({
    error: null as PostgrestError,
  }),
);
const deleteEq = vi.fn(async (_userId: string, _endpoint: string) => ({
  error: null as PostgrestError,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: (row: Record<string, unknown>, options?: { onConflict?: string }) =>
        upsert(row, options),
      delete: () => ({
        eq: (_column: string, userId: string) => ({
          eq: (_endpointColumn: string, endpoint: string) => deleteEq(userId, endpoint),
        }),
      }),
    }),
  },
}));

let signedIn = true;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: signedIn ? { id: USER_ID } : null }),
}));

// ── Browser doubles ─────────────────────────────────────────────────────────

interface FakeSubscription {
  endpoint: string;
  getKey: (name: string) => ArrayBuffer | null;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const aSubscription = (endpoint = "https://push.test/abc"): FakeSubscription => ({
  endpoint,
  getKey: (name: string) => (name === "p256dh" ? new Uint8Array([1, 2]).buffer : new Uint8Array([3]).buffer),
  unsubscribe: vi.fn(async () => true),
});

let existing: FakeSubscription | null = null;
let created: FakeSubscription | null = null;
let subscribeThrows: Error | null = null;
let permissionAnswer: NotificationPermission = "granted";

const pushManager = {
  getSubscription: vi.fn(async () => existing),
  subscribe: vi.fn(async () => {
    if (subscribeThrows) throw subscribeThrows;
    existing = created ?? aSubscription();
    return existing;
  }),
};

const requestPermission = vi.fn(async () => permissionAnswer);

const originals = {
  serviceWorker: Object.getOwnPropertyDescriptor(navigator, "serviceWorker"),
  Notification: (globalThis as Record<string, unknown>).Notification,
  PushManager: (globalThis as Record<string, unknown>).PushManager,
};

function installBrowserPush({ supported = true, permission = "default" as NotificationPermission } = {}) {
  if (supported) {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager }) },
    });
    (globalThis as Record<string, unknown>).PushManager = class {};
    (globalThis as Record<string, unknown>).Notification = Object.assign(class {}, {
      permission,
      requestPermission,
    });
  } else {
    // A browser with no PushManager — every iOS Safari before 16.4, and every
    // in-app webview.
    delete (globalThis as Record<string, unknown>).PushManager;
  }
}

/** Re-import the hook with a chosen VAPID key, since it is read at module scope. */
async function loadHook(vapidKey: string | undefined) {
  vi.resetModules();
  if (vapidKey === undefined) vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
  else vi.stubEnv("VITE_VAPID_PUBLIC_KEY", vapidKey);
  return (await import("./usePushNotifications")).usePushNotifications;
}

beforeEach(() => {
  upsert.mockClear();
  deleteEq.mockClear();
  pushManager.getSubscription.mockClear();
  pushManager.subscribe.mockClear();
  requestPermission.mockClear();
  existing = null;
  created = null;
  subscribeThrows = null;
  permissionAnswer = "granted";
  signedIn = true;
  installBrowserPush();
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (originals.serviceWorker) {
    Object.defineProperty(navigator, "serviceWorker", originals.serviceWorker);
  }
  (globalThis as Record<string, unknown>).Notification = originals.Notification;
  (globalThis as Record<string, unknown>).PushManager = originals.PushManager;
});

describe("whether push is available at all", () => {
  it("is available when the browser can do it and a key is configured", async () => {
    const usePushNotifications = await loadHook(VAPID);

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(true);
  });

  it("is unavailable on a deployment with no VAPID key", async () => {
    const usePushNotifications = await loadHook(undefined);

    const { result } = renderHook(() => usePushNotifications());

    // Unsupported rather than half-working: the toggle disappears instead of
    // offering a subscription that could never be delivered to.
    expect(result.current.isSupported).toBe(false);
  });

  it("is unavailable in a browser with no PushManager", async () => {
    installBrowserPush({ supported: false });
    const usePushNotifications = await loadHook(VAPID);

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(false);
  });

  it("touches nothing when it is unavailable", async () => {
    const usePushNotifications = await loadHook(undefined);

    renderHook(() => usePushNotifications());

    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });
});

describe("what it finds on mount", () => {
  it("reports the browser's current permission", async () => {
    installBrowserPush({ permission: "denied" });
    const usePushNotifications = await loadHook(VAPID);

    const { result } = renderHook(() => usePushNotifications());

    // A learner who declined once cannot be asked again by the same origin, so
    // the UI has to say "blocked in your browser" rather than offer a button
    // that will do nothing.
    await waitFor(() => expect(result.current.permission).toBe("denied"));
  });

  it("notices an existing subscription", async () => {
    existing = aSubscription();
    const usePushNotifications = await loadHook(VAPID);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
  });

  it("reports no subscription when there is none", async () => {
    const usePushNotifications = await loadHook(VAPID);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(pushManager.getSubscription).toHaveBeenCalled());
    expect(result.current.isSubscribed).toBe(false);
  });

  it("survives a service worker that has not activated", async () => {
    const ready = Promise.reject(new Error("no registration"));
    // The hook attaches its own handler, but not until it mounts — several
    // microtasks after this promise is created, which is long enough for the
    // runtime to report it as unhandled.
    ready.catch(() => {});
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready } });
    const usePushNotifications = await loadHook(VAPID);

    const { result } = renderHook(() => usePushNotifications());

    // Ordinary in a dev build and during the first seconds of a fresh install;
    // an unhandled rejection here would surface as a crash toast.
    await waitFor(() => expect(result.current.isSubscribed).toBe(false));
  });
});

describe("subscribing", () => {
  it("asks for permission and records the endpoint", async () => {
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    let granted = false;
    await act(async () => {
      granted = await result.current.subscribe();
    });

    expect(granted).toBe(true);
    expect(requestPermission).toHaveBeenCalled();
    expect(upsert.mock.calls[0][0]).toMatchObject({
      user_id: USER_ID,
      endpoint: "https://push.test/abc",
    });
    expect(result.current.isSubscribed).toBe(true);
  });

  it("stores the keys the sender needs to encrypt with", async () => {
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    // Web push payloads are encrypted to these two keys. A row without them is
    // an endpoint nothing can be delivered to.
    const row = upsert.mock.calls[0][0] as Record<string, string>;
    expect(row.p256dh.length).toBeGreaterThan(0);
    expect(row.auth.length).toBeGreaterThan(0);
  });

  it("records the learner's timezone", async () => {
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    // So a nudge lands in their evening rather than at UTC midnight, which for
    // Gulf learners is the middle of the night.
    expect(upsert.mock.calls[0][0].timezone).toBeTruthy();
  });

  it("revives an endpoint the sender had retired", async () => {
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    // The sender disables an endpoint after repeated failures. Re-subscribing
    // is the learner saying they want it back, and a row left disabled would
    // accept the subscription and then silently never deliver.
    expect(upsert.mock.calls[0][0].disabled_at).toBeNull();
    expect(upsert.mock.calls[0][1]).toMatchObject({ onConflict: "user_id,endpoint" });
  });

  it("reuses an existing subscription rather than minting a second", async () => {
    existing = aSubscription();
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    // Two endpoints for one browser means every reminder arrives twice.
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });

  it("stops when the learner declines", async () => {
    permissionAnswer = "denied";
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    let granted = true;
    await act(async () => {
      granted = await result.current.subscribe();
    });

    expect(granted).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.permission).toBe("denied"));
  });

  it("refuses for a signed-out visitor", async () => {
    signedIn = false;
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    let granted = true;
    await act(async () => {
      granted = await result.current.subscribe();
    });

    // The row is keyed on a learner, and asking for the permission prompt
    // before sign-up spends the one chance the origin gets.
    expect(granted).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("reports a failure rather than throwing", async () => {
    subscribeThrows = new Error("AbortError: registration failed");
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    let granted = true;
    await act(async () => {
      granted = await result.current.subscribe();
    });

    expect(granted).toBe(false);
    expect(result.current.isBusy).toBe(false);
  });

  it("does not claim a subscription when the row could not be written", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "denied" } });
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    let granted = true;
    await act(async () => {
      granted = await result.current.subscribe();
    });

    // The browser is subscribed but the sender has no record of it, so nothing
    // will ever arrive. Reporting success would leave the learner waiting for
    // reminders that cannot come.
    expect(granted).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
  });
});

describe("unsubscribing", () => {
  it("drops the server row before the browser subscription", async () => {
    const subscription = aSubscription();
    existing = subscription;
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));

    await act(async () => {
      await result.current.unsubscribe();
    });

    // This order matters: a browser-side unsubscribe that is not mirrored
    // leaves the sender pushing into a dead endpoint and retrying for days.
    expect(deleteEq).toHaveBeenCalledWith(USER_ID, subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  it("is harmless when there is nothing subscribed", async () => {
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(deleteEq).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
  });

  it("still unsubscribes the browser for a signed-out visitor", async () => {
    const subscription = aSubscription();
    existing = subscription;
    signedIn = false;
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    // Pinned. With no user there is nobody to scope the delete to, so the
    // server row survives and the sender keeps pushing to an endpoint the
    // browser has dropped — the exact state the delete-first ordering exists to
    // avoid. It is reachable: signing out and then turning the toggle off.
    expect(deleteEq).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("reports a failure rather than throwing", async () => {
    const subscription = aSubscription();
    subscription.unsubscribe.mockRejectedValueOnce(new Error("network"));
    existing = subscription;
    const usePushNotifications = await loadHook(VAPID);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(result.current.isBusy).toBe(false);
  });

  it("does nothing when push is unavailable", async () => {
    const usePushNotifications = await loadHook(undefined);
    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });
});
