import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { ENGLISH_SOUNDS, SOUNDS_BY_CODE, SOUND_STEPS, type SoundStepId } from "@/data/englishSounds";
import { useSoundProgress } from "@/hooks/useSoundProgress";

import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { SoundAudioButton } from "@/components/sounds/SoundAudioButton";
import { MouthGuidePanel } from "@/components/sounds/MouthGuidePanel";
import { SpellingPanel } from "@/components/sounds/SpellingPanel";
import { SpotTheSoundGame } from "@/components/sounds/SpotTheSoundGame";
import { MinimalPairGame } from "@/components/sounds/MinimalPairGame";
import { XPPopupHost, fireXPPopup } from "@/components/sounds/XPPopup";
import { ChevronBack, ChevronNext } from "@/components/shared/DirectionalIcon";
import { Button } from "@/components/ui/button";
import { tapFeedback } from "@/lib/tapFeedback";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STEP_LABELS: Record<SoundStepId, string> = {
  meet: "تعرّف على الصوت",
  mouth: "شكّل الصوت",
  spell: "كيف يُكتب",
  examples: "كلمات عليه",
  spot: "اكتشف الصوت",
  contrast: "ميّز بينهما",
};

const POSITION_LABEL: Record<"initial" | "medial" | "final", string> = {
  initial: "في البداية",
  medial: "في المنتصف",
  final: "في النهاية",
};

const EnglishSound = () => {
  const navigate = useNavigate();
  const { soundCode } = useParams();
  const sound = soundCode ? SOUNDS_BY_CODE[soundCode] : undefined;
  const { progress, completeStep } = useSoundProgress();
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Record<SoundStepId, boolean>>({} as any);

  // Hydrate done from saved progress
  useEffect(() => {
    if (!sound) return;
    const row = progress[sound.code];
    if (row) {
      const map = {} as Record<SoundStepId, boolean>;
      for (const s of row.steps_completed) map[s] = true;
      setDone(map);
    }
  }, [sound, progress]);

  const next = ENGLISH_SOUNDS[(sound?.order_index ?? 0) + 1];

  const handleStepDone = async (step: SoundStepId, extra?: { spotScore?: number; soundScore?: number }) => {
    if (!sound || done[step]) return;
    setDone((d) => ({ ...d, [step]: true }));
    fireXPPopup(5);
    try {
      await completeStep({ soundCode: sound.code, step, ...extra });
    } catch (e) {
      console.error(e);
    }
  };

  const allDone = useMemo(() => SOUND_STEPS.every((s) => done[s]), [done]);

  if (!sound) {
    return (
      <AppShell>
        <p>الصوت غير موجود.</p>
        <Button onClick={() => navigate("/sounds")}>العودة إلى الخريطة</Button>
      </AppShell>
    );
  }

  const step = SOUND_STEPS[stepIdx];

  return (
    <AppShell compact>
      <XPPopupHost />
      <div className="flex items-center justify-between mb-4">
        <HomeButton />
        <Button variant="ghost" size="sm" onClick={() => navigate("/sounds")}>
          الخريطة
        </Button>
      </div>

      {/* Step indicator dots */}
      <div className="flex items-center justify-center gap-2 mb-5">
        {SOUND_STEPS.map((s, i) => (
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
            aria-label={`الخطوة ${i + 1}: ${STEP_LABELS[s]}`}
          />
        ))}
      </div>

      <header className="text-center mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          الخطوة {stepIdx + 1} من {SOUND_STEPS.length}
        </p>
        <h2 className="text-lg font-bold text-foreground mt-0.5" style={{ fontFamily: "'Montserrat', sans-serif" }}>
          {STEP_LABELS[step]}
        </h2>
      </header>

      {/* Step content */}
      <div className="min-h-[360px]">
        {step === "meet" && (
          <div className="space-y-6 text-center">
            <div className="font-english text-[110px] text-primary leading-none" dir="ltr">
              {sound.display}
            </div>
            <p className="font-english text-2xl text-muted-foreground" dir="ltr">
              {sound.ipa}
            </p>
            <div>
              <p className="font-english text-2xl text-foreground" dir="ltr">
                {sound.keyword}
              </p>
              <p className="text-sm text-muted-foreground mt-1">{sound.keyword_ar}</p>
            </div>
            <div className="flex items-center justify-center">
              <SoundAudioButton text={sound.keyword} size="lg" autoplay label="شغّل الصوت" />
            </div>
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("meet"); setStepIdx(1); }} size="lg" className="w-full">
              سمعته <ChevronNext className="h-4 w-4 ms-1" />
            </Button>
          </div>
        )}

        {step === "mouth" && (
          <div className="space-y-4">
            <MouthGuidePanel sound={sound} />
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("mouth"); setStepIdx(2); }} size="lg" className="w-full mt-4">
              فهمت الفرق <ChevronNext className="h-4 w-4 ms-1" />
            </Button>
          </div>
        )}

        {step === "spell" && (
          <div className="space-y-4">
            <SpellingPanel sound={sound} />
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("spell"); setStepIdx(3); }} size="lg" className="w-full mt-4">
              واضح <ChevronNext className="h-4 w-4 ms-1" />
            </Button>
          </div>
        )}

        {step === "examples" && (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground mb-2">
              كلمات حقيقية تحمل هذا الصوت
            </p>
            {sound.examples.map((ex) => (
              <div
                key={ex.en}
                className="p-4 rounded-2xl border-2 border-border bg-card flex items-center gap-3"
              >
                <SoundAudioButton text={ex.en} size="md" label={`شغّل ${ex.en}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-english text-2xl text-foreground" dir="ltr">
                    {ex.en}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {ex.ar} · {POSITION_LABEL[ex.position]}
                  </p>
                </div>
              </div>
            ))}
            <Button onClick={(e) => { tapFeedback(e.currentTarget); handleStepDone("examples"); setStepIdx(4); }} size="lg" className="w-full mt-4">
              تمام <ChevronNext className="h-4 w-4 ms-1" />
            </Button>
          </div>
        )}

        {step === "spot" && (
          <div className="space-y-4">
            <SpotTheSoundGame
              sound={sound}
              onComplete={(score) => handleStepDone("spot", { spotScore: score })}
            />
            {done.spot && (
              <Button onClick={(e) => { tapFeedback(e.currentTarget); setStepIdx(5); }} size="lg" className="w-full">
                التالي <ChevronNext className="h-4 w-4 ms-1" />
              </Button>
            )}
          </div>
        )}

        {step === "contrast" && (
          <div className="space-y-6">
            <MinimalPairGame
              sound={sound}
              onComplete={(score) => handleStepDone("contrast", { soundScore: score })}
            />
            {done.contrast && (
              <div className="space-y-3">
                {allDone && (
                  <div className="p-4 rounded-2xl bg-green-500/10 border-2 border-green-500/30 text-center">
                    <Sparkles className="h-6 w-6 text-green-600 mx-auto mb-1" />
                    <p className="font-bold text-foreground">أتقنت الصوت!</p>
                    <p className="text-xs text-muted-foreground">+30 XP</p>
                  </div>
                )}
                {next ? (
                  <Button
                    onClick={(e) => {
                      tapFeedback(e.currentTarget);
                      if (allDone) {
                        toast.success(`أتقنت صوت ${sound.ipa}! 🌟`);
                      }
                      navigate(`/sounds/${next.code}`);
                    }}
                    size="lg"
                    className="w-full"
                  >
                    الصوت التالي <ChevronNext className="h-4 w-4 ms-1" />
                  </Button>
                ) : (
                  <Button onClick={(e) => { tapFeedback(e.currentTarget); navigate("/sounds"); }} size="lg" className="w-full">
                    العودة إلى الخريطة
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
          <ChevronBack className="h-4 w-4 me-1" /> رجوع
        </Button>
        {done[step] && <Check className="h-4 w-4 text-green-600" />}
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            tapFeedback(e.currentTarget);
            setStepIdx(Math.min(SOUND_STEPS.length - 1, stepIdx + 1));
          }}
          disabled={stepIdx === SOUND_STEPS.length - 1}
        >
          تخطّي <ChevronNext className="h-4 w-4 ms-1" />
        </Button>
      </div>
    </AppShell>
  );
};

export default EnglishSound;
