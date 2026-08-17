/**
 * The seven things a learner can do, and where each one lives.
 *
 * This is the whole navigation model in one file. Before it, the app spread 41
 * entries across three hub screens (تعلّم 8, تدرّب 13, أنا 20) and asked the
 * learner to read a list before doing anything. The list is gone: four skills
 * on the chooser, three verbs reachable from everywhere, and the long tail
 * still routable by URL but no longer competing for attention.
 *
 * Skills and verbs are deliberately separate types. The four skills are a
 * closed, permanent set — the classic language quadrant — and each one owns a
 * full page because speaking needs a mic and writing needs a keyboard. The
 * verbs are utilities you apply to whatever is in front of you, so they repeat
 * in the dock and on the chooser without confusing anything.
 */

export interface Surface {
  id: string;
  /** Arabic label — this is chrome, so it is the learner's language. */
  label: string;
  /** English word, set in the wordmark's face on the chooser tiles. */
  latin: string;
  to: string;
  /** Lucide icon name, resolved at the call site to keep this file data-only. */
  icon: string;
}

/** The four language skills. Order is the one every syllabus uses. */
export const SKILLS: Surface[] = [
  { id: "listen", label: "استماع", latin: "Listen", to: "/listening", icon: "Headphones" },
  { id: "read", label: "قراءة", latin: "Read", to: "/reading", icon: "BookOpen" },
  { id: "speak", label: "تحدّث", latin: "Speak", to: "/pronunciation", icon: "Mic" },
  { id: "write", label: "كتابة", latin: "Write", to: "/write", icon: "PenLine" },
];

/** Verbs, not places. They act on whatever the learner is looking at. */
export const VERBS: Surface[] = [
  { id: "upload", label: "ارفع", latin: "Upload", to: "/tutor-upload", icon: "Upload" },
  { id: "ask", label: "اسأل", latin: "Ask", to: "/how-do-i-say", icon: "MessageCircleQuestion" },
  { id: "games", label: "ألعاب", latin: "Games", to: "/vocab-games", icon: "Gamepad2" },
];

/**
 * The curriculum, held back on purpose.
 *
 * A path is sequential and a feed is the opposite of sequential, so the
 * lessons do not belong in either. They get their own door — announced now so
 * the shape of the app is honest, and disabled until it is actually ready.
 */
export const LEARNING_PATH = {
  id: "path",
  label: "مسار التعلّم",
  latin: "Learning path",
  to: "/curriculum",
  icon: "Route",
  soon: true,
} as const;
