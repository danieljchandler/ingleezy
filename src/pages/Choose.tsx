import { Link, useNavigate } from "react-router-dom";
import {
  Headphones, BookOpen, Mic, PenLine,
  Upload, MessageCircleQuestion, Gamepad2, Route as RouteIcon, Lock,
} from "lucide-react";
import { AppDock } from "@/components/shell/AppDock";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { SKILLS, VERBS, LEARNING_PATH } from "@/lib/surfaces";
import { useSwipeSurfaces } from "@/hooks/useSwipeSurfaces";
import { cn } from "@/lib/utils";

/**
 * The chooser: four skills, three verbs, one path that is not ready.
 *
 * This replaces three hub screens carrying 41 entries between them. What made
 * those hard was not the count so much as the sameness — every row a rounded
 * card with an icon chip, so nothing said which one mattered. Here the four
 * skills are blocks you cannot mistake for each other, the verbs are visibly a
 * different kind of thing, and the long tail is not on screen at all.
 *
 * Reached by tapping المهارات or by swiping the feed toward the start edge.
 */

const ICONS = {
  Headphones, BookOpen, Mic, PenLine, Upload, MessageCircleQuestion, Gamepad2, Route: RouteIcon,
} as const;

/** Tints, not hues: four steps through the indigo system, no rainbow. */
const TILE_BG = [
  "bg-[#2C3B74]",
  "bg-[#1D2740]",
  "bg-[#3A508E]",
  "bg-[#212C48]",
];

const Choose = () => {
  const navigate = useNavigate();
  // The chooser sits one page forward of the feed, so getting back to it is a
  // backward swipe — rightward, the way an Arabic reader means backwards. That
  // is onPrev, not onNext: wiring it to onNext would send the same physical
  // drag that opened this page to close it again.
  const swipe = useSwipeSurfaces({ onPrev: () => navigate("/") });

  return (
    <div
      {...swipe}
      className="dark min-h-[100dvh] bg-[#0B111C] pb-24 text-white"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <header className="flex items-center justify-between px-4 pt-4">
        <ProfileEmblem />
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          <span className="h-1.5 w-4 rounded-full bg-periwinkle" />
        </div>
        <Link to="/" className="text-xs text-white/55">
          الفيديو →
        </Link>
      </header>

      {/* Not .font-display: Archivo Black has no Arabic glyphs, so Arabic set
          in it falls back to Inter and inherits the italic, uppercase and
          negative tracking meant for Latin — which renders as faint, wrongly
          spaced text. The display face is for Latin and numerals only. */}
      <h1 className="px-4 pb-4 pt-5 text-[28px] font-bold leading-tight">شنو تبي تسوي؟</h1>

      {/* The four skills. Each one is a full page, never a sheet: speaking
          needs a microphone and writing needs a keyboard, and both deserve the
          whole screen rather than half of it over a playing video. */}
      <div className="grid grid-cols-2 gap-2.5 px-4">
        {SKILLS.map((s, i) => {
          const Icon = ICONS[s.icon as keyof typeof ICONS];
          return (
            <Link
              key={s.id}
              to={s.to}
              className={cn(
                "relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-2xl p-4",
                "transition-transform active:scale-[0.98]",
                TILE_BG[i],
              )}
            >
              <span className="font-display text-[11px] not-italic tracking-[0.14em] text-white/45">
                {String(i + 1).padStart(2, "0")}
              </span>
              <Icon className="absolute end-3 top-3 h-6 w-6 text-white/35" />
              <span className="flex flex-col gap-0.5">
                <span className="text-2xl font-bold leading-tight">{s.label}</span>
                <span dir="ltr" className="font-display text-[10px] tracking-wide text-white/50">
                  {s.latin}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {/* Verbs. Deliberately a different shape and size — these act on what you
          are already looking at, so they should not read as peers of a skill. */}
      <div className="mt-2.5 grid grid-cols-3 gap-2.5 px-4">
        {VERBS.map((v) => {
          const Icon = ICONS[v.icon as keyof typeof ICONS];
          return (
            <Link
              key={v.id}
              to={v.to}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] py-3.5 transition-colors active:bg-white/10"
            >
              <Icon className="h-5 w-5 text-periwinkle" />
              <span className="text-xs font-medium">{v.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Announced, not hidden. A path is sequential and the feed is not, so
          the lessons get their own door — visible now so the shape of the app
          is honest, disabled until it is genuinely ready. */}
      <div className="mt-2.5 px-4">
        <div
          aria-disabled="true"
          className="flex items-center gap-3 rounded-xl border border-dashed border-white/15 px-4 py-3.5 opacity-70"
        >
          <RouteIcon className="h-5 w-5 text-white/40" />
          <span className="flex-1">
            <span className="block text-sm font-medium">{LEARNING_PATH.label}</span>
            <span className="block text-[11px] text-white/45">
              دروس مرتّبة من البداية للنهاية
            </span>
          </span>
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold">
            <Lock className="h-3 w-3" />
            قريباً
          </span>
        </div>
      </div>

      <AppDock />
    </div>
  );
};

export default Choose;
