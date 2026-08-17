import { NavLink } from "react-router-dom";
import { Home, LayoutGrid, Plus, MessageCircleQuestion, Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Five slots, because five is what a thumb can hit.
 *
 * The seven options the app offers do not all fit here — seven on a 390px
 * screen leaves 55px each, which takes an icon but crowds an Arabic label.
 * So the four skills live on the chooser (one tap away via المهارات, or a
 * sideways swipe) and the dock carries the things you reach for mid-session.
 *
 * Profile is absent on purpose: it lives in the emblem, top-start, where it
 * never moves. That frees the fifth slot for something you actually use.
 */

const SLOTS = [
  { to: "/", label: "الرئيسية", icon: Home, exact: true },
  { to: "/choose", label: "المهارات", icon: LayoutGrid },
  { to: "/tutor-upload", label: "ارفع", icon: Plus, primary: true },
  { to: "/how-do-i-say", label: "اسأل", icon: MessageCircleQuestion },
  { to: "/vocab-games", label: "ألعاب", icon: Gamepad2 },
];

export function AppDock({ className }: { className?: string }) {
  return (
    <nav
      aria-label="التنقل الرئيسي"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-white/10",
        "bg-[#0A0F18]/92 backdrop-blur supports-[backdrop-filter]:bg-[#0A0F18]/78",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-around px-2">
        {SLOTS.map(({ to, label, icon: Icon, exact, primary }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  isActive ? "text-white" : "text-white/55 hover:text-white/80",
                )
              }
            >
              {primary ? (
                // The upload slot is a button, not a tab: it starts something
                // rather than going somewhere, and the shape says so.
                <span className="grid h-7 w-11 place-items-center rounded-lg bg-periwinkle text-[#0E131C]">
                  <Icon className="h-5 w-5" strokeWidth={2.6} />
                </span>
              ) : (
                <Icon className="h-5 w-5" />
              )}
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
