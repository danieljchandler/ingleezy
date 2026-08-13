import { useCallback, useEffect, useState } from "react";
import {
  HOME_SECTIONS,
  HomeLayoutState,
  HomeSectionId,
  loadHomeLayout,
  saveHomeLayout,
} from "@/lib/homeLayout";

/**
 * React hook for the user's home-page layout (order + hidden sections).
 * Persists to localStorage and syncs across components in the same tab via a
 * custom event, plus across tabs via the native `storage` event.
 */
export function useHomeLayout() {
  const [state, setState] = useState<HomeLayoutState>(() => loadHomeLayout());

  useEffect(() => {
    const sync = () => setState(loadHomeLayout());
    window.addEventListener("hakiya:home-layout-changed", sync as EventListener);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("hakiya:home-layout-changed", sync as EventListener);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((next: HomeLayoutState) => {
    setState(next);
    saveHomeLayout(next);
  }, []);

  const toggleSection = useCallback(
    (id: HomeSectionId) => {
      const meta = HOME_SECTIONS.find((s) => s.id === id);
      if (meta?.alwaysOn) return;
      const hidden = state.hidden.includes(id)
        ? state.hidden.filter((x) => x !== id)
        : [...state.hidden, id];
      update({ ...state, hidden });
    },
    [state, update],
  );

  const moveSection = useCallback(
    (id: HomeSectionId, direction: -1 | 1) => {
      const idx = state.order.indexOf(id);
      if (idx < 0) return;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= state.order.length) return;
      const order = [...state.order];
      [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
      update({ ...state, order });
    },
    [state, update],
  );

  const reset = useCallback(() => {
    update({ order: HOME_SECTIONS.map((s) => s.id), hidden: [] });
  }, [update]);

  return { state, toggleSection, moveSection, reset };
}
