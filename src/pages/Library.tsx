import { Link } from "react-router-dom";
import {
  Headphones, BookOpen, Mic, PenLine, Play,
  Upload, Gamepad2, BookOpenText, Route as RouteIcon, Lock,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { SKILLS, SHELVES, LEARNING_PATH } from "@/lib/surfaces";
import { cn } from "@/lib/utils";

/**
 * The library: everything a learner learns *from*.
 *
 * It took over from the chooser (/choose), which was the best-received screen
 * in the old app — four skill blocks you cannot mistake for each other — but
 * which lived in a forced dark theme borrowed from the feed, so the app
 * changed colour every time you moved between tabs. The blocks stay; the page
 * is on the same light ground as every other tab.
 *
 * The clips feed used to be the front door. It now sits here, as the first
 * thing on the shelf, because "what should I do today" is the Today tab's
 * question and "what can I watch" is this one's.
 */

const ICONS = {
  Headphones, BookOpen, Mic, PenLine, Upload, Gamepad2, BookOpenText, Route: RouteIcon,
} as const;

/** Two tones of the brand, alternating diagonally — no rainbow. */
const TILE_BG = ["bg-primary", "bg-secondary", "bg-secondary", "bg-primary"];

const Library = () => (
  <AppShell>
    <header className="mb-5 flex items-center gap-3">
      <ProfileEmblem />
      <h1 className="text-[26px] leading-[38px]">المكتبة</h1>
    </header>

    {/* The feed, as a shelf rather than as the front door. */}
    <Link
      to="/feed"
      className={cn(
        "relative mb-3 flex items-center gap-4 overflow-hidden rounded-3xl bg-secondary p-5 text-white",
        "transition-transform active:scale-[0.99]",
      )}
    >
      <span aria-hidden className="absolute -end-10 -top-12 h-36 w-36 rounded-full bg-primary" />
      <span className="relative flex-1">
        <span className="block text-xl font-bold leading-8">مقاطع لك</span>
        <span className="block text-sm leading-6 text-white/80">
          إنجليزي حقيقي، مقطع ورا مقطع
        </span>
      </span>
      <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-secondary">
        <Play className="h-5 w-5 fill-current" />
      </span>
    </Link>

    {/* The four skills. Each one is a full page, never a sheet: speaking
        needs a microphone and writing needs a keyboard, and both deserve the
        whole screen. */}
    <div className="grid grid-cols-2 gap-3">
      {SKILLS.map((s, i) => {
        const Icon = ICONS[s.icon as keyof typeof ICONS];
        return (
          <Link
            key={s.id}
            to={s.to}
            className={cn(
              "flex h-28 flex-col justify-between rounded-3xl p-4 text-white",
              "transition-transform active:scale-[0.98]",
              TILE_BG[i],
            )}
          >
            <Icon className={cn("h-6 w-6", i % 3 === 0 ? "text-white/90" : "text-accent")} />
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[22px] font-bold leading-8">{s.label}</span>
              {/* English, untracked: letter-spacing on this label is what used
                  to render "Listen" as "Liste n". */}
              <span dir="ltr" className="font-english text-sm font-semibold text-white/80">
                {s.latin}
              </span>
            </span>
          </Link>
        );
      })}
    </div>

    {/* The rest of the shelf. Deliberately a different, smaller shape — these
        are kinds of content and tools, not peers of a skill. */}
    <div className="mt-3 grid grid-cols-3 gap-3">
      {SHELVES.map((v) => {
        const Icon = ICONS[v.icon as keyof typeof ICONS];
        return (
          <Link
            key={v.id}
            to={v.to}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card py-4 transition-colors hover:bg-muted"
          >
            <Icon className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{v.label}</span>
          </Link>
        );
      })}
    </div>

    {/* Announced, not hidden. A path is sequential and the rest of the
        library is not, so the lessons get their own door — visible now so
        the shape of the app is honest, disabled until it is genuinely ready. */}
    <div
      aria-disabled="true"
      className="mt-3 flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3.5"
    >
      <RouteIcon className="h-5 w-5 text-muted-foreground" />
      <span className="flex-1">
        <span className="block text-sm font-medium">{LEARNING_PATH.label}</span>
        <span className="block text-xs text-muted-foreground">دروس مرتّبة من البداية للنهاية</span>
      </span>
      <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        <Lock className="h-3 w-3" />
        قريباً
      </span>
    </div>
  </AppShell>
);

export default Library;
