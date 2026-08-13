import { useNavigate } from "react-router-dom";
import { ARABIC_LETTERS, CHECKPOINT_INDICES } from "@/data/arabicAlphabet";
import { useAlphabetProgress, useCheckpointProgress } from "@/hooks/useAlphabetProgress";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { InfoHint } from "@/components/InfoHint";
import { DesertBackdrop } from "@/components/alphabet/DesertBackdrop";
import { StopOrnament } from "@/components/alphabet/StopOrnament";
import { CaravanMarker } from "@/components/alphabet/CaravanMarker";
import { StopMasteryRing } from "@/components/alphabet/StopMasteryRing";
import { MilestoneBanner } from "@/components/alphabet/MilestoneBanner";
import { tapFeedback } from "@/lib/tapFeedback";
import { useSoundPref } from "@/lib/uiPrefs";
import { Lock, Check, Flag, Trophy, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

const AlphabetJourney = () => {
  const navigate = useNavigate();
  const { progress, isUnlocked, masteredCount } = useAlphabetProgress();
  const { checkpoints } = useCheckpointProgress();
  const [soundOn, setSoundOn] = useSoundPref();

  // Current stop = first non-mastered unlocked letter
  const currentStopIndex = ARABIC_LETTERS.findIndex(
    (l) => isUnlocked(l.order_index) && !progress[l.code]?.mastered_at,
  );

  return (
    <AppShell>
      <DesertBackdrop />
      <div className="flex items-center justify-between mb-4">
        <HomeButton />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSoundOn(!soundOn)}
            className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={soundOn ? "Mute chimes" : "Unmute chimes"}
            aria-label={soundOn ? "Mute chimes" : "Unmute chimes"}
          >
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <p className="text-xs text-muted-foreground">
            {masteredCount} / 28 mastered
          </p>
        </div>
      </div>

      <MilestoneBanner masteredCount={masteredCount} />


      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>
          Alphabet Journey 🐪
          <InfoHint
            title="Alphabet Journey"
            body="A 28-stop caravan through the Arabic alphabet. Each stop is a 3-minute mini-lesson: meet the letter, hear it, trace it, see its four shapes, then two quick games. Master one to unlock the next."
          />
        </h1>
        <p
          className="text-3xl text-primary mt-2"
          style={{ fontFamily: "'Noto Sans Arabic', serif" }}
          dir="rtl"
        >
          أ ب ت ث
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Tap a stop to begin. The trail unlocks letter by letter.
        </p>
      </header>

      <div className="relative">
        {/* Vertical trail line - dashed caravan path */}
        <div
          className="absolute left-1/2 top-6 bottom-6 -translate-x-1/2 w-px"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, #5C3A46 0 6px, transparent 6px 12px)",
            opacity: 0.35,
          }}
        />

        <div className="relative space-y-3">
          {ARABIC_LETTERS.map((letter) => {
            const row = progress[letter.code];
            const unlocked = isUnlocked(letter.order_index);
            const mastered = !!row?.mastered_at;
            const stepsCompleted = row?.steps_completed?.length ?? 0;
            const isLeft = letter.order_index % 2 === 0;
            const isCheckpointAfter = CHECKPOINT_INDICES.includes(letter.order_index);
            const checkpointIdx = CHECKPOINT_INDICES.indexOf(letter.order_index);

            return (
              <div key={letter.code}>
                <button
                  onClick={(e) => {
                    if (unlocked) {
                      tapFeedback(e.currentTarget.querySelector("[data-tap-node]") as HTMLElement);
                      navigate(`/alphabet/${letter.code}`);
                    }
                  }}
                  disabled={!unlocked}
                  aria-label={`Letter ${letter.code}${unlocked ? "" : " (locked)"}`}
                  className={cn(
                    "w-full flex items-center gap-2",
                    isLeft ? "flex-row" : "flex-row-reverse",
                  )}
                >
                  {/* Side label card */}
                  <div
                    className={cn(
                      "flex-1 px-3 py-2 rounded-xl border backdrop-blur-sm transition-colors",
                      isLeft ? "text-right" : "text-left",
                      unlocked
                        ? "bg-[#F9F7F2]/75 border-[#5C3A46]/25"
                        : "bg-muted/40 border-muted-foreground/15",
                    )}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5C3A46]/70">
                      Stop {letter.order_index + 1}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {letter.name_translit}
                    </p>
                    {unlocked && !mastered && stepsCompleted > 0 && (
                      <p className="text-[10px] text-primary mt-0.5">
                        {stepsCompleted}/6 steps
                      </p>
                    )}
                  </div>

                  {/* Stop node */}
                  <div
                    data-tap-node
                    className={cn(
                      "relative h-16 w-16 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                      mastered &&
                        "bg-gradient-to-br from-[#F1E3C6] to-[#E2C892] border-[#CFA44E] shadow-[0_4px_14px_-4px_rgba(207,164,78,0.6)] animate-master-bounce",
                      !mastered &&
                        unlocked &&
                        "bg-gradient-to-br from-[#FBF6EC] to-[#EFE2CC] border-[#5C3A46] shadow-[0_4px_12px_-4px_rgba(92,58,70,0.35)] hover:shadow-[0_6px_18px_-4px_rgba(92,58,70,0.5)] active:scale-95 animate-unlock-bounce",
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
                        style={{ borderColor: mastered ? "#CFA44E" : "#5C3A46", opacity: 0.35 }}
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
                          "text-3xl relative",
                          mastered ? "text-[#7A5320]" : "text-[#5C3A46]",
                        )}
                        style={{ fontFamily: "'Noto Sans Arabic', serif", lineHeight: 1 }}
                      >
                        {letter.isolated}
                      </span>
                    )}
                    {mastered && (
                      <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-[#4A7A40] text-white flex items-center justify-center shadow">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    {/* Caravan: marks the learner's current spot */}
                    {letter.order_index === currentStopIndex && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none drop-shadow">
                        <CaravanMarker size={32} />
                      </div>
                    )}
                  </div>

                  {/* Ornament instead of empty spacer */}
                  <div className="flex-1 flex justify-center">
                    <StopOrnament
                      index={letter.order_index}
                      side={isLeft ? "right" : "left"}
                      active={unlocked}
                    />
                  </div>
                </button>

                {/* Checkpoint marker - oasis card */}
                {isCheckpointAfter && checkpointIdx >= 0 && (
                  <button
                    onClick={(e) => {
                      if (mastered) {
                        tapFeedback(e.currentTarget);
                        navigate(`/alphabet/checkpoint/${checkpointIdx}`);
                      }
                    }}
                    disabled={!mastered}
                    className={cn(
                      "mt-3 w-full p-4 rounded-2xl border-2 flex items-center justify-center gap-3 transition-all relative overflow-hidden",
                      mastered
                        ? checkpoints[checkpointIdx]
                          ? "border-[#CFA44E] bg-gradient-to-r from-[#F4E3B8]/80 via-[#F9F0D4]/80 to-[#F4E3B8]/80"
                          : "border-[#CFA44E] bg-gradient-to-r from-[#F9F0D4]/70 to-[#F4E3B8]/70 hover:from-[#F4E3B8] hover:to-[#EED9A0] animate-pulse"
                        : "border-muted bg-muted/30 opacity-60",
                    )}
                  >
                    {/* Faint palm silhouettes left/right */}
                    {mastered && (
                      <>
                        <svg className="absolute left-2 bottom-1 opacity-40" width="22" height="32" viewBox="0 0 40 64">
                          <path d="M20,60 Q18,40 22,18" stroke="#5C3A1E" strokeWidth="2" fill="none" />
                          <g transform="translate(22,18)">
                            {[0, 60, 120, 180, 240, 300].map((a) => (
                              <path key={a} d="M0,0 Q9,-3 16,2" stroke="#4A7A40" strokeWidth="1.8" fill="none" transform={`rotate(${a})`} />
                            ))}
                          </g>
                        </svg>
                        <svg className="absolute right-2 bottom-1 opacity-40 -scale-x-100" width="22" height="32" viewBox="0 0 40 64">
                          <path d="M20,60 Q18,40 22,18" stroke="#5C3A1E" strokeWidth="2" fill="none" />
                          <g transform="translate(22,18)">
                            {[0, 60, 120, 180, 240, 300].map((a) => (
                              <path key={a} d="M0,0 Q9,-3 16,2" stroke="#4A7A40" strokeWidth="1.8" fill="none" transform={`rotate(${a})`} />
                            ))}
                          </g>
                        </svg>
                      </>
                    )}
                    {checkpoints[checkpointIdx] ? (
                      <Trophy className="h-5 w-5 text-[#A57B1F] relative" />
                    ) : (
                      <Flag className="h-5 w-5 text-[#A57B1F] relative" />
                    )}
                    <span className="font-bold text-[#5C3A46] relative">
                      Oasis Checkpoint {checkpointIdx + 1}
                    </span>
                    {checkpoints[checkpointIdx] && (
                      <span className="text-xs font-semibold text-[#A57B1F] ml-1 relative">
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

export default AlphabetJourney;
