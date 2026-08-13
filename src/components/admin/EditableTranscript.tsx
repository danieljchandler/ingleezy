import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play,
  Pause,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";
import type { TranscriptLine, WordToken } from "@/types/transcript";

/* ── Editable Token (inline gloss editing) ────────────── */
const EditableToken = ({
  token,
  onUpdate,
}: {
  token: WordToken;
  onUpdate: (updated: WordToken) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [gloss, setGloss] = useState(token.gloss ?? "");

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 bg-primary/10 rounded px-1 py-0.5">
        <span
          dir="rtl"
          className="text-sm font-medium"
          style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
        >
          {token.surface}
        </span>
        <Input
          value={gloss}
          onChange={(e) => setGloss(e.target.value)}
          className="h-6 w-24 text-xs px-1"
          placeholder="English gloss"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onUpdate({ ...token, gloss: gloss || undefined });
              setEditing(false);
            }
            if (e.key === "Escape") {
              setGloss(token.gloss ?? "");
              setEditing(false);
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={() => {
            onUpdate({ ...token, gloss: gloss || undefined });
            setEditing(false);
          }}
        >
          <Check className="h-3 w-3" />
        </Button>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "cursor-pointer transition-colors rounded px-0.5 group/token inline",
        "hover:bg-primary/10",
        token.gloss ? "text-foreground" : "text-foreground/60"
      )}
      onClick={() => setEditing(true)}
      title={token.gloss ? `${token.gloss}${token.standard ? ` (${token.standard})` : ""}` : "Click to add gloss"}
    >
      {token.surface}
    </span>
  );
};

/* ── Timing Editor ────────────────────────────────────── */
const TimingEditor = ({
  startMs,
  endMs,
  onUpdate,
}: {
  startMs?: number;
  endMs?: number;
  onUpdate: (start: number | undefined, end: number | undefined) => void;
}) => {
  const formatMs = (ms?: number) => {
    if (ms === undefined) return "";
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return `${m}:${sec.padStart(4, "0")}`;
  };

  const parseTime = (val: string): number | undefined => {
    if (!val.trim()) return undefined;
    const parts = val.split(":");
    if (parts.length === 2) {
      return (parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000;
    }
    const n = parseFloat(val);
    return isNaN(n) ? undefined : n * 1000;
  };

  const [startVal, setStartVal] = useState(formatMs(startMs));
  const [endVal, setEndVal] = useState(formatMs(endMs));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setStartVal(formatMs(startMs));
    setEndVal(formatMs(endMs));
  }, [startMs, endMs]);

  if (!open) {
    return (
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(true)}
      >
        <Clock className="h-3 w-3" />
        {startMs !== undefined ? formatMs(startMs) : "—"} → {endMs !== undefined ? formatMs(endMs) : "—"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
      <Input
        value={startVal}
        onChange={(e) => setStartVal(e.target.value)}
        className="h-6 w-16 text-xs px-1"
        placeholder="0:00.0"
      />
      <span className="text-xs text-muted-foreground">→</span>
      <Input
        value={endVal}
        onChange={(e) => setEndVal(e.target.value)}
        className="h-6 w-16 text-xs px-1"
        placeholder="0:05.0"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => {
          onUpdate(parseTime(startVal), parseTime(endVal));
          setOpen(false);
        }}
      >
        <Check className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => {
          setStartVal(formatMs(startMs));
          setEndVal(formatMs(endMs));
          setOpen(false);
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
};

/* ── Single Editable Line Card ────────────────────────── */
const EditableLineCard = ({
  line,
  index,
  isPlaying,
  isActive,
  onPlay,
  hasAudio,
  onUpdate,
  onDelete,
}: {
  line: TranscriptLine;
  index: number;
  isPlaying: boolean;
  isActive: boolean;
  onPlay: () => void;
  hasAudio: boolean;
  onUpdate: (updated: TranscriptLine) => void;
  onDelete: () => void;
}) => {
  const [editingArabic, setEditingArabic] = useState(false);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [arabicVal, setArabicVal] = useState(line.arabic);
  const [translationVal, setTranslationVal] = useState(line.translation);
  const [expanded, setExpanded] = useState(true);

  // Sync with external changes
  useEffect(() => {
    setArabicVal(line.arabic);
    setTranslationVal(line.translation);
  }, [line.arabic, line.translation]);

  const saveArabic = () => {
    onUpdate({ ...line, arabic: arabicVal });
    setEditingArabic(false);
  };

  const saveTranslation = () => {
    onUpdate({ ...line, translation: translationVal });
    setEditingTranslation(false);
  };

  const handleTokenUpdate = (tokenIndex: number, updated: WordToken) => {
    const newTokens = [...line.tokens];
    newTokens[tokenIndex] = updated;
    onUpdate({ ...line, tokens: newTokens });
  };

  return (
    <div
      className={cn(
        "rounded-xl bg-card border border-border p-4 transition-all duration-200",
        "hover:shadow-md",
        isActive && "ring-2 ring-primary/50 border-primary bg-primary/5"
      )}
    >
      {/* Header: play + line number + delete */}
      <div className="flex items-start gap-3">
        {hasAudio && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-full transition-colors",
              isActive
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted hover:bg-muted/80"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          >
            {isActive && isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </Button>
        )}

        <div className="flex-1 min-w-0">
          {/* Arabic sentence - editable */}
          {editingArabic ? (
            <div className="flex gap-2">
              <Input
                value={arabicVal}
                onChange={(e) => setArabicVal(e.target.value)}
                dir="rtl"
                className="flex-1"
                style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveArabic();
                  if (e.key === "Escape") {
                    setArabicVal(line.arabic);
                    setEditingArabic(false);
                  }
                }}
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={saveArabic}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              className="text-lg leading-loose cursor-pointer group"
              dir="rtl"
              style={{ fontFamily: "'Noto Naskh Arabic', 'Traditional Arabic', serif" }}
              onClick={() => setEditingArabic(true)}
            >
              {line.tokens && line.tokens.length > 0 ? (
                line.tokens.map((token, i) => (
                  <span key={token.id} className="inline">
                    <EditableToken
                      token={token}
                      onUpdate={(updated) => handleTokenUpdate(i, updated)}
                    />
                    {i < line.tokens.length - 1 &&
                      !/^[،؟.!:؛]+$/.test(token.surface) && " "}
                  </span>
                ))
              ) : (
                <span className="text-foreground">{line.arabic}</span>
              )}
              <Pencil className="h-3 w-3 text-muted-foreground/50 inline-block mr-2 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* Timing */}
          <div className="mt-1">
            <TimingEditor
              startMs={line.startMs}
              endMs={line.endMs}
              onUpdate={(start, end) =>
                onUpdate({ ...line, startMs: start, endMs: end })
              }
            />
          </div>
        </div>

        {/* Line number + delete */}
        <div className="flex flex-col items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground">#{index + 1}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive/50 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* English translation */}
      <div className={cn("mt-3 pt-3 border-t border-border/50", !expanded && "hidden")}>
        {editingTranslation ? (
          <div className="flex gap-2">
            <Input
              value={translationVal}
              onChange={(e) => setTranslationVal(e.target.value)}
              className="flex-1 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTranslation();
                if (e.key === "Escape") {
                  setTranslationVal(line.translation);
                  setEditingTranslation(false);
                }
              }}
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={saveTranslation}>
              <Check className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground leading-relaxed cursor-pointer hover:text-foreground transition-colors group"
            onClick={() => setEditingTranslation(true)}
            style={{ fontFamily: "'Open Sans', sans-serif" }}
          >
            {line.translation || <span className="italic">Click to add translation</span>}
            <Pencil className="h-3 w-3 inline-block ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
          </p>
        )}
      </div>

      {/* Expand/collapse */}
      <div
        className="flex justify-center mt-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
    </div>
  );
};

/* ── Main EditableTranscript ──────────────────────────── */
export interface EditableTranscriptProps {
  lines: TranscriptLine[];
  onChange: (lines: TranscriptLine[]) => void;
  audioUrl?: string;
}

export const EditableTranscript = ({
  lines,
  onChange,
  audioUrl,
}: EditableTranscriptProps) => {
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lineEndListenerRef = useRef<(() => void) | null>(null);

  // Initialize audio
  useEffect(() => {
    if (audioUrl) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.addEventListener("ended", () => {
        setIsPlaying(false);
        setActiveLineId(null);
      });
      audioRef.current.addEventListener("pause", () => setIsPlaying(false));
      audioRef.current.addEventListener("play", () => setIsPlaying(true));
    }
    return () => {
      if (audioRef.current) {
        if (lineEndListenerRef.current) {
          audioRef.current.removeEventListener('timeupdate', lineEndListenerRef.current);
          lineEndListenerRef.current = null;
        }
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [audioUrl]);

  const handlePlayLine = useCallback(
    (line: TranscriptLine) => {
      if (!audioRef.current || !audioUrl) return;

      // Clean up any previous line-end listener
      if (lineEndListenerRef.current) {
        audioRef.current.removeEventListener('timeupdate', lineEndListenerRef.current);
        lineEndListenerRef.current = null;
      }

      if (activeLineId === line.id && isPlaying) {
        audioRef.current.pause();
        return;
      }

      setActiveLineId(line.id);

      if (line.startMs !== undefined && line.endMs !== undefined) {
        const endSec = line.endMs / 1000;
        const onTimeUpdate = () => {
          if (!audioRef.current) return;
          if (audioRef.current.currentTime >= endSec) {
            audioRef.current.pause();
            setIsPlaying(false);
            if (lineEndListenerRef.current) {
              audioRef.current.removeEventListener('timeupdate', lineEndListenerRef.current);
            }
            lineEndListenerRef.current = null;
          }
        };
        lineEndListenerRef.current = onTimeUpdate;
        audioRef.current.addEventListener('timeupdate', onTimeUpdate);
        audioRef.current.currentTime = line.startMs / 1000;
        audioRef.current.play().catch(console.error);
      } else {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(console.error);
      }
    },
    [activeLineId, audioUrl, isPlaying]
  );

  const handleUpdateLine = (index: number, updated: TranscriptLine) => {
    const newLines = [...lines];
    newLines[index] = updated;
    onChange(newLines);
  };

  const handleDeleteLine = (index: number) => {
    const newLines = lines.filter((_, i) => i !== index);
    onChange(newLines);
  };

  const handleAddLine = () => {
    const newLine: TranscriptLine = {
      id: `line-${Date.now()}`,
      arabic: "",
      translation: "",
      tokens: [],
    };
    onChange([...lines, newLine]);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3
          className="text-lg font-semibold text-foreground"
          style={{ fontFamily: "'Montserrat', sans-serif" }}
        >
          Sentences ({lines.length})
        </h3>
      </div>

      {/* Lines */}
      <div className="space-y-3">
        {lines.map((line, i) => (
          <EditableLineCard
            key={line.id || i}
            line={line}
            index={i}
            isPlaying={isPlaying && activeLineId === line.id}
            isActive={activeLineId === line.id}
            onPlay={() => handlePlayLine(line)}
            hasAudio={!!audioUrl}
            onUpdate={(updated) => handleUpdateLine(i, updated)}
            onDelete={() => handleDeleteLine(i)}
          />
        ))}
      </div>

      {/* Add line */}
      <Button variant="outline" className="w-full" onClick={handleAddLine}>
        <Plus className="h-4 w-4 mr-2" />
        Add Sentence
      </Button>

      {/* Count */}
      <p className="text-xs text-muted-foreground text-center">
        {lines.length} {lines.length === 1 ? "sentence" : "sentences"}
      </p>
    </div>
  );
};

export default EditableTranscript;
