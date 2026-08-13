import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Globe2, MapPin, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

interface DialectVariant {
  dialect: string;
  country: string;
  word: string;
  transliteration: string;
  pronunciation_notes?: string;
  usage_context?: string;
  formality?: string;
}

interface DialectComparison {
  word_arabic: string;
  word_english: string;
  dialects: DialectVariant[];
  cultural_notes?: string;
  common_root?: string;
}

const dialectColors: Record<string, string> = {
  "Gulf Arabic": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  "Egyptian Arabic": "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  "Levantine Arabic": "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  "Yemeni Arabic": "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  "Modern Standard Arabic (MSA)": "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
};

const dialectFlags: Record<string, string> = {
  "Gulf Arabic": "🇦🇪",
  "Egyptian Arabic": "🇪🇬",
  "Levantine Arabic": "🇱🇧",
  "Yemeni Arabic": "🇾🇪",
  "Modern Standard Arabic (MSA)": "📚",
};

const formalityBadge: Record<string, string> = {
  formal: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  casual: "bg-green-500/10 text-green-600 dark:text-green-400",
  slang: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
};

const exampleWords = [
  { arabic: "كيف حالك", english: "How are you?" },
  { arabic: "شكراً", english: "Thank you" },
  { arabic: "ماذا", english: "What" },
  { arabic: "أريد", english: "I want" },
  { arabic: "جميل", english: "Beautiful" },
  { arabic: "الآن", english: "Now" },
];

export default function DialectCompare() {
  const [query, setQuery] = useState("");
  const [comparison, setComparison] = useState<DialectComparison | null>(null);

  const compareMutation = useMutation({
    mutationFn: async (word: string) => {
      const { data, error } = await supabase.functions.invoke("dialect-compare", {
        body: { word, source_dialect: "Gulf" },
      });
      if (error) throw error;
      return data.comparison as DialectComparison;
    },
    onSuccess: (data) => {
      setComparison(data);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      compareMutation.mutate(query.trim());
    }
  };

  const handleExampleClick = (word: string) => {
    setQuery(word);
    compareMutation.mutate(word);
  };

  return (
    <AppShell>
      <HomeButton />
      
      <div className="mt-6 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Globe2 className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold text-foreground inline-flex items-center gap-2">Dialect Compare <InfoHint {...PAGE_HINTS["dialect-compare"]} size="md" /></h1>
        </div>
        <p className="text-muted-foreground">
          See how words differ across Gulf, Egyptian, Levantine, Yemeni Arabic, and MSA
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a word or phrase (Arabic or English)..."
            className="flex-1 text-lg"
            dir="auto"
          />
          <Button 
            type="submit" 
            disabled={compareMutation.isPending || !query.trim()}
            className="px-6"
          >
            {compareMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>

      {/* Example Words */}
      {!comparison && !compareMutation.isPending && (
        <div className="mb-8">
          <p className="text-sm text-muted-foreground mb-3">Try these examples:</p>
          <div className="flex flex-wrap gap-2">
            {exampleWords.map((word) => (
              <button
                key={word.arabic}
                onClick={() => handleExampleClick(word.arabic)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm",
                  "bg-card border border-border",
                  "hover:border-primary/40 transition-colors"
                )}
              >
                <span className="font-arabic">{word.arabic}</span>
                <span className="text-muted-foreground ml-2">({word.english})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {compareMutation.isPending && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Comparing across dialects...</p>
        </div>
      )}

      {/* Error State */}
      {compareMutation.isError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-destructive">
              Failed to compare dialects. Please try again.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {comparison && !compareMutation.isPending && (
        <div className="space-y-4">
          {/* Header Card */}
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-arabic mb-2" dir="rtl">
                  {comparison.word_arabic}
                </p>
                <p className="text-lg text-muted-foreground">
                  {comparison.word_english}
                </p>
                {comparison.common_root && (
                  <p className="text-sm text-primary mt-2">
                    Root: <span className="font-arabic">{comparison.common_root}</span>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Dialect Cards */}
          <div className="grid gap-3">
            {comparison.dialects.map((variant) => (
              <Card 
                key={variant.dialect}
                className={cn(
                  "border",
                  dialectColors[variant.dialect] || "border-border"
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{dialectFlags[variant.dialect] || "🌍"}</span>
                      <CardTitle className="text-base">{variant.dialect}</CardTitle>
                    </div>
                    {variant.formality && (
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs",
                          formalityBadge[variant.formality.toLowerCase()] || ""
                        )}
                      >
                        {variant.formality}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {variant.country}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-arabic" dir="rtl">
                      {variant.word}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground italic">
                    {variant.transliteration}
                  </p>
                  {variant.pronunciation_notes && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                      🔊 {variant.pronunciation_notes}
                    </p>
                  )}
                  {variant.usage_context && (
                    <p className="text-sm text-foreground/80">
                      {variant.usage_context}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Cultural Notes */}
          {comparison.cultural_notes && (
            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  💡 Cultural Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {comparison.cultural_notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Try Another */}
          <div className="text-center pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setComparison(null);
                setQuery("");
              }}
            >
              Compare Another Word
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
