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
import { TappableArabicText } from "@/components/shared/TappableArabicText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { useTranslateText } from "@/hooks/useTranslateText";
import { useSavedTranslations } from "@/hooks/useSavedTranslations";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BookOpen, Check, Languages, Loader2, BookmarkPlus, Info, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

type DialectOpt = "auto" | "Gulf" | "Egyptian" | "Yemeni";

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "Gulf",
    text: "شخبارك؟ والله زمان ما شفتك. تعال نشرب قهوة بكره الصبح إن شاء الله.",
  },
  {
    label: "Egyptian",
    text: "إزيك يا صاحبي؟ كنت فاكرك. تعالى نتقابل بكرة في وسط البلد ونتغدى سوا.",
  },
];

const PAGE_HINT = {
  title: "Translate & Save",
  body: "Paste any Arabic text — Gulf, Egyptian, or Yemeni — and get a sentence-by-sentence breakdown with literal and natural translations, plus cultural notes when it matters. Tap any word to save it to My Words.",
};

const Translate = () => {
  const { activeDialect } = useDialect();
  const { isAuthenticated } = useAuth();
  const { translate, loading, result, error, reset } = useTranslateText();
  const { save } = useSavedTranslations();

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
        toast.success("Saved — open it any time from Saved Translations");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Paste some Arabic text first");
      return;
    }
    if (trimmed.length > 4000) {
      toast.error("Text is too long (max ~4000 characters)");
      return;
    }
    try {
      setSavedId(null);
      await translate(trimmed, dialectOpt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Translation failed";
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
            Translate & Save
            <InfoHint title={PAGE_HINT.title} body={PAGE_HINT.body} />
          </h1>
          {isAuthenticated ? (
            <Button asChild variant="ghost" size="icon" aria-label="Saved translations">
              <Link to="/translate/saved"><BookOpen className="h-5 w-5" /></Link>
            </Button>
          ) : (
            <div className="w-9" />
          )}
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <Textarea
              dir="rtl"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ألصق نصاً عربياً هنا..."
              className="min-h-[140px] text-base leading-relaxed"
              maxLength={4200}
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Dialect</span>
                <Select value={dialectOpt} onValueChange={(v) => setDialectOpt(v as DialectOpt)}>
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
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
                    Clear
                  </Button>
                )}
                <Button onClick={onSubmit} disabled={loading || !text.trim()}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Translating…
                    </>
                  ) : (
                    "Translate"
                  )}
                </Button>
              </div>
            </div>

            {!result && !loading && (
              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-2">Try an example:</p>
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
                Detected: {detectedDialect}
              </Badge>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <BookmarkPlus className="h-3.5 w-3.5" />
                Tap any Arabic word to save it
              </p>
            </div>

            {result.sentences.map((s, i) => (
              <Card key={i} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <TappableArabicText
                    text={s.arabic}
                    vocabulary={exampleSentenceVocab}
                    source="translate-text"
                    sentenceContext={{ arabic: s.arabic, english: s.natural }}
                  />
                  <TranslationPair
                    variant="grid"
                    literal={s.literal}
                    natural={s.natural}
                    className="pt-1 border-t border-border/40"
                  />
                  {s.note && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 flex gap-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-200">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <p>{s.note}</p>
                    </div>
                  )}
                  <div className="flex justify-start pt-1 border-t border-border/40">
                    <AskAISentence arabic={s.arabic} english={s.natural} variant="chip" />
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
                    <><Check className="h-4 w-4 mr-1" /> Saved</>
                  ) : (
                    <><Save className="h-4 w-4 mr-1" /> Save translation</>
                  )}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/translate/saved">
                    <BookOpen className="h-4 w-4 mr-1" /> Saved translations
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link to="/my-words">Go to My Words</Link>
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
