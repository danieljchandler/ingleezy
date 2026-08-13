import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Check, X, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CandidateData {
  id: string;
  word_text: string;
  word_standard?: string;
  word_english: string;
  sentence_text?: string;
  sentence_english?: string;
  word_start_ms: number;
  word_end_ms: number;
  sentence_start_ms?: number;
  sentence_end_ms?: number;
  confidence: number;
  classification: "CONCRETE" | "ACTION" | "ABSTRACT";
  status: "pending" | "approved" | "rejected";
  image_enabled: boolean;
}

interface CandidateCardProps {
  candidate: CandidateData;
  audioUrl: string | null;
  onUpdate: (id: string, updates: Partial<CandidateData>) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function CandidateCard({ candidate, audioUrl, onUpdate, onApprove, onReject }: CandidateCardProps) {
  const [playingWord, setPlayingWord] = useState(false);
  const [playingSentence, setPlayingSentence] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playClip = useCallback((startMs: number, endMs: number, type: "word" | "sentence") => {
    if (!audioUrl) return;

    // Stop any existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    const startSec = Math.max(0, (startMs - 250) / 1000);
    const endSec = (endMs + 250) / 1000;

    audio.currentTime = startSec;

    const setter = type === "word" ? setPlayingWord : setPlayingSentence;
    setter(true);

    const onTimeUpdate = () => {
      if (audio.currentTime >= endSec) {
        audio.pause();
        setter(false);
        audio.removeEventListener("timeupdate", onTimeUpdate);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", () => setter(false));
    audio.addEventListener("error", () => setter(false));
    audio.play().catch(() => setter(false));
  }, [audioUrl]);

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingWord(false);
    setPlayingSentence(false);
  };

  const isLowConfidence = candidate.confidence < 0.6;
  const isDecided = candidate.status !== "pending";
  const suggestImage = candidate.classification === "CONCRETE" || candidate.classification === "ACTION";

  return (
    <div className={cn(
      "rounded-xl border p-4 transition-all",
      candidate.status === "approved" && "border-primary/40 bg-primary/5",
      candidate.status === "rejected" && "border-destructive/30 bg-destructive/5 opacity-60",
      candidate.status === "pending" && "border-border bg-card",
    )}>
      {/* Confidence warning */}
      {isLowConfidence && candidate.status === "pending" && (
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-accent/10 border border-accent/30">
          <AlertTriangle className="h-4 w-4 text-accent shrink-0" />
          <span className="text-xs text-accent">Low confidence — please verify</span>
        </div>
      )}

      {/* Word section */}
      <div className="flex items-start gap-3 mb-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 mt-0.5"
          onClick={() => playingWord ? stopPlayback() : playClip(candidate.word_start_ms, candidate.word_end_ms, "word")}
          disabled={!audioUrl}
        >
          {playingWord ? <Pause className="h-4 w-4 text-primary" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex-1 min-w-0">
          <Input
            value={candidate.word_text}
            onChange={(e) => onUpdate(candidate.id, { word_text: e.target.value })}
            className="font-arabic text-lg text-right mb-1"
            dir="rtl"
            disabled={isDecided}
          />
          <Input
            value={candidate.word_english}
            onChange={(e) => onUpdate(candidate.id, { word_english: e.target.value })}
            className="text-sm text-muted-foreground"
            placeholder="English meaning"
            disabled={isDecided}
          />
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {candidate.classification.toLowerCase()}
        </Badge>
      </div>

      {/* Sentence section */}
      {candidate.sentence_text && (
        <div className="flex items-start gap-3 mb-3 ml-8">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 mt-0.5"
            onClick={() => {
              if (candidate.sentence_start_ms != null && candidate.sentence_end_ms != null) {
                playingSentence ? stopPlayback() : playClip(candidate.sentence_start_ms, candidate.sentence_end_ms, "sentence");
              }
            }}
            disabled={!audioUrl || candidate.sentence_start_ms == null}
          >
            {playingSentence ? <Pause className="h-4 w-4 text-primary" /> : <Play className="h-4 w-4 text-muted-foreground" />}
          </Button>
          <div className="flex-1 min-w-0">
            <Input
              value={candidate.sentence_text}
              onChange={(e) => onUpdate(candidate.id, { sentence_text: e.target.value })}
              className="font-arabic text-sm text-right mb-1"
              dir="rtl"
              disabled={isDecided}
            />
            {candidate.sentence_english && (
              <p className="text-xs text-muted-foreground px-3">{candidate.sentence_english}</p>
            )}
          </div>
          {!isDecided && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onUpdate(candidate.id, { sentence_text: undefined, sentence_english: undefined, sentence_start_ms: undefined, sentence_end_ms: undefined })}
              title="Remove sentence"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Image toggle + actions */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Add image</span>
          <Switch
            checked={candidate.image_enabled}
            onCheckedChange={(checked) => onUpdate(candidate.id, { image_enabled: checked })}
            disabled={isDecided}
          />
          {!suggestImage && candidate.image_enabled && (
            <span className="text-xs text-accent">Abstract word — image may not be helpful</span>
          )}
        </div>

        {!isDecided && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onReject(candidate.id)}
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(candidate.id)}
            >
              <Check className="h-4 w-4 mr-1" />
              Approve
            </Button>
          </div>
        )}

        {candidate.status === "approved" && (
          <Badge className="bg-primary/10 text-primary border-0">Approved</Badge>
        )}
        {candidate.status === "rejected" && (
          <Badge variant="destructive" className="opacity-70">Rejected</Badge>
        )}
      </div>
    </div>
  );
}
