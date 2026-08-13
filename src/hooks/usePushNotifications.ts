import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Web push subscription management.
 *
 * The app already knows what's worth saying (useSmartNotifications), but only
 * while it's open — which means it can only remind the learner who is already
 * looking at it. This is the plumbing that lets a reminder reach a closed tab.
 *
 * The VAPID public key is injected at build time. Without it the hook reports
 * itself unsupported rather than half-working, so the UI can hide the toggle on
 * a deployment where push hasn't been configured.
 */

const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushPermission = "default" | "granted" | "denied";

export interface PushState {
  /** The browser can do push AND this deployment has a VAPID key configured. */
  isSupported: boolean;
  permission: PushPermission;
  isSubscribed: boolean;
  isBusy: boolean;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
}

/** VAPID keys travel as base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  const bytes = new Uint8Array(key);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePushNotifications(): PushState {
  const { user } = useAuth();
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const isSupported = browserSupportsPush() && !!VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!isSupported) return;
    setPermission(Notification.permission as PushPermission);

    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setIsSubscribed(!!sub);
      })
      .catch(() => {
        // No registration yet (dev build, or the worker hasn't activated).
      });

    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported || !user) return false;
    setIsBusy(true);
    try {
      const result = (await Notification.requestPermission()) as PushPermission;
      setPermission(result);
      if (result !== "granted") return false;

      const registration = await navigator.serviceWorker.ready;
      // Reuse an existing subscription rather than creating a second endpoint
      // for the same browser.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by Chrome: we never send data-less pushes anyway.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!)
            .slice()
            .buffer as ArrayBuffer,
        }));

      const { error } = await supabase.from("push_subscriptions" as never).upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          p256dh: keyToBase64(subscription.getKey("p256dh")),
          auth: keyToBase64(subscription.getKey("auth")),
          // So a nudge lands in the learner's evening, not at UTC midnight.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
          user_agent: navigator.userAgent.slice(0, 300),
          // Re-subscribing revives an endpoint the sender previously retired.
          disabled_at: null,
        } as never,
        { onConflict: "user_id,endpoint" },
      );
      if (error) throw error;

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.warn("Push subscribe failed:", err);
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [isSupported, user]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!isSupported) return;
    setIsBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Drop the server row first: a browser-side unsubscribe that isn't
        // mirrored server-side leaves the sender pushing into the void.
        if (user) {
          await supabase
            .from("push_subscriptions" as never)
            .delete()
            .eq("user_id", user.id)
            .eq("endpoint", subscription.endpoint);
        }
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
    } catch (err) {
      console.warn("Push unsubscribe failed:", err);
    } finally {
      setIsBusy(false);
    }
  }, [isSupported, user]);

  return { isSupported, permission, isSubscribed, isBusy, subscribe, unsubscribe };
}
