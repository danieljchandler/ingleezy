import { Link, useLocation } from "react-router-dom";
import { Sun, BookOpen, MessageCircle, Layers, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Four tabs: what to do today, what to learn from, who to talk to, and what
 * you have kept.
 *
 *   اليوم   — the daily plan. The app's front door.
 *   المكتبة — everything you learn *from*: clips, the four skills, stories,
 *             games. The video feed lives here now rather than at /.
 *   تكلّم   — everything you *say*: the tutor, "how do I say…", pronunciation.
 *   كلماتي  — everything you *keep*: saved words and phrases, review, mistakes.
 *
 * It replaced a five-slot dock (الرئيسية · المهارات · اليوم · اسأل · ألعاب)
 * whose slots overlapped: "ask" had four entry points across the app, games
 * sat both here and on the chooser, and the feed and the daily plan competed
 * for "home". Four slots also leave each Arabic label room at 13px instead of
 * 10px.
 *
 * Each slot owns a set of routes, so the tab stays lit on the pages it leads
 * to (the feed lights المكتبة, /pronunciation lights تكلّم).
 *
 * Profile is absent on purpose: it lives in the emblem, top-start, where it
 * never moves.
 */

interface Slot {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes that light this tab. "/" only ever matches exactly. */
  owns: string[];
  tourId: string;
}

const SLOTS: Slot[] = [
  { to: "/", label: "اليوم", icon: Sun, owns: ["/"], tourId: "nav-today" },
  {
    to: "/library",
    label: "المكتبة",
    icon: BookOpen,
    owns: [
      "/library", "/feed", "/discover", "/listening", "/listen", "/reading",
      "/reading-library", "/stories", "/write", "/vocab-games", "/souq-news",
      "/tutor-upload", "/curriculum", "/learn",
    ],
    tourId: "nav-library",
  },
  {
    to: "/talk",
    label: "تكلّم",
    icon: MessageCircle,
    owns: ["/talk", "/conversation", "/how-do-i-say", "/pronunciation", "/sounds", "/saved-chats"],
    tourId: "nav-talk",
  },
  {
    to: "/my-words",
    label: "كلماتي",
    icon: Layers,
    owns: ["/my-words", "/set-phrases", "/mistakes", "/translate"],
    tourId: "nav-words",
  },
];

/** Whether `pathname` belongs to a slot. Exported for the tests. */
export function slotOwns(owns: string[], pathname: string): boolean {
  return owns.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Routes that take the whole screen: playback, review, quizzes, pronunciation
 * drills, the tutor chat, auth, admin. A dock over a video is four taps
 * waiting to be hit by mistake, and under the tutor chat or the pronunciation
 * drill it would sit on top of the microphone.
 */
const HIDE_PATTERNS: RegExp[] = [
  /^\/discover\/[^/]+/,
  /^\/conversation$/,
  /^\/pronunciation$/,
  /^\/review(\/|$)/,
  /^\/quiz(\/|$)/,
  /^\/stories\/[^/]+/,
  /^\/learn\/[^/]+/,
  /^\/battles\/[^/]+/,
  /^\/listen\/[^/]+/,
  /^\/sounds\/[^/]+/,
  /^\/auth$/,
  /^\/onboarding$/,
  /^\/reset-password$/,
  /^\/admin(\/|$)/,
  /^\/set-phrases\/practice/,
  /^\/set-phrases\/review/,
  /^\/today\/story/,
];

export function shouldShowDock(pathname: string) {
  return !HIDE_PATTERNS.some((re) => re.test(pathname));
}

export function AppDock({ className }: { className?: string }) {
  const { pathname } = useLocation();
  if (!shouldShowDock(pathname)) return null;

  return (
    <nav
      aria-label="التنقل الرئيسي"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4 px-2 pb-1 pt-1.5">
        {SLOTS.map(({ to, label, icon: Icon, owns, tourId }) => {
          const active = slotOwns(owns, pathname);
          return (
            <li key={to} data-tour={tourId}>
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[3.5rem] flex-col items-center justify-center gap-1 text-[13px] leading-[18px] transition-colors",
                  active
                    ? "font-semibold text-primary"
                    : "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-14 place-items-center rounded-full transition-colors",
                    active && "bg-primary/10 dark:bg-primary/20",
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
