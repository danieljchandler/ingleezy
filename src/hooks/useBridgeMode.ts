/**
 * MSA → Dialect Bridge mode.
 *
 * When ON, the app shows the Modern Standard Arabic equivalent next to
 * dialect content wherever an `msa_form` is available (flashcards, lessons,
 * transcripts, reading, etc.). Mirrors the dialect-context pattern: the
 * source of truth is localStorage, but we sync to/from `profiles` so it
 * survives across devices for signed-in users.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "hakiya_bridge_view_enabled";
const EVENT = "hakiya:bridge-mode-changed";

function readLocal(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocal(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* no-op */
  }
}

export function useBridgeMode() {
  const [enabled, setEnabled] = useState<boolean>(readLocal);
  const [msaBackground, setMsaBackground] = useState<string>("none");

  // Sync from profile on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles" as never)
        .select("bridge_view_enabled, msa_background")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const row = data as Record<string, unknown>;
      if (typeof row.bridge_view_enabled === "boolean") {
        setEnabled(row.bridge_view_enabled);
        writeLocal(row.bridge_view_enabled);
      }
      if (typeof row.msa_background === "string") {
        setMsaBackground(row.msa_background);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to in-tab + cross-tab updates.
  useEffect(() => {
    const refresh = () => setEnabled(readLocal());
    window.addEventListener(EVENT, refresh as EventListener);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh as EventListener);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const setBridge = useCallback((on: boolean) => {
    setEnabled(on);
    writeLocal(on);
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles" as never)
        .update({ bridge_view_enabled: on } as never)
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) console.error("Failed to persist bridge preference:", error);
        });
    });
  }, []);

  const setBackground = useCallback((level: string) => {
    setMsaBackground(level);
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles" as never)
        .update({ msa_background: level } as never)
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) console.error("Failed to persist MSA background:", error);
        });
    });
  }, []);

  return { enabled, setBridge, msaBackground, setBackground };
}
