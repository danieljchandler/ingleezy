/**
 * What the library offers, and where each thing lives.
 *
 * Before the chooser, the app spread 41 entries across three hub screens and
 * asked the learner to read a list before doing anything. The list is gone:
 * the library carries the clips feed, the four skills and three shelves, and
 * the long tail stays routable by URL without competing for attention. The
 * speaking tools moved to the تكلّم tab (/talk), which is why "ask" is no
 * longer here.
 *
 * Skills and shelves are deliberately separate types. The four skills are a
 * closed, permanent set — the classic language quadrant — and each one owns a
 * full page because speaking needs a mic and writing needs a keyboard. The
 * shelves are kinds of content and tools, so they are drawn smaller.
 */

export interface Surface {
  id: string;
  /** Arabic label — this is chrome, so it is the learner's language. */
  label: string;
  /** English word, set in the English content face on the library tiles. */
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

/** The rest of the shelf: content you browse and tools you bring content to. */
export const SHELVES: Surface[] = [
  { id: "stories", label: "قصص", latin: "Stories", to: "/stories", icon: "BookOpenText" },
  { id: "games", label: "ألعاب", latin: "Games", to: "/vocab-games", icon: "Gamepad2" },
  { id: "upload", label: "ارفع مقطع", latin: "Upload", to: "/tutor-upload", icon: "Upload" },
];

/**
 * The curriculum, held back on purpose.
 *
 * A path is sequential and a library is the opposite of sequential, so the
 * lessons do not belong on its shelves. They get their own door — announced now so
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
