import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddUserPhrase } from "@/hooks/useUserPhrases";

/**
 * Save a sentence out of an assistant reply into My Phrases. The Arabic is
 * pre-filled from the message but editable — replies often carry more than
 * one candidate sentence and the learner picks what they actually want.
 */
export function SavePhraseDialog({
  open,
  onOpenChange,
  initialArabic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialArabic: string;
}) {
  const addPhrase = useAddUserPhrase();
  const [arabic, setArabic] = useState(initialArabic);
  const [english, setEnglish] = useState("");

  useEffect(() => {
    if (open) {
      setArabic(initialArabic);
      setEnglish("");
    }
  }, [open, initialArabic]);

  const save = () => {
    if (!arabic.trim() || !english.trim()) {
      toast.error("Both the Arabic and its meaning are needed.");
      return;
    }
    addPhrase.mutate(
      { phrase_arabic: arabic.trim(), phrase_english: english.trim(), source: "ask-ai" },
      {
        onSuccess: () => {
          toast.success("Saved to My Phrases");
          onOpenChange(false);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Couldn't save the phrase"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Save phrase</DialogTitle>
          <DialogDescription>
            Keep this sentence in My Phrases for spaced-repetition review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="save-phrase-arabic">Arabic</Label>
            <Input
              id="save-phrase-arabic"
              dir="rtl"
              className="font-arabic"
              value={arabic}
              onChange={(e) => setArabic(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="save-phrase-english">Meaning (English)</Label>
            <Input
              id="save-phrase-english"
              value={english}
              onChange={(e) => setEnglish(e.target.value)}
              placeholder="What does it mean?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={addPhrase.isPending} className="gap-2">
            {addPhrase.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save phrase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
