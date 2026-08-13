import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader } from "@/components/layout/HubGrid";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { useDialect } from "@/contexts/DialectContext";
import { useAzureTTS } from "@/hooks/useAzureTTS";
import { useMistakes, useResolveMistake } from "@/hooks/useLearnerErrors";
import { describeMistake, labelForKind, labelForSource, type MistakeGroup } from "@/lib/mistakes";
import { Check, CheckCircle2, Loader2, Volume2 } from "lucide-react";

/**
 * The learner's own mistakes.
 *
 * `learner_errors` has been accumulating every pronunciation miss, shadowing
 * gap, sentence-coach failure and set-phrase mismatch — and feeding all of it
 * to the content generators, while never showing the learner a single row. The
 * person who made the mistakes was the one party who couldn't see them.
 *
 * Deliberately a review surface, not a drill: the app already has good places
 * to practise (pronunciation, shadowing, sentence coach), and what was missing
 * was knowing *what* to take there. Each entry says what you were aiming for,
 * what came out, how often, and how recently, with the correct audio to
 * compare against.
 */
const Mistakes = () => {
  const { activeDialect } = useDialect();
  const { data: groups, isLoading } = useMistakes(activeDialect);
  const resolve = useResolveMistake();

  return (
    <AppShell>
      <HomeButton />
      <HubHeader
        title="Your mistakes"
        subtitle={`What keeps tripping you up in ${activeDialect} Arabic.`}
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">Nothing outstanding.</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Mistakes show up here after speaking practice — pronunciation,
            shadowing and sentence practice all feed this list.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <MistakeCard
              key={`${group.dialect}-${group.target}`}
              group={group}
              onDismiss={() => resolve.mutate(group.ids)}
              dismissing={resolve.isPending}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
};

interface MistakeCardProps {
  group: MistakeGroup;
  onDismiss: () => void;
  dismissing: boolean;
}

function MistakeCard({ group, onDismiss, dismissing }: MistakeCardProps) {
  // TTS is generated per card, so it's requested on demand rather than
  // synthesising every entry on the list the moment the page opens.
  const [requested, setRequested] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { ttsUrl, isLoading: ttsLoading } = useAzureTTS({
    text: group.target,
    dialect: group.dialect,
    skip: !requested,
  });

  useEffect(() => {
    if (!ttsUrl) return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = ttsUrl;
    void audio.play().catch(() => {
      /* Autoplay refusal isn't worth an error toast — the button is still there. */
    });
  }, [ttsUrl]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-2xl font-bold text-foreground break-words"
            style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
            dir="rtl"
          >
            {group.target}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{describeMistake(group)}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setRequested(true)}
            disabled={ttsLoading}
            title="Hear it said correctly"
          >
            {ttsLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Volume2 className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onDismiss}
            disabled={dismissing}
            title="I've got this now"
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* What actually came out. Omitted for sources with no utterance (quiz). */}
      {group.attempts.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground" dir="rtl">
          <span className="text-xs uppercase tracking-wide me-2" dir="ltr">
            You said
          </span>
          {group.attempts.join("، ")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {group.kinds.map((kind) => (
          <span
            key={kind}
            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300"
          >
            {labelForKind(kind)}
          </span>
        ))}
        {group.sources.map((source) => (
          <span
            key={source}
            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
          >
            {labelForSource(source)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default Mistakes;
