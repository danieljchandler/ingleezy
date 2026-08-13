import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, Loader2, X, Sparkles, Languages, BookOpen, Image as ImageIcon, Video, Plus, Check, Laugh, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { HomeButton } from "@/components/HomeButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { LineByLineTranscript } from "@/components/transcript/LineByLineTranscript";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import type { MemeAnalysisResult } from "@/types/meme";
import type { VocabItem } from "@/types/transcript";
import { AppShell } from "@/components/layout/AppShell";
import { extractFramesWithTimestamps } from "@/lib/videoFrameExtractor";
import { decodeAudioFile, clipToWav } from "@/lib/audioClipper";
import { findLineContainingWord } from "@/lib/vocabularyAudioContext";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

/**
 * Convert an image file to base64 data URI
 */
async function imageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MemeAnalyzer = () => {
  const { user, isAuthenticated } = useAuth();

  const addUserVocabulary = useAddUserVocabulary();
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [vocabSectionWords, setVocabSectionWords] = useState<Set<string>>(new Set());

  const [file, setFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MemeAnalysisResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const isVid = selectedFile.type.startsWith("video/");
    const isImg = selectedFile.type.startsWith("image/");

    if (!isVid && !isImg) {
      toast.error("Unsupported file type", { description: "Please upload an image or video file" });
      return;
    }

    setFile(selectedFile);
    setIsVideo(isVid);
    setResult(null);
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaPreviewUrl(URL.createObjectURL(selectedFile));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (!droppedFile) return;

    const isVid = droppedFile.type.startsWith("video/");
    const isImg = droppedFile.type.startsWith("image/");

    if (!isVid && !isImg) {
      toast.error("Unsupported file type", { description: "Please upload an image or video file" });
      return;
    }

    setFile(droppedFile);
    setIsVideo(isVid);
    setResult(null);
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaPreviewUrl(URL.createObjectURL(droppedFile));
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setIsVideo(false);
    setSavedWords(new Set());
    setVocabSectionWords(new Set());
    if (mediaPreviewUrl) {
      URL.revokeObjectURL(mediaPreviewUrl);
      setMediaPreviewUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAddToVocabSection = useCallback((word: VocabItem) => {
    setVocabSectionWords((prev) => new Set(prev).add(word.arabic));
  }, []);

  const handleSaveToMyWords = useCallback(async (word: VocabItem) => {
    if (!isAuthenticated || !user) {
      toast.error("Please log in to save words");
      return;
    }

    // Resolve sentence context: use provided or auto-match from audio lines
    let resolvedSentenceText = word.sentenceText;
    let resolvedSentenceEnglish = word.sentenceEnglish;
    let resolvedStartMs = word.startMs;
    let resolvedEndMs = word.endMs;

    if (!resolvedSentenceText) {
      const allLines = [...(result?.audioText?.lines ?? []), ...(result?.onScreenText?.lines ?? [])];
      const matched = findLineContainingWord(
        allLines.map(l => ({ arabic: l.arabic, translation: l.translation, startMs: l.startMs, endMs: l.endMs })),
        word.arabic
      );
      if (matched) {
        resolvedSentenceText = matched.sentenceText;
        resolvedSentenceEnglish = matched.sentenceEnglish;
        resolvedStartMs = matched.startMs;
        resolvedEndMs = matched.endMs;
      }
    }

    // Clip sentence audio if video file and timing are available
    let sentenceAudioUrl: string | undefined;
    if (isVideo && file && resolvedStartMs !== undefined && resolvedEndMs !== undefined) {
      try {
        const audioBuffer = await decodeAudioFile(file);
        const wavBlob = clipToWav(audioBuffer, resolvedStartMs, resolvedEndMs);
        const clipPath = `sentence-clips/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`;
        const { error: uploadError } = await supabase.storage
          .from("flashcard-audio")
          .upload(clipPath, wavBlob, { contentType: "audio/wav" });
        if (!uploadError) {
          sentenceAudioUrl = supabase.storage.from("flashcard-audio").getPublicUrl(clipPath).data.publicUrl;
        }
      } catch (clipErr) {
        console.warn("Sentence audio clipping failed:", clipErr);
      }
    }

    try {
      await addUserVocabulary.mutateAsync({
        word_arabic: word.arabic,
        word_english: word.english,
        root: word.root,
        source: "meme-analyzer",
        sentence_text: resolvedSentenceText,
        sentence_english: resolvedSentenceEnglish,
        sentence_audio_url: sentenceAudioUrl,
      });
      setSavedWords((prev) => new Set(prev).add(word.arabic));
      toast.success("Saved to My Words!", { description: word.arabic });
    } catch {
      toast.error("Failed to save word");
    }
  }, [isAuthenticated, user, addUserVocabulary, isVideo, file, result]);

  const analyzeMeme = async () => {
    if (!file) return;
    setIsProcessing(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? 90 : prev + Math.random() * 12));
    }, 500);

    try {
      let imageBase64: string | string[];
      let audioTranscript: string | undefined;

      if (isVideo) {
        // Extract frames for vision (up to 4 evenly-spaced frames)
        setProgress(10);
        toast.info("Extracting video frames...");
        const videoFrames = await extractFramesWithTimestamps(file, 4, 4, 1024);
        imageBase64 = videoFrames.map((f) => f.dataUri);

        // Transcribe audio via Deepgram
        setProgress(30);
        toast.info("Transcribing audio...");
        try {
          const formData = new FormData();
          formData.append("audio", file);

          const { data: transcriptionData, error: transcriptionError } = await supabase.functions.invoke(
            "deepgram-transcribe",
            { body: formData }
          );

          if (!transcriptionError && transcriptionData?.text) {
            audioTranscript = transcriptionData.text;
          }
        } catch (err) {
          console.warn("Audio transcription failed, proceeding with vision only:", err);
        }
      } else {
        // Single image
        imageBase64 = await imageToBase64(file);
      }

      // Send to analyze-meme edge function
      setProgress(60);
      toast.info("Analyzing meme with AI...");

      const { data, error } = await supabase.functions.invoke("analyze-meme", {
        body: {
          imageBase64,
          audioTranscript,
          isVideo,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.success || !data?.result) throw new Error(data?.error || "Analysis failed");

      const analysisResult = data.result as MemeAnalysisResult;
      
      // Validate we got meaningful content
      const hasExplanation = analysisResult.memeExplanation?.casual || analysisResult.memeExplanation?.cultural;
      const hasLines = (analysisResult.onScreenText?.lines?.length ?? 0) > 0;
      if (!hasExplanation && !hasLines) {
        throw new Error("The AI couldn't extract any content from this meme. Try a clearer image.");
      }

      setResult(analysisResult);
      setProgress(100);
      toast.success("Meme analyzed! 🎉");
    } catch (err) {
      console.error("Meme analysis error:", err);
      toast.error("Analysis failed", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
    } finally {
      clearInterval(progressInterval);
      setIsProcessing(false);
    }
  };

  const onScreenLines = result?.onScreenText?.lines ?? [];
  const audioLines = result?.audioText?.lines ?? [];
  const vocabulary = [
    ...(result?.onScreenText?.vocabulary ?? []),
    ...(result?.audioText?.vocabulary ?? []),
  ];
  const grammarPoints = [
    ...(result?.onScreenText?.grammarPoints ?? []),
    ...(result?.audioText?.grammarPoints ?? []),
  ];

  return (
    <AppShell>
      <HomeButton />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Laugh className="h-7 w-7 text-primary" />
          Meme Analyzer
          <InfoHint {...PAGE_HINTS["meme"]} size="md" />
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload an Arabic meme to get a full breakdown
        </p>
      </div>

      {/* Upload area */}
      {!file && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-xl p-10 text-center hover:border-primary/40 transition-colors cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">Drop a meme here or tap to upload</p>
          <p className="text-sm text-muted-foreground mt-1">Images and videos supported</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Badge variant="outline" className="gap-1">
              <ImageIcon className="h-3 w-3" /> Images
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Video className="h-3 w-3" /> Videos
            </Badge>
          </div>
        </div>
      )}

      {/* File selected - show preview and analyze button */}
      {file && !result && (
        <div className="space-y-4">
          {/* Media preview */}
          <div className="relative rounded-xl overflow-hidden border border-border bg-card">
            {isVideo ? (
              <video
                src={mediaPreviewUrl!}
                controls
                className="w-full max-h-80 object-contain bg-black"
              />
            ) : (
              <img
                src={mediaPreviewUrl!}
                alt="Meme preview"
                className="w-full max-h-80 object-contain bg-black"
              />
            )}
            <button
              onClick={clearFile}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Analyze button */}
          <Button
            onClick={analyzeMeme}
            disabled={isProcessing}
            className="w-full gap-2"
            size="lg"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze Meme
              </>
            )}
          </Button>

          {isProcessing && (
            <Progress value={progress} className="h-2" />
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Media display */}
          <div className="relative rounded-xl overflow-hidden border border-border bg-card">
            {isVideo ? (
              <video
                src={mediaPreviewUrl!}
                controls
                className="w-full max-h-80 object-contain bg-black"
              />
            ) : (
              <img
                src={mediaPreviewUrl!}
                alt="Analyzed meme"
                className="w-full max-h-80 object-contain bg-black"
              />
            )}
            <button
              onClick={clearFile}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* What's Funny explanation */}
          {(result.memeExplanation?.casual || result.memeExplanation?.cultural) && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Laugh className="h-5 w-5 text-primary" />
                  What's Funny
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {result.memeExplanation.casual && (
                  <p className="text-foreground leading-relaxed">
                    {result.memeExplanation.casual}
                  </p>
                )}
                {result.memeExplanation.cultural && (
                  <div className="pt-2 border-t border-border/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cultural & Linguistic Context</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {result.memeExplanation.cultural}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* On-screen text transcript */}
          {onScreenLines.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Languages className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">On-Screen Text</h2>
              </div>
              <ErrorBoundary name="OnScreenTranscript">
                <LineByLineTranscript
                  lines={onScreenLines}
                  onAddToVocabSection={handleAddToVocabSection}
                  onSaveToMyWords={isAuthenticated ? handleSaveToMyWords : undefined}
                  savedWords={savedWords}
                  vocabSectionWords={vocabSectionWords}
                />
              </ErrorBoundary>
            </div>
          )}

          {/* Audio transcript (video only) */}
          {audioLines.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Languages className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Audio Transcript</h2>
              </div>
              <ErrorBoundary name="AudioTranscript">
                <LineByLineTranscript
                  lines={audioLines}
                  onAddToVocabSection={handleAddToVocabSection}
                  onSaveToMyWords={isAuthenticated ? handleSaveToMyWords : undefined}
                  savedWords={savedWords}
                  vocabSectionWords={vocabSectionWords}
                />
              </ErrorBoundary>
            </div>
          )}

          {/* Vocabulary */}
          {vocabulary.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  Vocabulary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {vocabulary.map((word, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="text-lg font-semibold text-foreground"
                          dir="rtl"
                          style={{ fontFamily: "'Amiri', serif" }}
                        >
                          {word.arabic}
                        </span>
                        <span className="text-sm text-muted-foreground">{word.english}</span>
                        {word.root && (
                          <Badge variant="outline" className="text-xs">
                            Root: {word.root}
                          </Badge>
                        )}
                      </div>
                      {isAuthenticated && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={() => handleSaveToMyWords(word)}
                          disabled={savedWords.has(word.arabic)}
                        >
                          {savedWords.has(word.arabic) ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Grammar Points */}
          {grammarPoints.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Grammar Points
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {grammarPoints.map((point, idx) => (
                    <div key={idx}>
                      <h4 className="font-semibold text-foreground">{point.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{point.explanation}</p>
                      {point.examples && point.examples.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {point.examples.map((ex, exIdx) => (
                            <Badge key={exIdx} variant="secondary" className="text-xs" dir="rtl">
                              {ex}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Analyze another */}
          <Button variant="outline" onClick={clearFile} className="w-full gap-2">
            <Upload className="h-4 w-4" />
            Analyze Another Meme
          </Button>
        </div>
      )}
    </AppShell>
  );
};

export default MemeAnalyzer;
