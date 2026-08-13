import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { ARABIC_LETTERS, LETTERS_BY_CODE, LETTER_STEPS, type LetterStepId } from "@/data/arabicAlphabet";
import { useAlphabetProgress } from "@/hooks/useAlphabetProgress";

import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { LetterAudioButton } from "@/components/alphabet/LetterAudioButton";
import { LetterTracer } from "@/components/alphabet/LetterTracer";
import { FourFacesPanel } from "@/components/alphabet/FourFacesPanel";
import { SpotTheLetterGame } from "@/components/alphabet/SpotTheLetterGame";
import { SoundMatchGame } from "@/components/alphabet/SoundMatchGame";
import { XPPopupHost, fireXPPopup } from "@/components/alphabet/XPPopup";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { useDialect } from "@/contexts/DialectContext";
import { Button } from "@/components/ui/button";
import { tapFeedback } from "@/lib/tapFeedback";
import { ChevronLeft, ChevronRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STEP_LABELS: Record<LetterStepId, string> = {
  meet: "Meet the letter",
  examples: "Hear & see",
  trace: "Trace it",
  faces: "Four faces",
  spot: "Spot the letter",
  sound: "Sound match",
};

const AlphabetLetter = () => {
  const navigate = useNavigate();
  const { letterCode } = useParams();
  const letter = letterCode ? LETTERS_BY_CODE[letterCode] : undefined;
  const { progress, completeStep } = useAlphabetProgress();
  const { prefs } = useDisplayPrefs();
  const { activeDialect } = useDialect();
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Record<LetterStepId, boolean>>({} as any);

  // Hydrate done from saved progress
  useEffect(() => {
    if (!letter) return;
    const row = progress[letter.code];
    if (row) {
      const map = {} as Record<LetterStepId, boolean>;
      for (const s of row.steps_completed) map[s] = true;
      setDone(map);
    }
  }, [letter, progress]);

  const next = ARABIC_LETTERS[(letter?.order_index ?? 0) + 1];

  // Only quiz with letters the learner has already reached (current + previous).
  const learnedPool = useMemo(
    () =>
      letter
        ? ARABIC_LETTERS.filter((l) => l.order_index <= letter.order_index)
        : ARABIC_LETTERS,
    [letter],
  );

  const handleStepDone = async (step: LetterStepId, extra?: { spotScore?: number; soundScore?: number }) => {
    if (!letter || done[step]) return;
    setDone((d) => ({ ...d, [step]: true }));
    fireXPPopup(5);
    try {
      await completeStep({ letterCode: letter.code, step, ...extra });
    } catch (e) {
      console.error(e);
    }
  };

  const allDone = useMemo(() => LETTER_STEPS.every((s) => done[s]), [done]);

  if (!letter) {
    return (
      <AppShell>
        <p>Letter not found.</p>
        <Button onClick={() => navigate("/alphabet")}>Back to map</Button>
      </AppShell>
    );
  }

  const step = LETTER_STEPS[stepIdx];

  return (
    <AppShell compact>
      <XPPopupHost />
      <div className="flex items-center justify-between mb-4">
        <HomeButton />
        <Button variant="ghost" size="sm" onClick={() => navigate("/alphabet")}>
          Map
        </Button>
      </div>

      {/* Step indicator dots */}
      <div className="flex items-center justify-center gap-2 mb-5">
        {LETTER_STEPS.map((s, i) => (
          <button
            key={s}
            onClick={(e) => {
              tapFeedback(e.currentTarget);
              setStepIdx(i);
            }}
            className={cn(
              "h-2 rounded-full transition-all",
              i === stepIdx ? "w-8 bg-primary" : done[s] ? "w-2 bg-green-500" : "w-2 bg-muted-foreground/30",
            )}
            aria-label={`Step ${i + 1}: ${STEP_LABELS[s]}`}
          />
        ))}
      </div>

      <header className="text-center mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Step {stepIdx + 1} of {LETTER_STEPS.length}
        </p>
        <h2 className="text-lg font-bold text-foreground mt-0.5" style={{ fontFamily: "'Montserrat', sans-serif" }}>
          {STEP_LABELS[step]}
        </h2>
      </header>

      {/* Step content */}
      <div className="min-h-[360px]">
        {step === "meet" && (
          <div className="space-y-6 text-center">
            <div
              className="text-[180px] text-primary leading-none"
              style={{ fontFamily: "'Noto Sans Arabic', serif" }}
            >
              {letter.isolated}
            </div>
            {letter.variants && letter.variants.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Also written as
                </p>
                <div className="flex flex-wrap items-start justify-center gap-3">
                  {letter.variants.map((v) => (
                    <div key={v.glyph} className="flex flex-col items-center min-w-[64px]">
                      <span
                        className="text-4xl text-foreground leading-none"
                        style={{ fontFamily: "'Noto Sans Arabic', serif" }}
                      >
                        {v.glyph}
                      </span>
                      <span className="mt-1 text-[10px] text-muted-foreground max-w-[80px] leading-tight">
                        {v.note}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              {prefs.showArabic && (
                <p className="text-3xl text-foreground" style={{ fontFamily: "'Noto Sans Arabic', serif" }}>
                  {letter.name_ar}
                </p>
              )}
              {prefs.showEnglish && (
                <p className="text-sm text-muted-foreground mt-1">
                  "{letter.name_translit}" — {letter.sound_hint}
                </p>
              )}
            </div>
            <div className="flex items-center justify-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <LetterAudioButton text={letter.name_ar} forceMsa size="lg" autoplay label="Fusha (MSA) pronunciation" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fusha</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <LetterAudioButton text={letter.name_ar} size="lg" label={`${activeDialect} pronunciation`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{activeDialect}</span>
              </div>
            </div>
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("meet"); setStepIdx(1); }} size="lg" className="w-full">
              I've heard it <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === "examples" && (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground mb-2">
              Three real words that start with this letter
            </p>
            {letter.examples.map((ex) => (
              <div
                key={ex.ar}
                className="p-4 rounded-2xl border-2 border-border bg-card flex items-center gap-3"
              >
                <LetterAudioButton text={ex.ar} size="md" label={`Play ${ex.ar}`} />
                <div className="flex-1 min-w-0 text-right" dir="rtl">
                  <p className="text-3xl text-foreground" style={{ fontFamily: "'Noto Sans Arabic', serif" }}>
                    {ex.ar}
                  </p>
                  {prefs.showEnglish && (
                    <p className="text-sm text-muted-foreground" dir="ltr">
                      {ex.translit} · {ex.en}
                    </p>
                  )}
                </div>
              </div>
            ))}
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("examples"); setStepIdx(2); }} size="lg" className="w-full mt-4">
              Got it <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === "trace" && (
          <div className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              Use your finger to trace inside the letter shape
            </p>
            <LetterTracer
              letter={letter.isolated}
              onComplete={() => handleStepDone("trace")}
            />
            <Button
              onClick={(e) => { tapFeedback(e.currentTarget); setStepIdx(3); }}
              size="lg"
              className="w-full"
              disabled={!done.trace}
              variant={done.trace ? "default" : "outline"}
            >
              {done.trace ? "Next" : "Trace it to continue"} <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === "faces" && (
          <div className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              Arabic letters change shape depending on where they appear in a word
            </p>
            <FourFacesPanel letter={letter} />
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("faces"); setStepIdx(4); }} size="lg" className="w-full mt-4">
              I see the difference <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === "spot" && (
          <div className="space-y-4">
            <SpotTheLetterGame
              letter={letter}
              pool={learnedPool}
              onComplete={(score) => handleStepDone("spot", { spotScore: score })}
            />
            {done.spot && (
              <Button onClick={(e) => { tapFeedback(e.currentTarget); setStepIdx(5); }} size="lg" className="w-full">
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        )}

        {step === "sound" && (
          <div className="space-y-6">
            <SoundMatchGame
              letter={letter}
              pool={learnedPool}
              onComplete={(score) => handleStepDone("sound", { soundScore: score })}
            />
            {done.sound && (
              <div className="space-y-3">
                {allDone && (
                  <div className="p-4 rounded-2xl bg-green-500/10 border-2 border-green-500/30 text-center">
                    <Sparkles className="h-6 w-6 text-green-600 mx-auto mb-1" />
                    <p className="font-bold text-foreground">Letter mastered!</p>
                    <p className="text-xs text-muted-foreground">+30 XP earned</p>
                  </div>
                )}
                {next ? (
                  <Button
                    onClick={(e) => {
                      tapFeedback(e.currentTarget);
                      if (allDone) {
                        toast.success(`${letter.name_translit} mastered! 🌟`);
                      }
                      navigate(`/alphabet/${next.code}`);
                    }}
                    size="lg"
                    className="w-full"
                  >
                    Next letter: {next.name_translit} <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={(e) => { tapFeedback(e.currentTarget); navigate("/alphabet"); }} size="lg" className="w-full">
                    Back to map
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            tapFeedback(e.currentTarget);
            setStepIdx(Math.max(0, stepIdx - 1));
          }}
          disabled={stepIdx === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        {done[step] && <Check className="h-4 w-4 text-green-600" />}
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            tapFeedback(e.currentTarget);
            setStepIdx(Math.min(LETTER_STEPS.length - 1, stepIdx + 1));
          }}
          disabled={stepIdx === LETTER_STEPS.length - 1}
        >
          Skip <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </AppShell>
  );
};

export default AlphabetLetter;
