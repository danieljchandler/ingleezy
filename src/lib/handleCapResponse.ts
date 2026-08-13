/**
 * Helpers for handling 429 "daily_limit_reached" responses from capped edge
 * functions. Edge functions return JSON:
 *   { error: "daily_limit_reached", message, key, count, limit, upgrade_url }
 *
 * Usage with supabase.functions.invoke:
 *   const { data, error } = await supabase.functions.invoke("generate-flashcard-image", { body });
 *   if (showCapToastIfLimited(error, data)) return;
 *
 * The supabase-js client surfaces non-2xx as FunctionsHttpError with a context
 * containing the raw Response, so we parse defensively.
 */
import { toast } from "sonner";

interface CapBody {
  error?: string;
  message?: string;
  limit?: number;
  key?: string;
  upgrade_url?: string;
}

function isCapBody(b: unknown): b is CapBody {
  return !!b && typeof b === "object" && (b as CapBody).error === "daily_limit_reached";
}

function navigateToPricing() {
  if (typeof window !== "undefined") window.location.assign("/pricing");
}

/**
 * Inspect a supabase.functions.invoke result. If it represents a daily cap
 * hit, show the upgrade toast and return true. Caller should bail out.
 */
export function showCapToastIfLimited(error: unknown, data: unknown): boolean {
  // Newer supabase-js exposes raw response on error.context
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx === "object" && "status" in ctx && (ctx as Response).status === 429) {
    void (async () => {
      try {
        const body = (await (ctx as Response).clone().json()) as CapBody;
        showCapToast(body);
      } catch {
        showCapToast({ message: "Daily free limit reached." });
      }
    })();
    return true;
  }
  if (isCapBody(data)) {
    showCapToast(data);
    return true;
  }
  return false;
}

export function showCapToast(body: CapBody) {
  toast.error("Daily free limit reached", {
    description:
      body.message ||
      (body.limit
        ? `You've used your ${body.limit} free uses for today. Upgrade for unlimited.`
        : "Upgrade for unlimited access."),
    action: {
      label: "Upgrade",
      onClick: navigateToPricing,
    },
    duration: 8000,
  });
}
