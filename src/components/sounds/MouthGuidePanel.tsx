import { type EnglishSound } from "@/data/englishSounds";

interface MouthGuidePanelProps {
  sound: EnglishSound;
}

/**
 * Articulation guide — the phonics replacement for Hakiya's FourFacesPanel.
 *
 * Arabic letters change SHAPE by position in a word, which is what
 * FourFacesPanel showed. English sounds don't do that; what an English sound
 * has that needs the same kind of explicit, visual walkthrough is where the
 * tongue/lips/teeth go and whether the throat vibrates — the two facts that
 * TESOL's own Arabic-speaker pronunciation guidance leads with, because
 * showing *where* the voicing happens is what turns "I can't hear the
 * difference" into "I can feel the difference".
 *
 * `sound.mouth_ar` is place-and-manner only (tongue/lip/teeth position); the
 * voicing hand-on-throat line is generated once here from `voiced` rather
 * than repeated in all 28 data entries.
 */
export const MouthGuidePanel = ({ sound }: MouthGuidePanelProps) => {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl border-2 border-border bg-card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          كيف تشكّل الصوت
        </p>
        <p className="text-base text-foreground leading-relaxed">{sound.mouth_ar}</p>
      </div>

      {sound.voiced !== undefined && (
        <div className="p-5 rounded-2xl border-2 border-primary/30 bg-primary/5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            جرّب: ضع يدك على حلقك
          </p>
          <p className="text-base text-foreground leading-relaxed">
            انطق الصوت وأنت تلمس حلقك.{" "}
            {sound.voiced
              ? "يجب أن تشعر باهتزاز واضح — هذا صوت مجهور."
              : "يجب ألا تشعر بأي اهتزاز — هذا صوت مهموس، هواء فقط."}
          </p>
        </div>
      )}

      <div className="p-5 rounded-2xl border-2 border-amber-500/30 bg-amber-500/5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          فخ شائع لمتحدثي العربية
        </p>
        <p className="text-base text-foreground leading-relaxed">{sound.interference_ar}</p>
      </div>
    </div>
  );
};
