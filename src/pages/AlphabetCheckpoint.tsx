import { useNavigate, useParams } from "react-router-dom";
import { useMemo, useState, useEffect } from "react";
import { ARABIC_LETTERS, CHECKPOINT_INDICES } from "@/data/arabicAlphabet";
import { useAlphabetProgress, useCheckpointProgress } from "@/hooks/useAlphabetProgress";

import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { LetterAudioButton } from "@/components/alphabet/LetterAudioButton";
import { Button } from "@/components/ui/button";
import { tapFeedback, playSuccessChime } from "@/lib/tapFeedback";
import { Trophy, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const ROUND_COUNT = 8;

const AlphabetCheckpoint = () => {
  const navigate = useNavigate();
  const { index } = useParams();
  const idx = Math.max(0, Math.min(CHECKPOINT_INDICES.length - 1, parseInt(index ?? "0", 10)));
  const { progress, isUnlocked } = useAlphabetProgress();
  const { recordCheckpoint, checkpoints } = useCheckpointProgress();

  // Pool: all letters covered by this checkpoint (and earlier ones).
  const pool = useMemo(() => {
    const end = CHECKPOINT_INDICES[idx];
    return ARABIC_LETTERS.slice(0, end + 1);
  }, [idx]);

  const eligible = pool.every((l) => progress[l.code]?.mastered_at);

  const rounds = useMemo(() => {
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    const targets = shuffle(pool).slice(0, ROUND_COUNT);
    return targets.map((target) => {
      const others = pool.filter((l) => l.code !== target.code);
      const distractors = shuffle(others).slice(0, 3);
      return { target, options: shuffle([target, ...distractors]) };
    });
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

  const choose = async (code: string) => {
    const newPicks = [...picks, code];
    setPicks(newPicks);
    if (roundIdx + 1 < rounds.length) {
      setTimeout(() => setRoundIdx((i) => i + 1), 600);
    } else {
      const correct = rounds.filter((r, i) => r.target.code === newPicks[i]).length;
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
        <HomeButton />
        <div className="mt-8 text-center space-y-3">
          <Trophy className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold">Checkpoint locked</h1>
          <p className="text-muted-foreground">Master letters 1–{CHECKPOINT_INDICES[idx] + 1} first.</p>
          <Button onClick={() => navigate("/alphabet")}>Back to map</Button>
        </div>
      </AppShell>
    );
  }

  if (finalScore !== null) {
    const previous = checkpoints[idx]?.score ?? 0;
    return (
      <AppShell>
        <HomeButton />
        <div className="mt-12 text-center space-y-4">
          <div className="inline-flex h-24 w-24 rounded-full bg-amber-500/20 items-center justify-center">
            <Trophy className="h-12 w-12 text-amber-600" />
          </div>
          <h1 className="text-3xl font-bold">Checkpoint {idx + 1}</h1>
          <p className="text-6xl font-bold text-primary">{finalScore}%</p>
          <p className="text-muted-foreground">
            {finalScore >= 90 ? "Legendary." : finalScore >= 70 ? "Strong work." : "Keep practicing — try again."}
          </p>
          {finalScore > previous && previous > 0 && (
            <p className="text-sm text-green-600 font-semibold">New personal best!</p>
          )}
          <div className="flex gap-2 justify-center mt-4">
            <Button variant="outline" onClick={(e) => { tapFeedback(e.currentTarget); setRoundIdx(0); setPicks([]); setFinalScore(null); }}>
              Retry
            </Button>
            <Button onClick={(e) => { tapFeedback(e.currentTarget); navigate("/alphabet"); }}>Back to map</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const round = rounds[roundIdx];

  return (
    <AppShell compact>
      <div className="flex items-center justify-between mb-4">
        <HomeButton />
        <p className="text-xs text-muted-foreground">
          {roundIdx + 1} / {rounds.length}
        </p>
      </div>

      <header className="text-center mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">
          Caravan Checkpoint {idx + 1}
        </p>
        <h1 className="text-xl font-bold text-foreground flex items-center justify-center gap-2 mt-1">
          <Sparkles className="h-5 w-5 text-amber-500" /> Sound match boss round
        </h1>
      </header>

      <div className="space-y-6">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Pick the letter you hear</p>
          <div className="flex justify-center">
            <LetterAudioButton
              key={round.target.code}
              text={round.target.name_ar}
              forceMsa
              size="lg"
              autoplay
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {round.options.map((l) => (
            <button
              key={l.code}
              onClick={(e) => {
                tapFeedback(e.currentTarget);
                choose(l.code);
              }}
              className={cn(
                "p-6 rounded-2xl border-2 border-border bg-card transition-all active:scale-95",
                "hover:border-primary/40",
              )}
              style={{ fontFamily: "'Noto Sans Arabic', serif", fontSize: 56, lineHeight: 1 }}
            >
              {l.isolated}
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

export default AlphabetCheckpoint;
