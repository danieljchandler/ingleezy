import { useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranscriptionJob } from "@/contexts/TranscriptionJobContext";

export function TranscriptionStatusBanner() {
  const { job, clearJob } = useTranscriptionJob();
  const navigate = useNavigate();

  if (!job || job.status === "complete" || job.status === "error") {
    // Only show on error so user can dismiss
    if (!job || job.status !== "error") return null;

    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full bg-destructive text-destructive-foreground rounded-lg shadow-lg p-4 flex items-start gap-3">
        <XCircle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Transcription failed</p>
          {job.error && <p className="text-xs mt-1 opacity-90 truncate">{job.error}</p>}
        </div>
        <button
          onClick={clearJob}
          className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Running state
  const formPath = job.videoId
    ? `/admin/videos/${job.videoId}/edit`
    : "/admin/videos/new";

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full bg-card border rounded-lg shadow-lg p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <span className="text-sm font-semibold truncate">Transcribing in background</span>
        </div>
        {/*
          "Hide", not "Cancel job". Its only action is clearJob(), which drops
          the local record: the pipeline runs in the process-approved-video edge
          function and knows nothing about this click, so it keeps going, keeps
          spending on the ASR and translation calls, and eventually writes its
          result to a video the admin believed they had cancelled. Worse, this
          banner is the only handle on that job, so an admin who meant to stop a
          run had instead made it invisible. Actually cancelling needs an
          endpoint that does not exist yet; until then the label should not
          claim more than the button does.
        */}
        <button
          onClick={clearJob}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Hide"
          title="Hide this banner — the transcription keeps running"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <Progress value={job.progress} className="h-1.5" />
      <p className="text-xs text-muted-foreground">{job.progressLabel}</p>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => navigate(formPath)}
      >
        Return to form
      </Button>
    </div>
  );
}
