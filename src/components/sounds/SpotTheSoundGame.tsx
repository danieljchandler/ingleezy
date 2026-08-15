import { useMemo, useState, useEffect } from "react";
import { type EnglishSound } from "@/data/englishSounds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

interface SpotTheSoundGameProps {
  sound: EnglishSound;
  onComplete: (score: number) => void;
}

/**
 * "Tap every word with this sound" — the phonics replacement for Hakiya's
 * SpotTheLetterGame.
 *
 * The old game derived its word pool by checking whether an Arabic glyph
 * appeared in an example word, which worked because Arabic spelling is
 * regular. English spelling isn't — you cannot tell whether a word contains
 * /iː/ by scanning its letters ("sheep" has it, "bread" doesn't, and neither
 * spelling gives it away) — so this version reads a curated, per-sound
 * `spotWords` list instead of deriving membership from the letters on
 * screen.
 */
export const SpotTheSoundGame = ({ sound, onComplete }: SpotTheSoundGameProps) => {
  const words = useMemo(() => {
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    return shuffle(sound.spotWords);
  }, [sound.code]);

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    setPicked({});
    setSubmitted(false);
    setScore(0);
  }, [sound.code]);

  const toggle = (w: string) => {
    if (submitted) return;
    setPicked((p) => ({ ...p, [w]: !p[w] }));
  };

  const submit = () => {
    let correct = 0;
    for (const w of words) {
      const choseYes = !!picked[w.word];
      if (w.hasSound === choseYes) correct++;
    }
    const s = Math.round((correct / words.length) * 100);
    setScore(s);
    setSubmitted(true);
    onComplete(s);
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">اضغط كل كلمة فيها صوت</p>
        <p className="font-english text-4xl font-bold text-primary mt-1" dir="ltr">
          {sound.ipa}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {words.map((w) => {
          const isPicked = !!picked[w.word];
          const showResult = submitted;
          const correct = showResult && isPicked === w.hasSound;
          const wrong = showResult && isPicked !== w.hasSound;
          return (
            <button
              key={w.word}
              onClick={() => toggle(w.word)}
              disabled={submitted}
              className={cn(
                "font-english p-3 rounded-xl border-2 text-xl text-center transition-all active:scale-95",
                !showResult && isPicked && "border-primary bg-primary/10",
                !showResult && !isPicked && "border-border bg-card",
                correct && "border-green-500 bg-green-500/10 animate-correct-pulse",
                wrong && "border-red-500 bg-red-500/10 animate-shake",
              )}
              dir="ltr"
            >
              {w.word}
              {showResult && (
                <span className="ms-2 inline-flex">
                  {w.hasSound ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!submitted ? (
        <Button onClick={submit} className="w-full" size="lg">
          تحقّق من الإجابات
        </Button>
      ) : (
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{score}%</p>
          <p className="text-sm text-muted-foreground">
            {score >= 80 ? "ممتاز! 🌟" : score >= 50 ? "جيد — واصل" : "حاول مرة أخرى لترسيخها"}
          </p>
        </div>
      )}
    </div>
  );
};
