import { useMemo, useState, useEffect } from "react";
import { type EnglishSound } from "@/data/englishSounds";
import { SoundAudioButton } from "./SoundAudioButton";
import { cn } from "@/lib/utils";

interface MinimalPairGameProps {
  sound: EnglishSound;
  onComplete: (score: number) => void;
}

/**
 * "Which word did you hear?" — the phonics replacement for Hakiya's
 * SoundMatchGame.
 *
 * The old game played a letter's NAME and asked which glyph it was — a
 * shape-to-sound match. This is a minimal-pair LISTENING DISCRIMINATION
 * task, the standard mechanic the pronunciation-teaching literature
 * converges on for exactly this problem: an Arabic-speaking ear that cannot
 * reliably tell "park" from "bark" apart needs practice telling them apart by
 * EAR, not by being shown the spelling next to the target sound (which is
 * what MouthGuidePanel and SpellingPanel already cover). One of this sound's
 * documented minimal pairs is played; the four options mix that pair with a
 * second pair so a correct guess has to be about the sound heard, not about
 * which tile looks least like the others.
 */
export const MinimalPairGame = ({ sound, onComplete }: MinimalPairGameProps) => {
  const round = useMemo(() => {
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    const pairs = shuffle(sound.minimalPairs).slice(0, 2);
    const chosenPair = pairs[0];
    const spoken = Math.random() < 0.5 ? chosenPair.target : chosenPair.confuse;
    const optionWords = pairs.flatMap((p) => [p.target, p.confuse]);
    return { spoken, options: shuffle(Array.from(new Set(optionWords))) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound.code]);

  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [shakeWrong, setShakeWrong] = useState(false);

  useEffect(() => {
    setPicked(null);
    setDone(false);
    setShakeWrong(false);
  }, [sound.code]);

  const correct = picked === round.spoken;

  const choose = (word: string) => {
    if (picked) return;
    setPicked(word);
    setDone(true);
    const isCorrect = word === round.spoken;
    if (!isCorrect) {
      setShakeWrong(true);
      window.setTimeout(() => setShakeWrong(false), 500);
    }
    onComplete(isCorrect ? 100 : 0);
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <p className="text-sm text-muted-foreground">اضغط على السماعة، ثم اختر الكلمة التي سمعتها</p>
        <div className="flex justify-center">
          <SoundAudioButton key={sound.code + round.spoken} text={round.spoken} size="lg" autoplay label="شغّل الكلمة" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {round.options.map((word) => {
          const isPicked = picked === word;
          const showResult = done && isPicked;
          return (
            <button
              key={word}
              onClick={() => choose(word)}
              disabled={!!picked}
              className={cn(
                "font-english p-6 rounded-2xl border-2 transition-all active:scale-95 text-2xl",
                !picked && "border-border bg-card hover:border-primary/40",
                showResult && correct && "border-green-500 bg-green-500/10 animate-correct-pulse",
                showResult && !correct && "border-red-500 bg-red-500/10",
                showResult && !correct && shakeWrong && "animate-shake",
                done && !isPicked && word === round.spoken && "border-green-500/60 bg-green-500/5",
              )}
              dir="ltr"
            >
              {word}
            </button>
          );
        })}
      </div>

      {done && (
        <p className="text-center text-sm">
          {correct ? (
            <span className="text-green-600 font-semibold">صحيح! 🎉</span>
          ) : (
            <span className="text-muted-foreground">
              الكلمة كانت{" "}
              <span className="font-english font-bold text-foreground" dir="ltr">
                {round.spoken}
              </span>
            </span>
          )}
        </p>
      )}
    </div>
  );
};
