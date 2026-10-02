import { Link } from "react-router-dom";
import { Lightbulb, Loader2, Mic, Volume2 } from "lucide-react";
import { scoreBand, type PronunciationResult } from "@/hooks/useAzurePronunciation";
import { heardInstead, weakestSound } from "@/lib/pronunciationFeedback";
import { cn } from "@/lib/utils";

/**
 * What a take scored, read top-down the way a learner asks about it: how did I
 * do, what went wrong, how do I fix it.
 *
 * The scorer's numbers are all still here — overall, the three sub-scores,
 * every word — but they come after the one thing to work on: the sound that
 * went worst, why an Arabic speaker gets it wrong, and the pair of words that
 * makes the difference audible (`weakestSound`, from the English Sounds data).
 */

const ERROR_LABEL: Record<string, string> = {
  Mispronunciation: "نطق غير صحيح",
  Omission: "ناقصة",
  Insertion: "زائدة",
};

/** Colours by score, from the theme rather than the raw palette, so dark mode holds. */
function tone(score: number): { text: string; soft: string } {
  if (score >= 90) return { text: "text-success", soft: "bg-success/10" };
  if (score >= 75) return { text: "text-primary", soft: "bg-primary/10" };
  if (score >= 60) return { text: "text-accent-ink", soft: "bg-accent/15" };
  return { text: "text-destructive", soft: "bg-destructive/10" };
}

interface Props {
  result: PronunciationResult;
  /** What the learner was asked to say. */
  referenceText: string;
  onPlayModel: () => void;
  modelLoading?: boolean;
  /** Plays the learner's own take back. Absent when there is no take to play. */
  onPlayTake?: () => void;
}

export function PronunciationResultCard({ result, referenceText, onPlayModel, modelLoading, onPlayTake }: Props) {
  const band = scoreBand(result.overall);
  const overall = tone(result.overall);
  const weak = weakestSound(result);
  const heard = heardInstead(referenceText, result.recognizedText);
  const weakWord = weak ? result.words.find((w) => w.word === weak.word) : undefined;

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <section aria-label="نتيجة النطق" className="rounded-[28px] bg-card p-5 shadow-card">
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "grid h-20 w-20 shrink-0 place-items-center rounded-full font-english text-3xl font-bold",
              overall.soft,
              overall.text,
            )}
          >
            {Math.round(result.overall)}
          </span>
          <div className="min-w-0">
            <h2 className={cn("text-[22px] font-bold leading-8", overall.text)}>{band.label}</h2>
            {weak && (
              <p className="text-[15px] leading-6 text-muted-foreground">
                انتبه لصوت <bdi className="font-english font-semibold text-foreground">/{weak.phoneme}/</bdi> في{" "}
                <bdi className="font-english font-semibold text-foreground">{weak.word}</bdi>
              </p>
            )}
            {heard && (
              <p className="text-[15px] leading-6 text-muted-foreground">
                سمعنا <bdi className="font-english font-semibold text-foreground">{heard}</bdi>
              </p>
            )}
          </div>
        </div>

        {/* The weak word sound by sound — the one place a phoneme score helps. */}
        {weakWord && weakWord.phonemes.length > 0 && (
          <ul dir="ltr" aria-label="أصوات الكلمة" className="mt-4 flex flex-wrap justify-center gap-1.5">
            {weakWord.phonemes.map((p, i) => {
              const t = tone(p.accuracy);
              return (
                <li key={i} className={cn("rounded-full px-2.5 py-1 font-english text-sm font-bold", t.soft, t.text)}>
                  /{p.phoneme}/
                </li>
              );
            })}
          </ul>
        )}

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "الدقة", value: result.accuracy },
            { label: "الطلاقة", value: result.fluency },
            { label: "الاكتمال", value: result.completeness },
          ].map(({ label, value }) => (
            // dt before dd, as a description list needs; reversed on screen so
            // the number leads.
            <div key={label} className="flex flex-col-reverse rounded-2xl bg-muted/60 px-2 py-2.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-english text-xl font-bold text-foreground">{Math.round(value)}</dd>
            </div>
          ))}
        </dl>

        {result.words.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">كلمة كلمة</p>
            <ul dir="ltr" className="flex flex-wrap justify-center gap-2">
              {result.words.map((w, i) => {
                const t = tone(w.accuracy);
                return (
                  <li key={i} className={cn("rounded-2xl px-3 py-1.5 text-sm font-semibold", t.soft, t.text)}>
                    <span className="font-english">{w.word}</span>
                    <span className="ms-1 font-english text-xs opacity-75">{Math.round(w.accuracy)}</span>
                    {w.errorType !== "None" && (
                      <span dir="rtl" className="ms-1.5 rounded-full bg-destructive px-1.5 py-0.5 text-[11px] text-destructive-foreground">
                        {ERROR_LABEL[w.errorType] ?? w.errorType}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onPlayModel}
            disabled={modelLoading}
            className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary/10 text-[15px] font-semibold text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
          >
            {modelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
            النطق الصحيح
          </button>
          {onPlayTake && (
            <button
              type="button"
              onClick={onPlayTake}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-muted text-[15px] font-semibold text-foreground transition-colors hover:bg-muted/80"
            >
              <Mic className="h-4 w-4" aria-hidden />
              تسجيلك
            </button>
          )}
        </div>
      </section>

      {weak?.sound && (
        <aside className="flex gap-3 rounded-[20px] bg-primary/10 px-4 py-3.5">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold leading-6 text-primary">
              صوت <bdi className="font-english">{weak.sound.ipa}</bdi>
            </p>
            <p className="text-sm leading-6 text-foreground/80">{weak.sound.interference_ar}</p>
            {weak.sound.minimalPairs.length > 0 && (
              <p className="text-sm leading-6 text-muted-foreground">
                انتبه للفرق:{" "}
                {weak.sound.minimalPairs.slice(0, 2).map((pair, i) => (
                  <span key={pair.target}>
                    {i > 0 && "، "}
                    <bdi className="font-english font-semibold text-foreground">
                      {pair.target} / {pair.confuse}
                    </bdi>
                  </span>
                ))}
              </p>
            )}
            <Link
              to={`/sounds/${weak.sound.code}`}
              className="inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              تدرّب على هذا الصوت
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}
