import { useMemo, useState, useEffect } from "react";
import { ARABIC_LETTERS, type ArabicLetter } from "@/data/arabicAlphabet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

interface SpotTheLetterGameProps {
  letter: ArabicLetter;
  /** Pool of allowed letters whose example words can appear (defaults to all). */
  pool?: ArabicLetter[];
  onComplete: (score: number) => void;
}

/**
 * Normalize Arabic so alif variants (أ إ آ ٱ), ya (ى ئ), waw (ؤ), and
 * ta marbuta (ة → ه) all compare equal to their base letter. Also strips
 * tashkil (\u064B–\u0652) and tatweel (\u0640).
 */
function normalizeArabic(str: string): string {
  return str
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0626/g, "\u064A")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0629/g, "\u0647");
}

/** Returns true if word contains any form of the target letter's base char. */
function wordContainsLetter(word: string, letter: ArabicLetter): boolean {
  return normalizeArabic(word).includes(normalizeArabic(letter.isolated));
}

function pickPool(target: ArabicLetter, count: number, sourceLetters: ArabicLetter[]) {
  // Prefer example words from letters the learner has already reached, but always
  // guarantee at least some filler words that don't contain the target — otherwise
  // the very first letter (alif) would render an all-correct grid.
  const learnedWords = sourceLetters.flatMap((l) => l.examples.map((e) => e.ar));
  const allWords = ARABIC_LETTERS.flatMap((l) => l.examples.map((e) => e.ar));
  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
  const uniqueLearned = Array.from(new Set(learnedWords));
  const uniqueAll = Array.from(new Set(allWords));
  const want = Math.min(count, uniqueAll.length);
  const wantTargets = Math.ceil(want / 2);
  const wantFillers = want - wantTargets;

  const learnedWithTarget = uniqueLearned.filter((w) => wordContainsLetter(w, target));
  const learnedWithout = uniqueLearned.filter((w) => !wordContainsLetter(w, target));
  const allWithout = uniqueAll.filter((w) => !wordContainsLetter(w, target));

  const targets = shuffle(learnedWithTarget).slice(0, wantTargets);
  // Fillers: prefer learned; top up from full alphabet if learned pool has no non-target words yet.
  const fillerPool = learnedWithout.length >= wantFillers ? learnedWithout : allWithout;
  const fillers = shuffle(fillerPool).slice(0, wantFillers);
  return shuffle([...targets, ...fillers]);
}

export const SpotTheLetterGame = ({ letter, pool, onComplete }: SpotTheLetterGameProps) => {
  const sourceLetters = pool ?? ARABIC_LETTERS;
  const words = useMemo(() => pickPool(letter, 8, sourceLetters), [letter, sourceLetters]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    setPicked({});
    setSubmitted(false);
    setScore(0);
  }, [letter.code]);

  const toggle = (w: string) => {
    if (submitted) return;
    setPicked((p) => ({ ...p, [w]: !p[w] }));
  };

  const submit = () => {
    let correct = 0;
    let totalAnswers = 0;
    for (const w of words) {
      const has = wordContainsLetter(w, letter);
      const choseYes = !!picked[w];
      totalAnswers++;
      if (has === choseYes) correct++;
    }
    const s = Math.round((correct / totalAnswers) * 100);
    setScore(s);
    setSubmitted(true);
    onComplete(s);
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Tap every word containing</p>
        <p
          className="text-5xl font-bold text-primary mt-1"
          style={{ fontFamily: "'Noto Sans Arabic', serif" }}
        >
          {letter.isolated}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {words.map((w) => {
          const isPicked = !!picked[w];
          const isCorrectAnswer = wordContainsLetter(w, letter);
          const showResult = submitted;
          const correct = showResult && isPicked === isCorrectAnswer;
          const wrong = showResult && isPicked !== isCorrectAnswer;
          return (
            <button
              key={w}
              onClick={() => toggle(w)}
              disabled={submitted}
              className={cn(
                "p-3 rounded-xl border-2 text-2xl text-center transition-all active:scale-95",
                !showResult && isPicked && "border-primary bg-primary/10",
                !showResult && !isPicked && "border-border bg-card",
                correct && "border-green-500 bg-green-500/10 animate-correct-pulse",
                wrong && "border-red-500 bg-red-500/10 animate-shake",
              )}
              style={{ fontFamily: "'Noto Sans Arabic', serif" }}
            >
              {w}
              {showResult && (
                <span className="ml-2 inline-flex">
                  {isCorrectAnswer ? (
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
          Check answers
        </Button>
      ) : (
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{score}%</p>
          <p className="text-sm text-muted-foreground">
            {score >= 80 ? "Excellent! 🌟" : score >= 50 ? "Good — keep going" : "Try again to lock it in"}
          </p>
        </div>
      )}
    </div>
  );
};
