import { useNavigate, useParams } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { ENGLISH_SOUNDS, CHECKPOINT_INDICES, type EnglishSound } from "@/data/englishSounds";
import { useSoundProgress, useCheckpointProgress } from "@/hooks/useSoundProgress";

import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { SoundAudioButton } from "@/components/sounds/SoundAudioButton";
import { Button } from "@/components/ui/button";
import { tapFeedback, playSuccessChime } from "@/lib/tapFeedback";
import { Trophy, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const ROUND_COUNT = 8;

interface Round {
  sound: EnglishSound;
  spoken: string;
  options: string[];
}

/** Build one round: a word from `sound`'s own minimal pairs against three
 *  other sounds' words drawn from the same pool — "which word did you hear"
 *  over everything the checkpoint covers, not just this one sound's pair. */
function buildRound(sound: EnglishSound, pool: EnglishSound[]): Round {
  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
  const pair = sound.minimalPairs[0];
  const spoken = Math.random() < 0.5 ? pair.target : pair.confuse;
  const others = shuffle(pool.filter((s) => s.code !== sound.code));
  const distractors: string[] = [];
  for (const s of others) {
    if (distractors.length >= 3) break;
    const word = s.minimalPairs[0].target;
    // Words are drawn from unrelated sounds' pairs, so a collision with the
    // spoken word (or an earlier distractor) is possible in principle — skip
    // rather than render two tiles with the same word and the same React key.
    if (word === spoken || distractors.includes(word)) continue;
    distractors.push(word);
  }
  return { sound, spoken, options: shuffle([spoken, ...distractors]) };
}

const SoundsCheckpoint = () => {
  const navigate = useNavigate();
  const { index } = useParams();
  const idx = Math.max(0, Math.min(CHECKPOINT_INDICES.length - 1, parseInt(index ?? "0", 10)));
  const { progress, isUnlocked } = useSoundProgress();
  const { recordCheckpoint, checkpoints } = useCheckpointProgress();

  // Pool: all sounds covered by this checkpoint (and earlier ones).
  const pool = useMemo(() => {
    const end = CHECKPOINT_INDICES[idx];
    return ENGLISH_SOUNDS.slice(0, end + 1);
  }, [idx]);

  const eligible = pool.every((s) => progress[s.code]?.mastered_at);

  const rounds = useMemo(() => {
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    const targets = shuffle(pool).slice(0, ROUND_COUNT);
    return targets.map((sound) => buildRound(sound, pool));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const [roundIdx, setRoundIdx] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const [finalScore, setFinalScore] = useState<number | null>(null);

  useEffect(() => {
    setRoundIdx(0);
    setPicks([]);
    setFinalScore(null);
  }, [idx]);

  const choose = async (word: string) => {
    const newPicks = [...picks, word];
    setPicks(newPicks);
    if (roundIdx + 1 < rounds.length) {
      setTimeout(() => setRoundIdx((i) => i + 1), 600);
    } else {
      const correct = rounds.filter((r, i) => r.spoken === newPicks[i]).length;
      const score = Math.round((correct / rounds.length) * 100);
      setFinalScore(score);
      if (score >= 70) playSuccessChime();
      try {
        await recordCheckpoint({ index: idx, score });
      } catch (e) {
        console.error(e);
      }
    }
  };

  if (!isUnlocked(CHECKPOINT_INDICES[idx]) || !eligible) {
    return (
      <AppShell>
        <PageCorner />
        <div className="mt-8 text-center space-y-3">
          <Trophy className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold">نقطة التفتيش مقفلة</h1>
          <p className="text-muted-foreground">أتقن الأصوات 1–{CHECKPOINT_INDICES[idx] + 1} أولاً.</p>
          <Button onClick={() => navigate("/sounds")}>العودة إلى الخريطة</Button>
        </div>
      </AppShell>
    );
  }

  if (finalScore !== null) {
    const previous = checkpoints[idx]?.score ?? 0;
    return (
      <AppShell>
        <PageCorner />
        <div className="mt-12 text-center space-y-4">
          <div className="inline-flex h-24 w-24 rounded-full bg-amber-500/20 items-center justify-center">
            <Trophy className="h-12 w-12 text-amber-600" />
          </div>
          <h1 className="text-3xl font-bold">نقطة التفتيش {idx + 1}</h1>
          <p className="text-6xl font-bold text-primary">{finalScore}%</p>
          <p className="text-muted-foreground">
            {finalScore >= 90 ? "أسطوري." : finalScore >= 70 ? "أداء قوي." : "واصل التدرّب — حاول مرة أخرى."}
          </p>
          {finalScore > previous && previous > 0 && (
            <p className="text-sm text-green-600 font-semibold">رقم قياسي جديد!</p>
          )}
          <div className="flex gap-2 justify-center mt-4">
            <Button variant="outline" onClick={(e) => { tapFeedback(e.currentTarget); setRoundIdx(0); setPicks([]); setFinalScore(null); }}>
              إعادة المحاولة
            </Button>
            <Button onClick={(e) => { tapFeedback(e.currentTarget); navigate("/sounds"); }}>العودة إلى الخريطة</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const round = rounds[roundIdx];

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-4">
        <PageCorner />
        <p className="text-xs text-muted-foreground">
          {roundIdx + 1} / {rounds.length}
        </p>
      </div>

      <header className="text-center mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">
          نقطة تفتيش القافلة {idx + 1}
        </p>
        <h1 className="text-xl font-bold text-foreground flex items-center justify-center gap-2 mt-1">
          <Sparkles className="h-5 w-5 text-amber-500" /> جولة تمييز الأصوات
        </h1>
      </header>

      <div className="space-y-6">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">اختر الكلمة التي سمعتها</p>
          <div className="flex justify-center">
            <SoundAudioButton
              key={round.sound.code + round.spoken}
              text={round.spoken}
              size="lg"
              autoplay
              label="شغّل الكلمة"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {round.options.map((word) => (
            <button
              key={word}
              onClick={(e) => {
                tapFeedback(e.currentTarget);
                choose(word);
              }}
              className={cn(
                "font-english p-6 rounded-2xl border-2 border-border bg-card transition-all active:scale-95 text-2xl",
                "hover:border-primary/40",
              )}
              dir="ltr"
            >
              {word}
            </button>
          ))}
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${((roundIdx) / rounds.length) * 100}%` }}
          />
        </div>
      </div>
    </AppShell>
  );
};

export default SoundsCheckpoint;
