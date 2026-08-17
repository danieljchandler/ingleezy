import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {X} from "lucide-react";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";
import { AR } from "@/lib/strings";

const TOUR_KEY = "ingleezy:tourCompleted";
const TRIGGER_KEY = "ingleezy:showTour";

export function markTourPending() {
  try { localStorage.setItem(TRIGGER_KEY, "1"); } catch {}
}

interface Step {
  selector: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "center";
}

/**
 * The first thing a new learner sees, so it is also the first place the app
 * gets to be in their language. Each step names the slot it is pointing at
 * using the same word the slot itself uses — a tour that calls it something
 * else is describing a screen the reader cannot find.
 *
 * Four steps, not five. The old tour walked five tabs because the old nav had
 * five places to explain; a feed you scroll needs no explaining, so the steps
 * are only the things that are not obvious from looking: where the skills
 * went, that upload takes your own video, and that the mark is your account.
 */
const STEPS: Step[] = [
  {
    selector: "[data-tour='nav-feed']",
    title: "الرئيسية",
    body: "مقاطع حقيقية بالإنجليزي، واحد ورا الثاني. مرّر لفوق للي بعده، واضغط أي مقطع عشان النص والترجمة.",
    placement: "top",
  },
  {
    selector: "[data-tour='nav-choose']",
    title: "المهارات",
    body: "استماع، قراءة، تحدّث، وكتابة — كل وحدة لها صفحتها. تقدر توصلها من هنا أو تسحب الشاشة لجهة اليسار.",
    placement: "top",
  },
  {
    selector: "[data-tour='nav-upload']",
    title: "ارفع",
    body: "عندك مقطع تحبه؟ ارفعه وإحنا نحوّله لدرس — نص، كلمات، وتمارين من نفس الفيديو.",
    placement: "top",
  },
  {
    selector: "[data-tour='emblem']",
    title: "حسابك",
    body: "شعار إنجليزي فوق يوديك لحسابك: كلماتك المحفوظة، تقدّمك، والإعدادات. ولمّا يصير عندك جديد، تلقى حوله دايرة.",
    placement: "bottom",
  },
];

interface Rect { top: number; left: number; width: number; height: number }

export function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    try {
      const done = localStorage.getItem(TOUR_KEY);
      const pending = localStorage.getItem(TRIGGER_KEY);
      if (!done && pending) {
        // Defer to let nav mount
        setTimeout(() => setActive(true), 400);
      }
    } catch {}
  }, []);

  const step = STEPS[stepIdx];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [active, measure, stepIdx]);

  const finish = () => {
    try {
      localStorage.setItem(TOUR_KEY, "1");
      localStorage.removeItem(TRIGGER_KEY);
    } catch {}
    setActive(false);
  };

  const next = () => {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else finish();
  };

  if (!active) return null;

  const PAD = 8;
  const highlight = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Tooltip positioning: above the highlight, but if tight to top, below.
  const tooltipTop = highlight
    ? highlight.top > 220
      ? highlight.top - 180
      : highlight.top + highlight.height + 12
    : window.innerHeight / 2 - 90;

  return createPortal(
    <div className="fixed inset-0 z-[9999]" aria-modal="true" role="dialog">
      {/* Dim overlay with cutout via box-shadow trick */}
      {highlight ? (
        <div
          className="absolute rounded-2xl pointer-events-none transition-all duration-300"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: "0 0 0 9999px rgba(15, 12, 20, 0.65)",
            outline: "2px solid rgba(255,255,255,0.85)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/65" />
      )}

      {/* Tooltip */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-[min(360px,90vw)] rounded-2xl bg-white shadow-2xl border border-[#2C3B74]/20 p-4 animate-in fade-in zoom-in-95 duration-200"
        style={{ top: tooltipTop }}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-bold text-foreground">{step.title}</h3>
          <button
            onClick={finish}
            className="text-muted-foreground hover:text-foreground -mt-1 -me-1 p-1"
            aria-label="تخطّى الجولة"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIdx ? "w-5 bg-[#2C3B74]" : "w-1.5 bg-[#2C3B74]/25"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={finish} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
              تخطّي
            </button>
            <Button size="sm" onClick={next} className="h-8">
              {stepIdx === STEPS.length - 1 ? "خلصنا" : "التالي"}
              {stepIdx < STEPS.length - 1 && <ChevronOpen className="h-3.5 w-3.5 ms-0.5" />}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-2 text-center">
          خطوة {stepIdx + 1} من {STEPS.length}
        </p>
      </div>
    </div>,
    document.body
  );
}
