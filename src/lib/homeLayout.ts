// Shared config & persistence for the home page section layout.
// Users can hide/show sections and reorder them from Settings.
//
// This list previously carried ~20 additional ids (discover, new-words,
// review, grammar, meme, transcribe, ...) that Settings let users toggle and
// reorder, but Index.tsx never actually gated any of them behind
// isSectionVisible/order — toggling them did nothing on the home page. The
// list now only contains ids Index actually renders conditionally on.

export type HomeSectionId =
  | "placement-banner"
  | "daily-queue"
  | "phrase-of-the-day";

export interface HomeSectionMeta {
  id: HomeSectionId;
  label: string;
  description: string;
  /** Sections that should never be hidden (still reorderable). */
  alwaysOn?: boolean;
}

/** Default order — matches the historical layout. */
export const HOME_SECTIONS: HomeSectionMeta[] = [
  { id: "placement-banner", label: "تنبيه اختبار المستوى", description: "يظهر حتى تكمل الاختبار", alwaysOn: true },
  { id: "daily-queue", label: "مهام اليوم", description: "مهامك اليومية وحلقة الهدف والسلسلة والإحصاءات", alwaysOn: true },
  { id: "phrase-of-the-day", label: "عبارة اليوم", description: "عبارة إنجليزية جديدة كل يوم" },
];

const STORAGE_KEY = "ingleezy:home-layout:v1";

export interface HomeLayoutState {
  /** Ordered list of section ids. */
  order: HomeSectionId[];
  /** Section ids that the user has explicitly hidden. */
  hidden: HomeSectionId[];
}

const DEFAULT_STATE: HomeLayoutState = {
  order: HOME_SECTIONS.map((s) => s.id),
  hidden: [],
};

export function loadHomeLayout(): HomeLayoutState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<HomeLayoutState>;
    const validIds = new Set(HOME_SECTIONS.map((s) => s.id));
    // Filter unknown ids and append any new sections at the end.
    const cleanOrder = (parsed.order ?? []).filter((id): id is HomeSectionId =>
      validIds.has(id as HomeSectionId),
    );
    const missing = HOME_SECTIONS.map((s) => s.id).filter((id) => !cleanOrder.includes(id));
    const hidden = (parsed.hidden ?? []).filter((id): id is HomeSectionId =>
      validIds.has(id as HomeSectionId),
    );
    return { order: [...cleanOrder, ...missing], hidden };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveHomeLayout(state: HomeLayoutState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("ingleezy:home-layout-changed"));
  } catch {
    // ignore quota/private-mode errors
  }
}

export function isSectionVisible(id: HomeSectionId, state: HomeLayoutState): boolean {
  const meta = HOME_SECTIONS.find((s) => s.id === id);
  if (meta?.alwaysOn) return true;
  return !state.hidden.includes(id);
}
