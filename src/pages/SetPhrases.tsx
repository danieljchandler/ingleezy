import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { useSetPhraseOccasions, useUserSetPhrasesDueCount } from "@/hooks/useSetPhrases";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, MessageCircle, Sparkles, ArrowRight } from "lucide-react";
import { useDialect } from "@/contexts/DialectContext";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import { RequestSituationCard } from "@/components/set-phrases/RequestSituationCard";

const SetPhrases = () => {
  const navigate = useNavigate();
  const { data: occasions, isLoading } = useSetPhraseOccasions();
  const { data: dueCount = 0 } = useUserSetPhrasesDueCount();
  const { activeDialect } = useDialect();

  return (
    <AppShell>
      <HomeButton />
      <h1 className="text-2xl font-bold mt-4 mb-4 inline-flex items-center gap-2" style={{ fontFamily: "'Montserrat', sans-serif" }}>Set Phrases <InfoHint {...PAGE_HINTS["set-phrases"]} size="md" /></h1>
      <div className="space-y-4">
        <Card className="p-4 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/30">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
              <MessageCircle className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold">Practice {activeDialect} situational phrases</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Greetings, weddings, Eid, condolences and more — voice or choice quizzes with spaced repetition.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Button onClick={() => navigate("/set-phrases/practice")} className="w-full">
              <Sparkles className="h-4 w-4 mr-1" /> Mixed practice
            </Button>
            <Button
              onClick={() => navigate("/set-phrases/review")}
              variant={dueCount > 0 ? "default" : "outline"}
              className="w-full"
              disabled={dueCount === 0}
            >
              Review ({dueCount})
            </Button>
          </div>
        </Card>

        <RequestSituationCard />

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            By occasion
          </p>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !occasions?.length ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No occasions yet for {activeDialect}. Ask an admin to seed phrases.
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {occasions.map((o) => (
                <button
                  key={o.id}
                  onClick={() => navigate(`/set-phrases/practice?occasion=${o.id}`)}
                  className="p-4 rounded-xl bg-card border border-border text-left hover:border-emerald-500/40 active:scale-[0.98] transition"
                >
                  <p className="font-semibold text-sm">{o.name}</p>
                  {o.name_arabic && (
                    <p className="text-xs text-muted-foreground mt-1" dir="rtl">{o.name_arabic}</p>
                  )}
                  <div className="flex items-center justify-end mt-2 text-xs text-emerald-600">
                    Practice <ArrowRight className="h-3 w-3 ml-1" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default SetPhrases;
