import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Check, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/uiPrefs";

interface LetterTracerProps {
  letter: string;
  onComplete?: () => void;
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
}

/**
 * Finger-tracing canvas. Renders the target letter as a giant guide glyph
 * (via Canvas text), the user draws over it with finger/mouse, and we
 * estimate coverage by sampling the user's strokes against the letter's
 * filled pixels. When coverage crosses a threshold, completion fires.
 *
 * This is intentionally lightweight — no per-letter authored stroke paths.
 * It scales to all 28 letters with no extra data.
 */
export const LetterTracer = ({ letter, onComplete }: LetterTracerProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const guideRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const completedRef = useRef(false);
  const [coverage, setCoverage] = useState(0);
  const [done, setDone] = useState(false);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const sparkleIdRef = useRef(0);
  const lastSparkleAtRef = useRef(0);
  /**
   * Every fade timer still in flight, so unmount can cancel them.
   *
   * Each spark schedules a 750ms `setSparkles` to fade its own trail, and one
   * stroke schedules a dozen. Nothing cancelled them, so a learner who traced a
   * letter and immediately moved on left up to a dozen callbacks setting state
   * on a component that no longer exists. Under a test runner that tears the
   * DOM down between files it is worse than a warning: the callback lands after
   * jsdom is gone and takes the whole run down with `ReferenceError: window is
   * not defined`, which is exactly how this component first turned CI red while
   * every test passed.
   */
  const sparkleTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      sparkleTimersRef.current.forEach((id) => window.clearTimeout(id));
      sparkleTimersRef.current = [];
    };
  }, []);
  const reducedMotion = prefersReducedMotion();


  const SIZE = 320;

  // Render guide glyph once per letter
  useEffect(() => {
    const guide = document.createElement("canvas");
    guide.width = SIZE;
    guide.height = SIZE;
    const gctx = guide.getContext("2d")!;
    gctx.clearRect(0, 0, SIZE, SIZE);
    gctx.fillStyle = "#000";
    gctx.font = "260px 'Noto Sans Arabic', serif";
    gctx.textAlign = "center";
    gctx.textBaseline = "middle";
    gctx.fillText(letter, SIZE / 2, SIZE / 2 + 10);
    guideRef.current = guide;

    // Reset user canvas
    const c = canvasRef.current;
    if (c) {
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, SIZE, SIZE);
    }
    completedRef.current = false;
    setCoverage(0);
    setDone(false);
  }, [letter]);

  const getPoint = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIZE,
      y: ((e.clientY - rect.top) / rect.height) * SIZE,
    };
  };

  const computeCoverage = useCallback(() => {
    const c = canvasRef.current;
    const guide = guideRef.current;
    if (!c || !guide) return 0;
    const userData = c.getContext("2d")!.getImageData(0, 0, SIZE, SIZE).data;
    const guideData = guide.getContext("2d")!.getImageData(0, 0, SIZE, SIZE).data;
    let total = 0;
    let hit = 0;
    // Sample every 4px for performance
    for (let y = 0; y < SIZE; y += 4) {
      for (let x = 0; x < SIZE; x += 4) {
        const i = (y * SIZE + x) * 4;
        const guideAlpha = guideData[i + 3];
        if (guideAlpha > 50) {
          total++;
          // user pixel: check this pixel and its 4 neighbours for ink
          const inkHere = userData[i + 3] > 50;
          if (inkHere) {
            hit++;
          }
        }
      }
    }
    return total > 0 ? hit / total : 0;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPtRef.current = getPoint(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const pt = getPoint(e);
    const last = lastPtRef.current ?? pt;
    ctx.strokeStyle = "hsl(var(--primary))";
    ctx.lineWidth = 28;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;

    // Emit sparkles along the stroke (throttled), in canvas-space %
    if (!reducedMotion) {
      const now = performance.now();
      if (now - lastSparkleAtRef.current > 55) {
        lastSparkleAtRef.current = now;
        const id = ++sparkleIdRef.current;
        const sp: Sparkle = {
          id,
          x: (pt.x / SIZE) * 100,
          y: (pt.y / SIZE) * 100,
        };
        setSparkles((prev) => [...prev.slice(-12), sp]);
        const timer = window.setTimeout(() => {
          sparkleTimersRef.current = sparkleTimersRef.current.filter((t) => t !== timer);
          setSparkles((prev) => prev.filter((s) => s.id !== id));
        }, 750);
        sparkleTimersRef.current.push(timer);
      }
    }
  };


  const onPointerUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
    const cov = computeCoverage();
    setCoverage(cov);
    if (cov >= 0.55 && !completedRef.current) {
      completedRef.current = true;
      setDone(true);
      onComplete?.();
    }
  };

  const reset = () => {
    const c = canvasRef.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, SIZE, SIZE);
    setCoverage(0);
    setDone(false);
    completedRef.current = false;
    setSparkles([]);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Direction hint: Arabic is written right-to-left */}
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>Trace right-to-left</span>
        <ArrowLeft className="h-3.5 w-3.5 animate-pulse" />
      </div>
      <div
        className="relative rounded-2xl border-2 border-dashed border-primary/30 bg-card overflow-hidden"
        style={{ width: SIZE, height: SIZE, maxWidth: "90vw", aspectRatio: "1" }}
      >
        {/* Guide glyph */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none text-foreground/15"
          style={{ fontFamily: "'Noto Sans Arabic', serif", fontSize: 260, lineHeight: 1 }}
        >
          {letter}
        </div>
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          className={cn(
            "absolute inset-0 w-full h-full touch-none cursor-crosshair",
            done && "animate-correct-pulse rounded-2xl",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {/* Sparkle trail overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {sparkles.map((s) => (
            <span
              key={s.id}
              className="absolute h-2 w-2 rounded-full bg-yellow-300 animate-sparkle"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                transform: "translate(-50%, -50%)",
                boxShadow: "0 0 6px hsl(48 95% 60% / 0.9)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-[320px] space-y-2">
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300",
              done ? "bg-green-500" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, Math.round((coverage / 0.55) * 100))}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
          </Button>
          {done && (
            <span className="text-sm font-semibold text-green-600 flex items-center gap-1 animate-fade-in">
              <Check className="h-4 w-4" /> Nice tracing!
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
