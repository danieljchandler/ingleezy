import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserVocabulary, useUserVocabularyDueCount, useDeleteUserVocabulary } from "@/hooks/useUserVocabulary";
import { Button } from "@/components/ui/button";
import { BookOpen, Trash2, Loader2, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDialect } from "@/contexts/DialectContext";
import { ChevronOpen } from "@/components/shared/DirectionalIcon";

export const MyWordsSection = () => {
  const navigate = useNavigate();
  const [mixAll, setMixAll] = useState(false);
  const { activeDialect } = useDialect();
  const { data: words, isLoading } = useUserVocabulary(mixAll);
  const { data: stats } = useUserVocabularyDueCount(mixAll);
  const deleteWord = useDeleteUserVocabulary();

  const handleDelete = async (wordId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteWord.mutateAsync(wordId);
      toast.success("انحذفت الكلمة");
    } catch (error) {
      toast.error("تعذّر حذف الكلمة");
    }
  };

  if (isLoading) {
    return (
      <div className="mb-8 p-5 rounded-xl bg-card border border-border">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!words || words.length === 0) {
    return null;
  }

  const recentWords = words.slice(0, 5);

  return (
    <div className="mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-foreground">كلماتي</h2>
          <span className="text-sm text-muted-foreground">
            ({words.length})
          </span>
          <Button
            variant={mixAll ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setMixAll(!mixAll)}
          >
            <Shuffle className="h-3 w-3" />
            {mixAll ? "Mixed" : activeDialect}
          </Button>
        </div>
        {stats && stats.dueCount > 0 && (
          <Button
            variant="default"
            size="sm"
            // The count above is across every dialect when Mixed is on, so the
            // deck has to be told. Without this the button promised "Review 3
            // due" and opened a session holding only the words from whichever
            // dialect happened to be active — the two screens disagreed and
            // neither explained the gap.
            onClick={() => navigate(mixAll ? "/review/my-words?mixed=1" : "/review/my-words")}
            className="gap-1.5"
          >
            Review {stats.dueCount} due
            <ChevronOpen className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Word list */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        {recentWords.map((word, index) => (
          <div
            key={word.id}
            className={cn(
              "flex items-center justify-between p-4",
              "hover:bg-muted/50 transition-colors",
              index < recentWords.length - 1 && "border-b border-border"
            )}
          >
            <div className="flex items-center gap-4">
              <span
                className="text-xl font-bold text-foreground"
                style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                dir="rtl"
              >
                {word.word_arabic}
              </span>
              {word.root && (
                <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {word.root}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {word.word_english}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={(e) => handleDelete(word.id, e)}
                disabled={deleteWord.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        
        {words.length > 5 && (
          <button
            onClick={() => navigate("/my-words")}
            className="w-full p-3 text-sm text-primary hover:bg-muted/50 transition-colors"
          >
            View all {words.length} words
          </button>
        )}
      </div>
    </div>
  );
};
