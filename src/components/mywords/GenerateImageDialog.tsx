import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, RefreshCw, Lock, Dices } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useImageStyleLock, composeStyledInstructions } from "@/hooks/useImageStyleLock";
import { showCapToastIfLimited } from "@/lib/handleCapResponse";

export interface GenerateImageWord {
  id: string;
  word_arabic: string;
  word_english: string;
  image_url?: string | null;
}

interface GenerateImageDialogProps {
  word: GenerateImageWord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageSaved?: (wordId: string, imageUrl: string) => void;
}

export const GenerateImageDialog = ({ word, open, onOpenChange, onImageSaved }: GenerateImageDialogProps) => {
  const [customInstructions, setCustomInstructions] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const styleLock = useImageStyleLock();

  const handleGenerate = async () => {
    if (!word) return;
    setIsGenerating(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const composed = composeStyledInstructions(customInstructions, styleLock);

      const { data, error } = await supabase.functions.invoke("generate-flashcard-image", {
        body: {
          word_arabic: word.word_arabic,
          word_english: word.word_english,
          custom_instructions: composed,
        },
      });

      if (showCapToastIfLimited(error, data)) return;
      if (error) throw error;
      if (data?.fallback || !data?.imageUrl) {
        throw new Error(data?.message || "Image generation is temporarily unavailable. Please try again.");
      }

      const urlWithCacheBust = `${data.imageUrl}?t=${Date.now()}`;

      if (onImageSaved) {
        onImageSaved(word.id, urlWithCacheBust);
      }

      setPreviewUrl(urlWithCacheBust);
      toast.success("Image generated!");
    } catch (err: any) {
      console.error("Image generation failed:", err);
      toast.error(err.message || "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  };

  const currentImage = previewUrl || word?.image_url;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setPreviewUrl(null); setCustomInstructions(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Generate Flashcard Image
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <p className="text-lg font-bold" dir="rtl" style={{ fontFamily: "'Amiri', serif" }}>
              {word?.word_arabic}
            </p>
            <p className="text-sm text-muted-foreground">{word?.word_english}</p>
          </div>

          {currentImage && (
            <div className="flex justify-center">
              <img
                src={currentImage}
                alt={word?.word_english || ""}
                className="w-48 h-48 object-cover rounded-xl border border-border"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Describe the picture you want (optional)
            </label>
            <Textarea
              placeholder="e.g. a red apple on a wooden table, close-up..."
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={3}
              disabled={isGenerating}
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-primary" />
                Lock my style
              </label>
              <Switch
                checked={styleLock.enabled}
                onCheckedChange={styleLock.setEnabled}
                disabled={isGenerating}
              />
            </div>
            {styleLock.enabled && (
              <>
                <Textarea
                  value={styleLock.description}
                  onChange={(e) => styleLock.setDescription(e.target.value)}
                  rows={2}
                  disabled={isGenerating}
                  className="text-xs"
                  placeholder="Your signature style (lighting, mood, background...)"
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Seed: <code className="font-mono">{styleLock.seed}</code></span>
                  <button
                    type="button"
                    onClick={styleLock.regenerateSeed}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <Dices className="h-3 w-3" />
                    New seed
                  </button>
                </div>
              </>
            )}
            {!styleLock.enabled && (
              <p className="text-[11px] text-muted-foreground">
                Keep a consistent look across all your flashcard images.
              </p>
            )}
          </div>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : currentImage ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Regenerate Image
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Image
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
