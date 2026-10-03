import { useNavigate } from "react-router-dom";
import { ENGLISH_SOUNDS, CHECKPOINT_INDICES } from "@/data/englishSounds";
import { useSoundProgress, useCheckpointProgress } from "@/hooks/useSoundProgress";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { InfoHint } from "@/components/InfoHint";
import { TrailOrnament } from "@/components/sounds/TrailOrnament";
import { TrailMarker } from "@/components/sounds/TrailMarker";
import { StopMasteryRing } from "@/components/sounds/StopMasteryRing";
import { MilestoneBanner } from "@/components/sounds/MilestoneBanner";
import { tapFeedback } from "@/lib/tapFeedback";
import { useSoundPref } from "@/lib/uiPrefs";
import { Lock, Check, Flag, Trophy, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The English Sounds journey — a 28-stop caravan through the English sound
 * system, replacing the Alphabet Journey that taught the Arabic alphabet
 * (the wrong direction once the app itself flipped). See
 * src/data/englishSounds.ts for the curriculum and its research basis.
 *
 * The trail chrome is the app's own: a dashed firoza path, the illustration
 * set beside the stops, the wordmark's gold dot as "you are here", and
 * gold-tint checkpoint cards. It replaced a desert scene carried over from
 * Hakiya (dunes, palms, a camel, "oasis" checkpoints), heritage scenery the
 * brand has dropped: it appeals through the product, not through motifs.
 */
const EnglishSounds = () => {
  const navigate = useNavigate();
  const { progress, isUnlocked, masteredCount } = useSoundProgress();
  const { checkpoints } = useCheckpointProgress();
  const [soundOn, setSoundOn] = useSoundPref();

  // Current stop = first non-mastered unlocked sound
  const currentStopIndex = ENGLISH_SOUNDS.findIndex(
    (s) => isUnlocked(s.order_index) && !progress[s.code]?.mastered_at,
  );

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <PageCorner />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoundOn(!soundOn)}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={soundOn ? "كتم الأصوات" : "تشغيل الأصوات"}
            aria-label={soundOn ? "كتم الأصوات" : "تشغيل الأصوات"}
          >
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <p className="text-xs text-muted-foreground">
            {masteredCount} / 28 مُتقَن
          </p>
        </div>
      </div>

      <MilestoneBanner masteredCount={masteredCount} />

      <header className="mb-6 text-center">
        <h1 className="text-[28px] font-normal leading-[42px] text-foreground flex items-center justify-center gap-2">
          رحلة أصوات الإنجليزية
          <InfoHint
            title="رحلة أصوات الإنجليزية"
            body="رحلة من 28 محطة عبر أصوات الإنجليزية — وأغلبها الأصوات التي لا توجد في العربية أو تُلبس بصوت عربي قريب. كل محطة درس مصغّر: اسمع الصوت، افهم كيف يُشكَّل، شاهد كيف يُكتب، ثم تدرّبان عليه بلعبتين. أتقن محطة لتفتح التي تليها."
          />
        </h1>
        <p className="font-english text-3xl text-primary mt-2" dir="ltr">
          p · v · θ · ʃ
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          اضغط على محطة للبدء. المسار يُفتح صوتاً بعد صوت.
        </p>
      </header>

      <div className="relative">
        {/* Vertical trail line - dashed path */}
        <div
          className="absolute left-1/2 top-6 bottom-6 -translate-x-1/2 w-px"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, hsl(var(--primary)) 0 6px, transparent 6px 12px)",
            opacity: 0.35,
          }}
        />

        <div className="relative space-y-3">
          {ENGLISH_SOUNDS.map((sound) => {
            const row = progress[sound.code];
            const unlocked = isUnlocked(sound.order_index);
            const mastered = !!row?.mastered_at;
            const stepsCompleted = row?.steps_completed?.length ?? 0;
            const isLeft = sound.order_index % 2 === 0;
            const isCheckpointAfter = CHECKPOINT_INDICES.includes(sound.order_index);
            const checkpointIdx = CHECKPOINT_INDICES.indexOf(sound.order_index);

            return (
              <div key={sound.code}>
                <button
                  onClick={(e) => {
                    if (unlocked) {
                      tapFeedback(e.currentTarget.querySelector("[data-tap-node]") as HTMLElement);
                      navigate(`/sounds/${sound.code}`);
                    }
                  }}
                  disabled={!unlocked}
                  aria-label={`الصوت ${sound.code}${unlocked ? "" : " (مقفل)"}`}
                  className={cn(
                    "w-full flex items-center gap-2",
                    isLeft ? "flex-row" : "flex-row-reverse",
                  )}
                >
                  {/* Side label card */}
                  <div
                    className={cn(
                      "flex-1 px-3.5 py-2.5 rounded-2xl transition-colors",
                      isLeft ? "text-right" : "text-left",
                      unlocked
                        ? "bg-card shadow-soft"
                        : "bg-muted/60",
                    )}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/70 dark:text-periwinkle/70">
                      محطة {sound.order_index + 1}
                    </p>
                    <p className="font-english text-sm font-medium text-foreground" dir="ltr">
                      {sound.ipa}
                    </p>
                    {unlocked && !mastered && stepsCompleted > 0 && (
                      <p className="text-[10px] text-primary mt-0.5">
                        {stepsCompleted}/6 خطوات
                      </p>
                    )}
                  </div>

                  {/* Stop node */}
                  <div
                    data-tap-node
                    className={cn(
                      "relative h-16 w-16 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                      mastered &&
                        "bg-tint-gold border-accent shadow-soft animate-master-bounce",
                      !mastered &&
                        unlocked &&
                        "bg-card border-primary shadow-card hover:shadow-elegant active:scale-95 animate-unlock-bounce",
                      !unlocked && "bg-muted border-muted-foreground/25 opacity-60",
                    )}
                  >
                    {/* Mastery progress ring (sits just outside the stop) */}
                    <StopMasteryRing
                      progress={stepsCompleted / 6}
                      state={mastered ? "mastered" : unlocked ? "active" : "locked"}
                      size={76}
                    />
                    {/* Decorative inner ring */}
                    {unlocked && (
                      <div
                        className="absolute inset-1 rounded-full border border-dashed pointer-events-none"
                        style={{ borderColor: mastered ? "hsl(var(--accent))" : "hsl(var(--primary))", opacity: 0.35 }}
                      />
                    )}
                    {/* Shine sweep for mastered stops */}
                    {mastered && (
                      <div className="absolute inset-1 rounded-full overflow-hidden pointer-events-none">
                        <div
                          className="animate-shine-sweep absolute -left-full w-[300%] h-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
                          style={{ transform: "skewX(-20deg)" }}
                        />
                      </div>
                    )}
                    {!unlocked ? (
                      <Lock className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <span
                        className={cn(
                          "font-english text-2xl relative",
                          mastered ? "text-accent-ink" : "text-primary dark:text-periwinkle",
                        )}
                        style={{ lineHeight: 1 }}
                        dir="ltr"
                      >
                        {sound.display}
                      </span>
                    )}
                    {mastered && (
                      <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-success text-success-foreground flex items-center justify-center shadow">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {/* The gold dot: marks the learner's current spot */}
                    {sound.order_index === currentStopIndex && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 pointer-events-none">
                        <TrailMarker size={18} />
                      </div>
                    )}
                  </div>

                  {/* Ornament instead of empty spacer */}
                  <div className="flex-1 flex justify-center">
                    <TrailOrnament index={sound.order_index} active={unlocked} />
                  </div>
                </button>

                {/* Checkpoint card */}
                {isCheckpointAfter && checkpointIdx >= 0 && (
                  <button
                    onClick={(e) => {
                      if (mastered) {
                        tapFeedback(e.currentTarget);
                        navigate(`/sounds/checkpoint/${checkpointIdx}`);
                      }
                    }}
                    disabled={!mastered}
                    className={cn(
                      "mt-3 w-full p-4 rounded-3xl flex items-center justify-center gap-3 transition-all relative overflow-hidden",
                      mastered
                        ? checkpoints[checkpointIdx]
                          ? "bg-tint-gold shadow-soft"
                          : "bg-tint-gold ring-2 ring-accent shadow-soft hover:shadow-card animate-pulse"
                        : "bg-muted/50 opacity-60",
                    )}
                  >
                    {checkpoints[checkpointIdx] ? (
                      <Trophy className="h-5 w-5 text-accent-ink relative" />
                    ) : (
                      <Flag className="h-5 w-5 text-accent-ink relative" />
                    )}
                    <span className="font-bold text-primary dark:text-periwinkle relative">
                      نقطة تفتيش {checkpointIdx + 1}
                    </span>
                    {checkpoints[checkpointIdx] && (
                      <span className="text-xs font-semibold text-accent-ink me-1 relative">
                        {checkpoints[checkpointIdx].score}%
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
};

export default EnglishSounds;
