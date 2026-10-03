import { Link } from "react-router-dom";
import { Upload, Gamepad2, BookOpenText, Route as RouteIcon, Lock, Play } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { Art, type ArtName } from "@/components/brand/Art";
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
 * Three shapes for three kinds of thing, so the eye never compares unlike
 * things: the shelves (stories, games, upload) are a row of chips, the clips
 * feed is one big card with its art, and the four skills are art cards two by
 * two. The clips feed used to be the front door; it sits here now because
 * "what should I do today" is the Today tab's question and "what can I
 * watch" is this one's.
 */

const SHELF_ICONS = { BookOpenText, Gamepad2, Upload } as const;

/** Each skill's object from the illustration set. */
const SKILL_ART: Record<string, ArtName> = {
  listen: "headphones",
  read: "book",
  speak: "mic",
  write: "bubbles",
};

/** Alternate the two panel washes so neighbouring cards do not match. */
const SKILL_WASH = ["bg-wash-panel", "bg-wash-panel-alt", "bg-wash-panel-alt", "bg-wash-panel"];

const Library = () => (
  <AppShell>
    <header className="mb-4 flex items-start gap-3">
      <ProfileEmblem className="mt-1" />
      <div className="min-w-0 flex-1">
        <h1 className="text-[30px] leading-[44px]">المكتبة</h1>
        <p className="text-sm leading-[22px] text-muted-foreground">مقاطع وقصص على مستواك، من كلام الناس الحقيقي.</p>
      </div>
    </header>

    {/* The shelves: kinds of content and tools, as chips. */}
    <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {SHELVES.map((v) => {
        const Icon = SHELF_ICONS[v.icon as keyof typeof SHELF_ICONS];
        return (
          <Link
            key={v.id}
            to={v.to}
            className="flex h-[52px] shrink-0 items-center gap-2 rounded-full bg-card pe-4 ps-1.5 text-sm font-semibold text-foreground no-underline shadow-soft transition-transform active:scale-[0.98]"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-tint-firoza text-primary dark:text-foreground">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            {v.label}
          </Link>
        );
      })}
    </div>

    {/* The feed, as the first and biggest shelf rather than the front door. */}
    <Link
      to="/feed"
      className="mb-5 block overflow-hidden rounded-[28px] bg-card text-foreground no-underline shadow-card transition-transform active:scale-[0.99]"
    >
      <span className="relative flex h-[156px] items-center justify-center bg-wash-panel">
        <Art name="headphones" eager className="h-[150px] w-[150px]" />
        <span
          aria-hidden
          className="absolute bottom-3.5 start-3.5 grid h-11 w-11 place-items-center rounded-full bg-card text-foreground shadow-soft"
        >
          <Play className="h-[18px] w-[18px] fill-current" />
        </span>
      </span>
      <span className="block px-4 pb-3.5 pt-3">
        <span className="block font-heading text-[20px] leading-[30px]">مقاطع لك</span>
        <span className="block text-[13px] leading-5 text-muted-foreground">إنجليزي حقيقي، مقطع ورا مقطع</span>
      </span>
    </Link>

    {/* The four skills. Each one is a full page, never a sheet: speaking
        needs a microphone and writing needs a keyboard, and both deserve the
        whole screen. */}
    <h2 className="mb-2.5 px-1 font-sans text-[18px] font-semibold leading-[26px]">المهارات</h2>
    <div className="grid grid-cols-2 gap-3">
      {SKILLS.map((s, i) => (
        <Link
          key={s.id}
          to={s.to}
          className="overflow-hidden rounded-3xl bg-card text-foreground no-underline shadow-card transition-transform active:scale-[0.98]"
        >
          <span className={cn("flex h-24 items-center justify-center", SKILL_WASH[i])}>
            <Art name={SKILL_ART[s.id] ?? "bubbles"} className="h-[88px] w-[88px]" />
          </span>
          <span className="flex items-baseline justify-between gap-2 px-3.5 pb-3 pt-2.5">
            <span className="text-[17px] font-semibold leading-6">{s.label}</span>
            {/* English, untracked: letter-spacing on this label is what used
                to render "Listen" as "Liste n". */}
            <span dir="ltr" className="font-heading text-[13px] italic text-muted-foreground">
              {s.latin}
            </span>
          </span>
        </Link>
      ))}
    </div>

    {/* Announced, not hidden. A path is sequential and the rest of the
        library is not, so the lessons get their own door — visible now so
        the shape of the app is honest, disabled until it is genuinely ready. */}
    <div
      aria-disabled="true"
      className="mt-3 flex items-center gap-3 rounded-3xl border-[1.5px] border-dashed border-border px-4 py-3.5"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-muted text-muted-foreground">
        <RouteIcon className="h-5 w-5" />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">{LEARNING_PATH.label}</span>
        <span className="block text-xs text-muted-foreground">دروس مرتّبة من البداية للنهاية</span>
      </span>
      <span className="flex items-center gap-1 rounded-full bg-tint-sand px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        <Lock className="h-3 w-3" />
        قريباً
      </span>
    </div>
  </AppShell>
);

export default Library;
