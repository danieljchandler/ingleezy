import { NavLink, useLocation } from "react-router-dom";
import { Sparkles, GraduationCap, Play, Brain, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { AR } from "@/lib/strings";

const TABS = [
  // The daily task queue lives directly on this tab (Index.tsx) — labeled
  // "home" since it also carries onboarding/explore content, not "Today".
  { to: "/", label: AR.nav.home, icon: Sparkles, match: (p: string) => p === "/", tourId: "nav-today" },
  { to: "/learn-hub", label: AR.nav.learn, icon: GraduationCap, match: (p: string) => p.startsWith("/learn-hub"), tourId: "nav-learn" },
  { to: "/discover", label: AR.nav.discover, icon: Play, match: (p: string) => p === "/discover", tourId: "nav-discover" },
  { to: "/practice", label: AR.nav.practice, icon: Brain, match: (p: string) => p.startsWith("/practice"), tourId: "nav-practice" },
  { to: "/me", label: AR.nav.me, icon: User, match: (p: string) => p.startsWith("/me"), tourId: "nav-me" },
];

/**
 * Routes where the bottom nav should be hidden so focused flows stay
 * edge-to-edge (video playback, review, quiz, auth, etc.).
 */
const HIDE_PATTERNS: RegExp[] = [
  /^\/discover\/[^/]+/,
  /^\/review(\/|$)/,
  /^\/quiz\//,
  /^\/stories\/[^/]+/,
  /^\/learn\/[^/]+/,
  /^\/battles\/[^/]+/,
  /^\/listen\/[^/]+/,
  /^\/alphabet\/[^/]+/,
  /^\/auth$/,
  /^\/onboarding$/,
  /^\/reset-password$/,
  /^\/admin(\/|$)/,
  /^\/quiz$/,
  /^\/set-phrases\/practice/,
  /^\/set-phrases\/review/,
  /^\/today\/story/,
];

export function shouldShowBottomNav(pathname: string) {
  return !HIDE_PATTERNS.some((re) => re.test(pathname));
}

export function BottomNav() {
  const { pathname } = useLocation();
  if (!shouldShowBottomNav(pathname)) return null;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-[#5C3A46]/15 bg-[#F9F7F2]/95 backdrop-blur supports-[backdrop-filter]:bg-[#F9F7F2]/85"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around px-2 pt-1.5 pb-1">
        {TABS.map(({ to, label, icon: Icon, match, tourId }) => {
          const active = match(pathname);
          return (
            <li key={to} className="flex-1" data-tour={tourId}>
              <NavLink
                to={to}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 py-1.5 px-2 mx-0.5 rounded-2xl text-[11px] transition-all",
                  active
                    ? "text-[#5C3A46] font-semibold bg-[#5C3A46]/8"
                    : "text-[#5C3A46]/55 font-medium hover:text-[#5C3A46]/80 hover:bg-[#5C3A46]/4",
                )}
              >
                <Icon
                  className={cn("h-5 w-5 transition-transform", active && "scale-110")}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span className="leading-none">{label}</span>
                {active && (
                  <span
                    className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[#5C3A46]"
                    aria-hidden
                  />
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

