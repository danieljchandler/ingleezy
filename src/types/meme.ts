import type { TranscriptResult } from "./transcript";

export interface MemeExplanation {
  casual: string;
  cultural: string;
}

export interface MemeAnalysisResult {
  memeExplanation: MemeExplanation;
  onScreenText: TranscriptResult;
  audioText?: TranscriptResult;
  mediaUrl?: string;
}
