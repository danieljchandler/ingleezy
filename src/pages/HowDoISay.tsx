import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HomeButton } from "@/components/HomeButton";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";
import type { VocabItem } from "@/types/transcript";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  MessageCircleQuestion,
  Loader2,
  Search,
  Star,
  BookOpen,
  Info,
  Users,
  Plus,
  Check,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Languages,
  MapPin,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PhraseTranslation {
  arabic: string;
  transliteration: string;
  english: string;
  context: string;
  naturalness: number;
  isPreferred: boolean;
}

type InputMode = "translation" | "scenario" | "conversation";

interface HowDoISayResult {
  phrase: string;
  inputMode: InputMode;
  detectedContext?: string;
  situationSummary?: string;
  translations: PhraseTranslation[];
  vocabulary: VocabItem[];
  culturalNotes?: string;
  genderVariants?: string;
}

/** Extracts the real error message from a supabase.functions.invoke error. */
async function readInvokeError(err: unknown): Promise<string> {
  if (!err || typeof err !== "object") return String(err);
  const context = (err as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      /* ignore */
    }
  }
  return (err as Error).message ?? "Unknown error";
}

const NaturalnessStars = ({ value }: { value: number }) => (
  <div className="flex gap-0.5" aria-label={`Naturalness ${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        className={cn(
          "h-3 w-3",
          i <= value ? "text-amber-400 fill-amber-400" : "text-muted-foreground/30",
        )}
      />
    ))}
  </div>
);

const HowDoISay = () => {
  const { isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const addUserVocabulary = useAddUserVocabulary();
  const addUserPhrase = useAddUserPhrase();

  const [phraseInput, setPhraseInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<HowDoISayResult | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [savedPhrases, setSavedPhrases] = useState<Set<string>>(new Set());
  const [showInstructions, setShowInstructions] = useState(true);

  const handleSearch = async () => {
    const trimmed = phraseInput.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setResult(null);
    setSavedWords(new Set());
    setSavedPhrases(new Set());

    try {
      const { data, error } = await supabase.functions.invoke("how-do-i-say", {
        body: { phrase: trimmed, dialect: activeDialect },
      });

      if (error) throw new Error(await readInvokeError(error));
      if (!data?.success || !data?.result) throw new Error(data?.error ?? "Translation failed");

      const r = data.result as HowDoISayResult;
      setResult(r);
      const count = r.translations.length;
      const modeLabel =
        r.inputMode === "scenario"
          ? `${count} thing${count !== 1 ? "s" : ""} to say`
          : r.inputMode === "conversation"
          ? `${count} suggested response${count !== 1 ? "s" : ""}`
          : `${count} way${count !== 1 ? "s" : ""} to say it`;
      toast.success("Got it!", { description: modeLabel });
    } catch (err) {
      console.error("how-do-i-say error:", err);
      toast.error("Translation failed", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveWord = useCallback(
    async (word: VocabItem) => {
      if (!isAuthenticated) {
        toast.error("Sign in to save words");
        return;
      }
      if (savedWords.has(word.arabic)) return;

      try {
        await addUserVocabulary.mutateAsync({
          word_arabic: word.arabic,
          word_english: word.english,
          root: word.root,
          source: "how-do-i-say",
        });
        setSavedWords((prev) => new Set(prev).add(word.arabic));
        toast.success("Saved to My Words!", { description: word.arabic });
      } catch {
        toast.error("Failed to save word");
      }
    },
    [isAuthenticated, addUserVocabulary, savedWords],
  );

  const handleSavePhrase = useCallback(
    async (translation: PhraseTranslation) => {
      if (!isAuthenticated) {
        toast.error("Sign in to save phrases");
        return;
      }
      if (savedPhrases.has(translation.arabic)) return;

      try {
        await addUserPhrase.mutateAsync({
          phrase_arabic: translation.arabic,
          phrase_english: result?.phrase ?? translation.english,
          transliteration: translation.transliteration,
          notes: translation.context || undefined,
          source: "how-do-i-say",
        });
        setSavedPhrases((prev) => new Set(prev).add(translation.arabic));
        toast.success("Phrase saved!", { description: translation.arabic });
      } catch {
        toast.error("Failed to save phrase");
      }
    },
    [isAuthenticated, addUserPhrase, result, savedPhrases],
  );

  return (
    <AppShell>
      <HomeButton />

      <div className="mb-4 mt-4">
        <h1
          className="text-2xl font-bold text-foreground flex items-center gap-2"
          style={{ fontFamily: "'Montserrat', sans-serif" }}
        >
          <MessageCircleQuestion className="h-7 w-7 text-primary" />
          How do I say…?
          <InfoHint {...PAGE_HINTS["how-do-i-say"]} size="md" />
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Translate a phrase, ask what to say in a situation, or get a reply suggestion for a conversation.
        </p>
      </div>

      {/* Instructions card */}
      <Card className="mb-5 border-primary/20 bg-primary/5">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowInstructions((v) => !v)}
          aria-expanded={showInstructions}
        >
          <span className="text-sm font-semibold text-primary flex items-center gap-2">
            <Info className="h-4 w-4" />
            How to use this page
          </span>
          {showInstructions ? (
            <ChevronUp className="h-4 w-4 text-primary/70" />
          ) : (
            <ChevronDown className="h-4 w-4 text-primary/70" />
          )}
        </button>
        {showInstructions && (
          <CardContent className="pt-0 pb-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 p-1.5 rounded-md bg-primary/10">
                <Languages className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Translate a phrase</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Type any word or phrase in English.
                </p>
                <p className="text-xs text-muted-foreground/60 italic mt-0.5">
                  e.g. "I'm exhausted" · "can we leave now?" · "thank you so much"
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 p-1.5 rounded-md bg-primary/10">
                <MapPin className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Describe a situation</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Explain the context and ask what you should say.
                </p>
                <p className="text-xs text-muted-foreground/60 italic mt-0.5">
                  e.g. "I'm at a restaurant and want to ask for more water" · "I need to politely refuse an invitation from a colleague"
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5 p-1.5 rounded-md bg-primary/10">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Paste a conversation</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Paste a chat exchange and get a suggested {activeDialect === 'Egyptian' ? 'Egyptian' : 'Gulf'} Arabic reply.
                </p>
                <p className="text-xs text-muted-foreground/60 italic mt-0.5">
                  e.g. Paste a WhatsApp chat or text messages — the AI will read the conversation and suggest what to say back.
                </p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Search input */}
      <div className="flex gap-2 mb-6 items-start">
        <Textarea
          value={phraseInput}
          onChange={(e) => setPhraseInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !isLoading) {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder={"Type a phrase, describe a situation, or paste a conversation…\n(Shift + Enter for a new line)"}
          className="flex-1 resize-none min-h-[80px]"
          rows={3}
          disabled={isLoading}
        />
        <Button
          onClick={handleSearch}
          disabled={isLoading || !phraseInput.trim()}
          className="gap-2 shrink-0 h-10 mt-0.5"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking…
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              Ask
            </>
          )}
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-5">

          {/* Detected mode + context */}
          {result.detectedContext && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/40 border border-border/50">
              <Badge variant="outline" className="shrink-0 capitalize text-xs">
                {result.inputMode === "translation"
                  ? "Translation"
                  : result.inputMode === "scenario"
                  ? "Situation"
                  : "Conversation"}
              </Badge>
              <p className="text-sm text-muted-foreground leading-snug">{result.detectedContext}</p>
            </div>
          )}

          {/* Situation summary (scenario / conversation modes) */}
          {result.situationSummary && (
            <p className="text-xs text-muted-foreground/70 italic -mt-2 px-1">
              {result.situationSummary}
            </p>
          )}

          {/* Translations */}
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {result.inputMode === "scenario"
                ? "What to say in this situation"
                : result.inputMode === "conversation"
                ? "How to respond"
                : `Ways to say it in ${activeDialect === 'Egyptian' ? 'Egyptian' : 'Gulf'} Arabic`}
            </h2>
            <div className="space-y-3">
              {result.translations.map((t, idx) => (
                <Card
                  key={idx}
                  className={cn(
                    "border",
                    t.isPreferred
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-border bg-card",
                  )}
                >
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {t.isPreferred && (
                          <Badge
                            variant="default"
                            className="mb-2 text-xs gap-1 bg-primary/90"
                          >
                            <Star className="h-3 w-3 fill-current" />
                            Best option
                          </Badge>
                        )}
                        {/* Arabic phrase */}
                        <p
                          className="text-2xl font-semibold text-foreground leading-snug"
                          dir="rtl"
                          style={{ fontFamily: "'Amiri', serif" }}
                        >
                          {t.arabic}
                        </p>
                        {/* Transliteration */}
                        <p className="text-sm text-primary/80 mt-1 italic">{t.transliteration}</p>
                        {/* Back-translation */}
                        <p className="text-sm text-muted-foreground mt-0.5">{t.english}</p>
                        {/* Context */}
                        {t.context && (
                          <p className="text-xs text-muted-foreground/70 mt-1.5 italic">
                            {t.context}
                          </p>
                        )}
                        {/* Naturalness stars */}
                        <div className="mt-2">
                          <NaturalnessStars value={t.naturalness} />
                        </div>
                      </div>

                      {/* Save phrase button */}
                      {isAuthenticated && (
                        <button
                          onClick={() => handleSavePhrase(t)}
                          disabled={savedPhrases.has(t.arabic)}
                          className={cn(
                            "shrink-0 p-2 rounded-lg transition-all",
                            savedPhrases.has(t.arabic)
                              ? "text-primary bg-primary/10"
                              : "text-muted-foreground hover:text-primary hover:bg-primary/10",
                          )}
                          title={savedPhrases.has(t.arabic) ? "Saved" : "Save phrase"}
                        >
                          {savedPhrases.has(t.arabic) ? (
                            <BookmarkCheck className="h-5 w-5" />
                          ) : (
                            <Bookmark className="h-5 w-5" />
                          )}
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Cultural notes */}
          {result.culturalNotes && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  Cultural Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {result.culturalNotes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Gender variants */}
          {result.genderVariants && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Gender Variants
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {result.genderVariants}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Vocabulary breakdown */}
          {result.vocabulary.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Vocabulary Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.vocabulary.map((word, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className="text-lg font-semibold text-foreground shrink-0"
                          dir="rtl"
                          style={{ fontFamily: "'Amiri', serif" }}
                        >
                          {word.arabic}
                        </span>
                        <span className="text-sm text-muted-foreground truncate">
                          {word.english}
                        </span>
                        {word.root && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            Root: {word.root}
                          </Badge>
                        )}
                      </div>
                      {isAuthenticated && (
                        <button
                          onClick={() => handleSaveWord(word)}
                          disabled={savedWords.has(word.arabic)}
                          className={cn(
                            "shrink-0 p-1.5 rounded-lg transition-all ml-2",
                            savedWords.has(word.arabic)
                              ? "text-primary"
                              : "text-muted-foreground hover:text-primary hover:bg-primary/10",
                          )}
                          title={savedWords.has(word.arabic) ? "Saved" : "Save word"}
                        >
                          {savedWords.has(word.arabic) ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Try another */}
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => {
              setResult(null);
              setPhraseInput("");
              setSavedWords(new Set());
              setSavedPhrases(new Set());
            }}
          >
            <Search className="h-4 w-4" />
            Try another phrase
          </Button>
        </div>
      )}
    </AppShell>
  );
};

export default HowDoISay;
