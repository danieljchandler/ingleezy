import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { HomeButton } from "@/components/HomeButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { LineByLineTranscript } from "@/components/transcript/LineByLineTranscript";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { Twitter, Loader2, Search, BookOpen, MessageSquare, Globe, Plus, Check } from "lucide-react";
import type { TranscriptResult, VocabItem, GrammarPoint } from "@/types/transcript";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

/**
 * A post from X, read as English.
 *
 * The line's spoken text is `english` and `arabic` is the dialect scaffold
 * beneath it — the convention in src/types/transcript.ts — so a line with no
 * English is not a line this page can teach from and is dropped. Vocabulary is
 * keyed the same way round: `english` is the item being learned.
 */
function normalizeTranscriptResult(input: TranscriptResult): TranscriptResult {
  const safeLines = Array.isArray(input.lines) ? input.lines : [];
  const safeVocab = Array.isArray(input.vocabulary) ? input.vocabulary : [];
  const safeGrammar = Array.isArray(input.grammarPoints) ? input.grammarPoints : [];

  return {
    rawTranscriptArabic: String(input.rawTranscriptArabic ?? ""),
    culturalContext: input.culturalContext === undefined ? undefined : String(input.culturalContext),
    dialect: input.dialect,
    vocabulary: safeVocab
      .filter((v) => v && typeof v === "object")
      .map((v) => ({
        english: String((v as VocabItem).english ?? ""),
        arabic: String((v as VocabItem).arabic ?? ""),
      }))
      .filter((v) => v.english.length > 0),
    grammarPoints: safeGrammar
      .filter((g) => g && typeof g === "object")
      .map((g) => ({
        title: String((g as GrammarPoint).title ?? ""),
        explanation: String((g as GrammarPoint).explanation ?? ""),
        examples: Array.isArray((g as GrammarPoint).examples)
          ? (g as GrammarPoint).examples!.map(String)
          : undefined,
      }))
      .filter((g) => g.title.length > 0),
    lines: safeLines
      .filter((l) => l && typeof l === "object")
      .map((l, idx) => {
        const line = l as TranscriptResult["lines"][number];
        const tokens = Array.isArray(line.tokens) ? line.tokens : [];
        const arabic = String(line.arabic ?? "");
        return {
          id: typeof line.id === "string" && line.id ? line.id : `line-${idx}`,
          english: String(line.english ?? ""),
          arabic,
          // The scaffold doubles as the line's translation for the components
          // that predate the English path.
          translation: String(line.translation ?? arabic),
          fusha: line.fusha ? String(line.fusha) : undefined,
          literal: line.literal ? String(line.literal) : undefined,
          tokens: tokens
            .filter((t) => t && typeof t === "object")
            .map((t, tIdx) => ({
              id: typeof t.id === "string" && t.id ? t.id : `tok-${idx}-${tIdx}`,
              surface: String(t.surface ?? ""),
              standard: t.standard ? String(t.standard) : undefined,
              gloss: t.gloss ? String(t.gloss) : undefined,
            }))
            .filter((t) => t.surface.length > 0),
        };
      })
      .filter((l) => (l.english ?? "").length > 0),
  };
}

/** Extracts the real error message from a supabase.functions.invoke error.
 *  The SDK wraps non-2xx responses in FunctionsHttpError whose `.message` is
 *  always the generic "Edge Function returned a non-2xx status code".
 *  The actual JSON body (with our own `error` field) lives in `.context`. */
async function readInvokeError(err: unknown): Promise<string> {
  if (!err || typeof err !== "object") return String(err);
  const context = (err as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch { /* ignore parse failure */ }
  }
  return (err as Error).message ?? "خطأ غير معروف";
}

const LearnFromX = () => {
  const { isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const addUserVocabulary = useAddUserVocabulary();

  const [urlInput, setUrlInput] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());

  const vocabulary = result?.vocabulary ?? [];
  const grammarPoints = result?.grammarPoints ?? [];
  const culturalContext = result?.culturalContext;
  const lines = result?.lines ?? [];

  const handleAnalyze = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    // Validate it looks like an X/Twitter URL
    const isXUrl = /^https?:\/\/(x\.com|twitter\.com)\/.+\/status\/\d+/i.test(trimmed);
    if (!isXUrl) {
      toast.error("رابط غير صالح", { description: "الصق رابط منشور من X، مثل https://x.com/username/status/123" });
      return;
    }

    setResult(null);
    setExtractedText(null);
    setIsScraping(true);

    try {
      // Step 1: Scrape the post text
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke("scrape-x-post", {
        body: { url: trimmed },
      });

      if (scrapeError) throw new Error(await readInvokeError(scrapeError));
      if (!scrapeData?.success) throw new Error(scrapeData?.error ?? "تعذّر استخراج نص المنشور");

      const text: string = scrapeData.text;
      setExtractedText(text);
      setIsScraping(false);
      setIsAnalyzing(true);

      toast.success("تم استخراج المنشور!", { description: "نحلّل الإنجليزي…" });

      // Step 2: break the English down, scaffolded in the learner's dialect
      const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke("analyze-english-text", {
        body: { text, dialect: activeDialect },
      });

      if (analyzeError) throw new Error(await readInvokeError(analyzeError));
      if (!analyzeData?.success || !analyzeData.result) throw new Error(analyzeData?.error ?? "فشل التحليل");

      const normalized = normalizeTranscriptResult(analyzeData.result);
      setResult(normalized);

      toast.success("خلص التحليل!", {
        description: `لقينا ${normalized.vocabulary.length} كلمة`,
      });
    } catch (err) {
      console.error("Error:", err);
      toast.error("فشل", { description: err instanceof Error ? err.message : "صار خطأ غير متوقع" });
    } finally {
      setIsScraping(false);
      setIsAnalyzing(false);
    }
  };

  const handleSaveWord = async (vocab: VocabItem) => {
    if (!isAuthenticated) {
      toast.error("سجّل دخولك عشان تحفظ الكلمات");
      return;
    }
    // Keyed lowercase to match TappableEnglishText, which is the other way
    // into this handler — otherwise a word saved from the transcript would
    // still show as unsaved in the vocabulary list.
    const key = vocab.english.toLowerCase();
    if (savedWords.has(key)) return;

    // Match to a line for sentence context.
    const matchedLine = lines.find((l) =>
      (l.english ?? "").toLowerCase().includes(key),
    );

    try {
      await addUserVocabulary.mutateAsync({
        // word_english is the English being learned; word_arabic its gloss.
        word_english: vocab.english,
        word_arabic: vocab.arabic,
        source: "x_post",
        sentence_text: vocab.sentenceText ?? matchedLine?.arabic,
        sentence_english: vocab.sentenceEnglish ?? matchedLine?.english,
      });
      setSavedWords((prev) => new Set([...prev, key]));
      toast.success(`حفظنا "${vocab.english}"`);
    } catch {
      toast.error("تعذّر حفظ الكلمة");
    }
  };

  const isLoading = isScraping || isAnalyzing;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <HomeButton />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Twitter className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground inline-flex items-center gap-2">
                تعلّم من منشور X
                <InfoHint {...PAGE_HINTS["learn-from-x"]} />
              </h1>
              <p className="text-xs text-muted-foreground">الصق رابط منشور إنجليزي ونحلّله لك</p>
            </div>
          </div>
        </div>

        {/* URL input */}
        <Card className="mb-6 border-primary/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex gap-2">
              <Input
                placeholder="https://x.com/username/status/..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isLoading && handleAnalyze()}
                disabled={isLoading}
                className="text-sm font-mono"
                dir="ltr"
              />
              <Button
                onClick={handleAnalyze}
                disabled={!urlInput.trim() || isLoading}
                className="shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Status */}
            {isScraping && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                نجيب المنشور…
              </div>
            )}
            {isAnalyzing && extractedText && (
              <div className="mt-3 space-y-2">
                <LoadingPanel task="analyze" variant="inline" size="sm" />
                <div className="p-3 rounded-lg bg-muted/50 border border-border">
                  {/* The post itself — English, so it reads left to right. */}
                  <p className="font-english text-sm text-foreground leading-relaxed">
                    {extractedText}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        {result && (
          <Tabs defaultValue="transcript" className="space-y-4">
            <TabsList className="w-full">
              <TabsTrigger value="transcript" className="flex-1 gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                المنشور
                <Badge variant="secondary" className="text-xs px-1.5 py-0">{lines.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="vocabulary" className="flex-1 gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                المفردات
                <Badge variant="secondary" className="text-xs px-1.5 py-0">{vocabulary.length}</Badge>
              </TabsTrigger>
              {(grammarPoints.length > 0 || culturalContext) && (
                <TabsTrigger value="grammar" className="flex-1 gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  ملاحظات
                </TabsTrigger>
              )}
            </TabsList>

            {/* Transcript Tab */}
            <TabsContent value="transcript">
              <ErrorBoundary name="LineByLineTranscript">
                <LineByLineTranscript
                  lines={lines}
                  onSaveToMyWords={isAuthenticated ? handleSaveWord : undefined}
                  savedWords={savedWords}
                />
              </ErrorBoundary>
            </TabsContent>

            {/* Vocabulary Tab */}
            <TabsContent value="vocabulary">
              <div className="space-y-2">
                {vocabulary.map((vocab) => {
                  const key = vocab.english.toLowerCase();
                  return (
                    <Card key={vocab.english} className="border-border">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {/* English leads — it is the word being learned. */}
                            <span className="font-english text-xl font-bold text-foreground">
                              {vocab.english}
                            </span>
                            <p dir="rtl" className="font-arabic text-sm text-muted-foreground">
                              {vocab.arabic}
                            </p>
                          </div>
                          {isAuthenticated && (
                            <Button
                              variant={savedWords.has(key) ? "secondary" : "ghost"}
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => handleSaveWord(vocab)}
                              disabled={savedWords.has(key) || addUserVocabulary.isPending}
                            >
                              {savedWords.has(key) ? (
                                <Check className="h-4 w-4 text-primary" />
                              ) : (
                                <Plus className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {vocabulary.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">ما طلعت مفردات</p>
                )}
              </div>
            </TabsContent>

            {/* Grammar/Notes Tab */}
            {(grammarPoints.length > 0 || culturalContext) && (
              <TabsContent value="grammar" className="space-y-3">
                {culturalContext && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold text-primary">السياق الثقافي</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                      <p className="text-sm text-foreground">{culturalContext}</p>
                    </CardContent>
                  </Card>
                )}
                {grammarPoints.map((gp, i) => (
                  <Card key={i} className="border-border">
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold text-foreground">{gp.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4">
                      <p className="text-sm text-muted-foreground mb-2">{gp.explanation}</p>
                      {gp.examples && gp.examples.length > 0 && (
                        <ul className="space-y-1">
                          {gp.examples.map((ex, j) => (
                            // Quoted lines from the post — English, so LTR.
                            <li key={j} className="font-english text-sm text-foreground bg-muted/50 rounded px-2 py-1">
                              {ex}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>
            )}
          </Tabs>
        )}

        {/* Empty state */}
        {!result && !isLoading && (
          <div className="text-center py-12 text-muted-foreground">
            <Twitter className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">الصق رابط منشور من X فوق عشان تبدأ</p>
            <p className="text-xs mt-1 opacity-70">أفضل شي مع المنشورات الإنجليزية النصية</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LearnFromX;
