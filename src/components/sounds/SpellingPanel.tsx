import { type EnglishSound } from "@/data/englishSounds";

interface SpellingPanelProps {
  sound: EnglishSound;
}

/**
 * "How is it written" — the phonics replacement for Hakiya's LetterTracer.
 *
 * Tracing Arabic letter shapes earned its step because the shape itself was
 * the lesson. It doesn't carry over: every learner reaching this journey
 * already writes the Latin alphabet, and English's actual writing problem is
 * the opposite one — the SAME sound is spelled several different ways
 * (/iː/ is "ee", "ea", "e", "ie"...), which is exactly the "deep/opaque
 * orthography" the research behind this journey flags as the thing Arabic's
 * comparatively phonetic script does not prepare a learner for. Spelling
 * errors from Arabic-L1 writers are documented as phonetically PLAUSIBLE —
 * "speek" for "speak" — meaning the learner is decoding correctly and just
 * needs the exceptions named, not more general phonics drilling. This step
 * names them.
 */
export const SpellingPanel = ({ sound }: SpellingPanelProps) => {
  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        نفس الصوت، أكثر من طريقة كتابة
      </p>
      <div className="grid grid-cols-1 gap-3">
        {sound.spellings.map((s) => (
          <div
            key={s.grapheme}
            className="p-4 rounded-2xl border-2 border-border bg-card flex items-center gap-4"
          >
            <span
              className="font-english shrink-0 text-2xl font-bold text-primary min-w-[3.5rem] text-center"
              dir="ltr"
            >
              {s.grapheme}
            </span>
            <span className="font-english text-lg text-foreground" dir="ltr">
              {s.example}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
