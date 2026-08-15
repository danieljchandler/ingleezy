import { useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileAudio, X, Check, Loader2, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTutorUpload } from "@/hooks/useTutorUpload";
import { CandidateList } from "@/components/tutor/CandidateList";
import { useAuth } from "@/hooks/useAuth";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";

const TutorUpload = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    step,
    file,
    audioUrl,
    candidates,
    progress,
    progressLabel,
    processFile,
    updateCandidate,
    approveCandidate,
    rejectCandidate,
    createFlashcards,
    setStep,
  } = useTutorUpload();

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const validTypes = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/m4a", "audio/ogg",
      "video/mp4", "video/webm", "video/quicktime", "audio/mp4",
    ];

    if (
      !validTypes.includes(selectedFile.type) &&
      !selectedFile.name.match(/\.(mp3|wav|m4a|ogg|mp4|webm|mov)$/i)
    ) {
      toast.error("نوع ملف غير مدعوم", { description: "ارفع ملف صوت أو فيديو" });
      return;
    }

    processFile(selectedFile);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) processFile(droppedFile);
  }, [processFile]);

  const approvedCount = candidates.filter(c => c.status === "approved").length;

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="text-center mt-20">
          <p className="text-muted-foreground mb-4">سجّل الدخول لاستخدام رفع الدرس</p>
          <Button onClick={() => navigate("/auth")}>تسجيل الدخول</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <HomeButton />
      <h1 className="text-2xl font-heading font-bold text-foreground mb-6 inline-flex items-center gap-2">رفع درس خصوصي <InfoHint {...PAGE_HINTS["tutor-upload"]} size="md" /></h1>

      {/* Upload Step */}
      {step === "upload" && (
        <div className="space-y-6">
          <p className="text-muted-foreground">
            ارفع تسجيلاً لمعلّمك وهو يتحدث الإنجليزية، وسنستخرج مفردات مرشّحة لتراجعها.
          </p>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer",
              "transition-all duration-200",
              "border-border hover:border-primary/40 hover:bg-primary/5"
            )}
          >
            <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="font-medium text-foreground mb-1">أفلت ملف صوت أو فيديو هنا</p>
            <p className="text-sm text-muted-foreground">or click to browse · MP3, WAV, M4A, MP4, WebM</p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Processing Step */}
      {step === "processing" && (
        <div className="space-y-6">
          {file && (
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <FileAudio className="h-5 w-5 text-primary shrink-0" />
                <span className="text-sm truncate">{file.name}</span>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{progressLabel}</span>
              <span className="text-sm font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>

          {/*
            statusOverride keeps the real stage label from useTutorUpload as the
            primary line — it's honest, per-stage progress and much better than
            a rotating deck. The Arabic companion is matched to it by prefix.
          */}
          <LoadingPanel
            variant="inline"
            size="sm"
            statusOverride={progressLabel}
            showElapsedAfterSeconds={0}
          />
        </div>
      )}

      {/* Review Step */}
      {step === "review" && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            راجع المفردات المستخرجة. عدّل أو اعتمد أو ارفض كل مرشّح.
          </p>

          <CandidateList
            candidates={candidates}
            audioUrl={audioUrl}
            onUpdate={updateCandidate}
            onApprove={approveCandidate}
            onReject={rejectCandidate}
          />

          {approvedCount > 0 && (
            <div className="sticky bottom-4 flex justify-center">
              <Button
                size="lg"
                onClick={createFlashcards}
                className="shadow-lg"
              >
                <Check className="h-5 w-5 mr-2" />
                Create {approvedCount} Flashcard{approvedCount !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Creating Step */}
      {step === "creating" && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{progressLabel}</span>
              <span className="text-sm font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">نسوّي البطاقات…</span>
          </div>
        </div>
      )}

      {/* Confirm/Done Step */}
      {step === "confirm" && (
        <div className="text-center space-y-6 py-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-heading font-bold mb-2">جهزت البطاقات!</h2>
            <p className="text-muted-foreground">
              {approvedCount} new word{approvedCount !== 1 ? "s" : ""} added to your vocabulary
            </p>
          </div>
          <div className="flex flex-col gap-3 max-w-xs mx-auto">
            <Button onClick={() => navigate("/my-words")}>
              <BookOpen className="h-4 w-4 mr-2" />
              افتح كلماتي
            </Button>
            <Button variant="outline" onClick={() => {
              setStep("upload");
            }}>
              ارفع مقطعاً ثانياً
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default TutorUpload;
