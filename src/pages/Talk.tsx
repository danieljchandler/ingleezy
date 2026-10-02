import { Link } from "react-router-dom";
import { Phone, MessageCircleQuestion, Mic, AudioLines, MessagesSquare, type LucideIcon } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileEmblem } from "@/components/shell/ProfileEmblem";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";
import { DailySoundGoalRing } from "@/components/sounds/DailySoundGoalRing";
import { cn } from "@/lib/utils";

/**
 * تكلّم: everything a learner *says*.
 *
 * The tab exists because "ask" used to have four doors (a dock slot, a
 * floating button, the feed's rail and a chooser tile) while the tutor call,
 * the app's most direct speaking practice, had none in the navigation at all.
 *
 * It is a short page rather than a straight link to /conversation on purpose:
 * that page starts a live voice call the moment it loads, which is right when
 * you chose to call and wrong when you only tapped a tab. So the call is the
 * big card here, one deliberate tap away.
 */

interface Tool {
  to: string;
  title: string;
  body: string;
  icon: LucideIcon;
}

const TOOLS: Tool[] = [
  {
    to: "/how-do-i-say",
    title: "كيف أقول…؟",
    body: "اكتب اللي تبي تقوله بلهجتك، ونعطيك الإنجليزي اللي يقولونه فعلاً.",
    icon: MessageCircleQuestion,
  },
  {
    to: "/pronunciation",
    title: "النطق",
    body: "سجّل صوتك وشوف وين نطقك صح ووين يحتاج شغل.",
    icon: Mic,
  },
  {
    to: "/sounds",
    title: "أصوات الإنجليزي",
    body: "الأصوات اللي ما فيها العربي، مثل p و v، صوت صوت.",
    icon: AudioLines,
  },
  {
    to: "/saved-chats",
    title: "محادثاتك المحفوظة",
    body: "ارجع لمحادثة سابقة مع المعلّم.",
    icon: MessagesSquare,
  },
];

const Talk = () => (
  <AppShell>
    <header className="mb-5 flex items-center gap-3">
      <ProfileEmblem />
      <h1 className="text-[26px] leading-[38px]">تكلّم</h1>
    </header>

    <section
      aria-labelledby="talk-call"
      className="relative mb-4 overflow-hidden rounded-[28px] bg-primary p-5 text-primary-foreground shadow-card"
    >
      <span aria-hidden className="absolute -start-12 -bottom-16 h-40 w-40 rounded-full bg-black/10" />
      <div className="relative">
        <h2 id="talk-call" className="text-[22px] leading-8 text-primary-foreground">
          مكالمة مع المعلّم
        </h2>
        <p className="mt-1 text-[15px] leading-6 text-primary-foreground/85">
          تكلّم بالإنجليزي عن أي موضوع، وتجيك التصحيحات بلهجتك.
        </p>
        <Link
          to="/conversation"
          className={cn(
            "mt-4 flex h-14 items-center justify-center gap-2 rounded-full bg-card text-lg font-semibold text-primary",
            "transition-transform active:scale-[0.98]",
          )}
        >
          <Phone className="h-5 w-5" />
          ابدأ المكالمة
        </Link>
      </div>
    </section>

    <ul className="overflow-hidden rounded-3xl border border-border bg-card">
      {TOOLS.map(({ to, title, body, icon: Icon }) => (
        <li key={to} className="border-b border-border last:border-0">
          <Link to={to} className="flex items-center gap-3.5 px-4 py-4 transition-colors hover:bg-muted">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold leading-6">{title}</span>
              <span className="block text-sm leading-6 text-muted-foreground">{body}</span>
            </span>
            <ChevronOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>

    {/* Today's progress on the sounds trail. It sat on the old home page as a
        third progress ring; here it is next to the practice it measures. */}
    <Link to="/sounds" className="mt-3 block" aria-label="أصوات اليوم">
      <DailySoundGoalRing className="w-full" />
    </Link>
  </AppShell>
);

export default Talk;
