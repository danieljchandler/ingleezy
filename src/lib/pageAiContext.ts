import { PAGE_HINTS } from "@/lib/pageHints";

/**
 * What a page tells the AI assistant about itself. Pages register this via
 * usePageAiContext(); pages that don't get a generic description resolved
 * from PAGE_HINTS by route.
 */
export interface PageAiContext {
  kind: "video" | "story" | "drill" | "word" | "phrase" | "passage" | "page";
  /** What the learner is looking at, e.g. the video or story title. */
  title: string;
  /** One or two sentences of framing (what kind of activity this is). */
  summary?: string;
  /** The material itself — current line, passage text, word + gloss. */
  content?: string;
}

export interface PageAiPayload {
  route: string;
  title: string;
  summary?: string;
  content?: string;
}

/** Flatten a payload into the plain-text context block the voice session takes. */
export function serializePagePayload(payload: PageAiPayload): string {
  return [
    `Page: ${payload.title}`,
    payload.summary && `About this page: ${payload.summary}`,
    payload.content && `On screen: ${payload.content}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Route-prefix → PAGE_HINTS key. PAGE_HINTS keys are slugs, not paths, so the
 * mapping has to be explicit. Longest prefix wins (checked in order).
 */
const ROUTE_HINTS: Array<[prefix: string, hintKey: string]> = [
  ["/review/my-words", "mywords-review"],
  ["/review/my-phrases", "my-phrases"],
  ["/review", "review"],
  ["/my-words", "my-words"],
  ["/translate", "translate"],
  ["/transcribe", "transcribe"],
  ["/my-transcriptions", "my-transcriptions"],
  ["/tutor-upload", "tutor-upload"],
  ["/meme", "meme"],
  ["/discover", "discover"],
  ["/learn-from-x", "learn-from-x"],
  ["/how-do-i-say", "how-do-i-say"],
  ["/culture-guide", "culture-guide"],
  ["/pricing", "pricing"],
  ["/pronunciation", "pronunciation"],
  ["/conversation", "conversation"],
  ["/listening", "listening-practice"],
  ["/listen", "listening-practice"],
  ["/leaderboard", "leaderboard"],
  ["/reading-library", "reading-practice"],
  ["/reading", "reading-practice"],
  ["/daily-challenge", "daily-challenge"],
  ["/analytics", "learning-analytics"],
  ["/grammar", "grammar-drills"],
  ["/vocab-games", "vocab-games"],
  ["/battles", "vocab-battles"],
  ["/settings", "settings"],
  ["/friends", "friends"],
  ["/liked-videos", "liked-videos"],
  ["/today/story", "stories"],
  ["/stories", "stories"],
  ["/souq-news", "souq-news"],
  ["/placement", "placement-quiz"],
  ["/bible/lessons", "bible-lessons"],
  ["/bible", "bible-reading"],
  ["/set-phrases", "set-phrases"],
  ["/onboarding", "onboarding"],
  ["/", "today"],
];

export function hintKeyForPath(pathname: string): string | null {
  for (const [prefix, key] of ROUTE_HINTS) {
    if (prefix === "/") {
      if (pathname === "/") return key;
      continue;
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

const cap = (s: string | undefined, max: number) =>
  s && s.length > max ? `${s.slice(0, max)}…` : s;

/**
 * Resolve what to tell the assistant about the current page: the registered
 * context when the page published one, otherwise the PAGE_HINTS blurb for the
 * route. Values are truncated client-side; the edge function re-caps them.
 */
export function buildPagePayload(
  pathname: string,
  registered: PageAiContext | null,
): PageAiPayload {
  if (registered) {
    return {
      route: pathname,
      title: cap(registered.title, 120) ?? "",
      summary: cap(registered.summary, 400),
      content: cap(registered.content, 1500),
    };
  }
  const key = hintKeyForPath(pathname);
  const hint = key ? PAGE_HINTS[key] : undefined;
  return {
    route: pathname,
    title: hint?.title ?? "Ingleezy",
    summary: cap(hint?.body, 400),
  };
}
