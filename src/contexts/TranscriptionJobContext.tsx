import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { TranscriptLine, VocabItem, GrammarPoint } from "@/types/transcript";

export type TranscriptionResult = {
  transcriptLines: TranscriptLine[];
  vocabulary: VocabItem[];
  grammarPoints: GrammarPoint[];
  culturalContext: string;
  dialect?: string;
  difficulty?: string;
  title?: string;
  titleArabic?: string;
  durationSeconds?: number;
};

export type JobParams = {
  audioFile: File;
  timeRange: [number, number];
  mediaDuration: number | null;
  videoId?: string;
};

export type TranscriptionJob = {
  id: string;
  videoId?: string;
  status: "running" | "complete" | "error";
  progress: number;
  progressLabel: string;
  error?: string;
  result?: TranscriptionResult;
  startedAt: number;
};

type TranscriptionJobContextType = {
  job: TranscriptionJob | null;
  startJob: (params: JobParams) => void;
  consumeResult: (videoId?: string) => TranscriptionResult | null;
  clearJob: () => void;
};

const TranscriptionJobContext = createContext<TranscriptionJobContextType | null>(null);

export function useTranscriptionJob() {
  const ctx = useContext(TranscriptionJobContext);
  if (!ctx) throw new Error("useTranscriptionJob must be used inside TranscriptionJobProvider");
  return ctx;
}

/**
 * Simplified context — no longer runs the pipeline client-side.
 * Just tracks that a server-side job was kicked off so the UI can show status.
 * The actual pipeline runs in the process-approved-video edge function.
 */
export function TranscriptionJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<TranscriptionJob | null>(null);

  const startJob = useCallback(
    (params: JobParams) => {
      const id = `job-${Date.now()}`;
      setJob({
        id,
        videoId: params.videoId,
        status: "running",
        progress: 50,
        progressLabel: "Processing on server — you can navigate away safely",
        startedAt: Date.now(),
      });
    },
    []
  );

  const consumeResult = useCallback(
    (videoId?: string): TranscriptionResult | null => {
      if (!job || job.status !== "complete") return null;
      if (job.videoId !== videoId) return null;
      const result = job.result ?? null;
      setJob(null);
      return result;
    },
    [job]
  );

  const clearJob = useCallback(() => {
    setJob(null);
  }, []);

  return (
    <TranscriptionJobContext.Provider value={{ job, startJob, consumeResult, clearJob }}>
      {children}
    </TranscriptionJobContext.Provider>
  );
}
