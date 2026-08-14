import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoHint } from "@/components/InfoHint";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { useTranslateText } from "@/hooks/useTranslateText";
import { useSavedTranslations } from "@/hooks/useSavedTranslations";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BookOpen, Check, Languages, Loader2, BookmarkPlus, Info, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

type DialectOpt = "auto" | "Gulf" | "Egyptian" | "Yemeni";

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "رسالة",
    text: "Hey, long time no see! Wanna grab a coffee tomorrow morning? My treat.",
  },
  {
    label: "إيميل",
    text: "Thanks for reaching out. I'll get back to you by the end of the week once I've had a chance to look into it.",
  },
];

const PAGE_HINT = {
  title: "ترجم واحفظ",
  body: "Paste any English text — a message, an email, a post — and get a sentence-by-sentence breakdown in your dialect, with a word-order gloss and notes when an idiom would mislead. Tap any word to save it to My Words.",
};

const Translate = () => {
  const { activeDialect } = useDialect();
  const { isAuthenticated } = useAuth();
  const { translate, loading, result, error, reset } = useTranslateText();
  const { save } = useSavedTranslations();
  const addVocab = useAddUserVocabulary();

  const saveWord = (word: { english: string; arabic: string; sentenceText?: string; sentenceEnglish?: string }) => {
    if (!isAuthenticated) {
      toast.error("سجّل دخولك عشان تحفظ الكلمات");
      return;
    }
    addVocab.mutate(
      {
        word_english: word.english,
        word_arabic: word.arabic,
        source: "translate-text",
        sentence_text: word.sentenceText || undefined,
        sentence_english: word.sentenceEnglish || undefined,
      },
      {
        onSuccess: () => toast.success("حفظناها في كلماتي!"),
        onError: () => toast.error("تعذّر الحفظ"),
      },
    );
  };

  const [text, setText] = useState("");
  const [dialectOpt, setDialectOpt] = useState<DialectOpt>("auto");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const onSave = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const row = await save({
        source_text: text.trim(),
        source_dialect: dialectOpt === "auto" ? null : dialectOpt,
        detected_dialect: result.detected_dialect,
        sentences: result.sentences,
      });
      if (row) {
        setSavedId(row.id);
        toast.success("حفظناها — تلقاها في «الترجمات المحفوظة»");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("الصق نصاً إنجليزياً أول");
      return;
    }
    if (trimmed.length > 4000) {
      toast.error("النص طويل (الحد ٤٠٠٠ حرف تقريباً)");
      return;
    }
    try {
      setSavedId(null);
      // "auto" means the learner's own dialect — there is nothing to detect
      // about pasted English.
      await translate(trimmed, dialectOpt === "auto" ? (activeDialect as DialectOpt) : dialectOpt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "فشلت الترجمة";
      toast.error(msg);
    }
  };

  const onReset = () => {
    setText("");
    setSavedId(null);
    reset();
  };

  const detectedDialect = result?.detected_dialect ?? activeDialect;
  const charCount = text.length;

  const exampleSentenceVocab = useMemo(() => [], []); // reserved for future hints

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <HomeButton />
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Languages className="h-5 w-5 text-primary" />
            ترجم واحفظ
            <InfoHint title={PAGE_HINT.title} body={PAGE_HINT.body} />
          </h1>
          {isAuthenticated ? (
            <Button asChild variant="ghost" size="icon" aria-label="الترجمات المحفوظة">
              <Link to="/translate/saved"><BookOpen className="h-5 w-5" /></Link>
            </Button>
          ) : (
            <div className="w-9" />
          )}
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="الصق النص الإنجليزي هنا…"
              className="min-h-[140px] text-base leading-relaxed font-english"
              maxLength={4200}
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">لهجة الشرح</span>
                <Select value={dialectOpt} onValueChange={(v) => setDialectOpt(v as DialectOpt)}>
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">لهجتي</SelectItem>
                    <SelectItem value="Gulf">Gulf</SelectItem>
                    <SelectItem value="Egyptian">Egyptian</SelectItem>
                    <SelectItem value="Yemeni">Yemeni</SelectItem>
                  </SelectContent>
                </Select>
                <span className={cn("text-xs", charCount > 4000 ? "text-destructive" : "text-muted-foreground")}>
                  {charCount}/4000
                </span>
              </div>
              <div className="flex items-center gap-2">
                {(result || text) && (
                  <Button variant="ghost" size="sm" onClick={onReset} disabled={loading}>
                    <RotateCcw className="h-4 w-4 mr-1" />
                    امسح
                  </Button>
                )}
                <Button onClick={onSubmit} disabled={loading || !text.trim()}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      نترجم…
                    </>
                  ) : (
                    "ترجم"
                  )}
                </Button>
              </div>
            </div>

            {!result && !loading && (
              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-2">جرّب مثالاً:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.label}
                      type="button"
                      onClick={() => setText(ex.text)}
                      className="px-3 py-1.5 rounded-full border border-border text-xs hover:border-primary/40 transition-colors"
                    >
                      {ex.label} example
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                الشرح بلهجة {detectedDialect}
              </Badge>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <BookmarkPlus className="h-3.5 w-3.5" />
                Tap any English word to save it
              </p>
            </div>

            {result.sentences.map((s, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <p className="font-english text-lg leading-relaxed">
                    <TappableEnglishText
                      text={s.english}
                      sentenceArabic={s.arabic}
                      source="translate-text"
                      onSaveWord={saveWord}
                    />
                  </p>
                  <div className="pt-1 border-t border-border/40 space-y-1">
                    <p dir="rtl" className="font-arabic text-base text-foreground">{s.arabic}</p>
                    {s.literal && (
                      <p dir="rtl" className="font-arabic text-sm text-muted-foreground/80">{s.literal}</p>
                    )}
                  </div>
                  {s.note && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 flex gap-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-200">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <p dir="rtl" className="font-arabic flex-1">{s.note}</p>
                    </div>
                  )}
                  <div className="flex justify-start pt-1 border-t border-border/40">
                    <AskAISentence arabic={s.arabic} english={s.english} variant="chip" />
                  </div>
                </CardContent>
              </Card>
            ))}

            {isAuthenticated && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={saving || !!savedId}
                  variant={savedId ? "secondary" : "default"}
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving…</>
                  ) : savedId ? (
                    <><Check className="h-4 w-4 mr-1" /> محفوظة</>
                  ) : (
                    <><Save className="h-4 w-4 mr-1" /> احفظ الترجمة</>
                  )}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/translate/saved">
                    <BookOpen className="h-4 w-4 mr-1" /> الترجمات المحفوظة
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/my-words">روح لكلماتي</Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Translate;
