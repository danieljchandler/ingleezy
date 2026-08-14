import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePageAiContext } from "@/contexts/AiAssistantContext";
import { useParams, useNavigate } from "react-router-dom";
import { useDiscoverVideo, type DiscoverVideo as DiscoverVideoType } from "@/hooks/useDiscoverVideos";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, ArrowLeft, BookOpen, Check, Eye, EyeOff, ChevronDown, ChevronLeft, ChevronRight, List, Pause, Play, SkipBack, SkipForward, Gauge, Heart } from "lucide-react";
import { useVideoLikeCount, useIsVideoLiked, useLikeVideo, useUnlikeVideo } from "@/hooks/useVideoLikes";
import { useRecordVideoView } from "@/hooks/useDiscoverFeed";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { extractTikTokVideoId, getTikTokEmbedUrl } from "@/lib/videoEmbed";
import {
  resolveDiscoverVideoAudioUrl,
  extractAndUploadAudioClip,
  synthesizeAndUploadTTS,
  extractAudioClipFromUrl,
} from "@/lib/vocabularyAudioContext";
import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";
import { VideoRating } from "@/components/discover/VideoRating";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { FushaLine } from "@/components/shared/FushaLine";
import { useFushaLines } from "@/hooks/useFushaLines";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { LineShadowPanel } from "@/components/pronunciation/LineShadowPanel";
import type { ExternalYouTubeController } from "@/components/pronunciation/ClipSourcePlayer";
import { DIALECT_LOCALE, extractYouTubeId, type ShadowClip } from "@/hooks/useShadowQueue";
import { loadYouTubeIframeAPI } from "@/lib/youtubeIframeApi";
import { Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recordContinue } from "@/lib/continueProgress";
import { useUserLevel } from "@/hooks/useUserLevel";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
    tiktokEmbedLoad?: () => void;
  }
}

/* ── Clickable Word Token ─────────────────────────────────── */
const ClickableWord = ({
  token,
  parentLine,
  onSave,
  isSaved,
}: {
  token: WordToken;
  parentLine: TranscriptLine;
  onSave?: (word: VocabItem) => void;
  isSaved?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [liveTranslation, setLiveTranslation] = useState<string | null>(null);
  const [liveMsa, setLiveMsa] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  // A real gloss exists if gloss is set and is not a legacy compound marker
  const hasGloss = !!token.gloss && !token.gloss.startsWith("(→") && !token.compoundRef;
  const displayGloss = hasGloss ? token.gloss : liveTranslation;

  const vocabItem: VocabItem = {
    arabic: token.surface,
    english: displayGloss || token.gloss || "",
    sentenceText: parentLine.arabic,
    sentenceEnglish: parentLine.translation,
    startMs: parentLine.startMs,
    endMs: parentLine.endMs,
  };

  // Auto-translate when popover opens and no gloss exists
  useEffect(() => {
    if (open && !hasGloss && !liveTranslation && !isTranslating) {
      setIsTranslating(true);
      supabase.functions
        .invoke("translate-phrase", {
          body: {
            phrase: token.surface,
            sentenceArabic: parentLine.arabic,
            sentenceEnglish: parentLine.translation,
          },
        })
        .then(({ data, error }) => {
          if (!error && data?.translation) {
            setLiveTranslation(data.translation);
            if (data.msa) setLiveMsa(data.msa);
          }
        })
        .catch((err) => console.warn("Word translation failed:", err))
        .finally(() => setIsTranslating(false));
    }
  }, [open, hasGloss, liveTranslation, isTranslating, token.surface]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "cursor-pointer transition-colors duration-150 rounded px-0.5",
            "hover:bg-primary/15 hover:text-primary",
          )}
          role="button"
          tabIndex={0}
        >
          {token.surface}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto min-w-[200px] p-3 z-[100]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="text-center border-b border-border pb-2">
            <p
              className="text-xl font-bold text-foreground mb-1"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              {token.surface}
            </p>
            {displayGloss && <p className="text-sm text-muted-foreground">{displayGloss}</p>}
            {(token.standard || liveMsa) && (
              <p className="text-xs text-muted-foreground/70" dir="rtl">
                (فصحى: {token.standard || liveMsa})
              </p>
            )}
            {!displayGloss && isTranslating && (
              <div className="flex items-center justify-center gap-2 mt-1">
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-xs text-muted-foreground">جارٍ الترجمة…</span>
              </div>
            )}
            {!displayGloss && !isTranslating && (
              <p className="text-xs text-muted-foreground">لا يتوفر تعريف</p>
            )}
          </div>
          {onSave && displayGloss && (
            <Button
              variant="default"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => {
                onSave(vocabItem);
                setOpen(false);
              }}
              disabled={isSaved}
            >
              {isSaved ? (
                <><Check className="h-4 w-4" /> Saved to My Words</>
              ) : (
                <><BookOpen className="h-4 w-4" /> Save to My Words</>
              )}
            </Button>
          )}
          <div className="pt-1 border-t border-border">
            <AskAISentence
              arabic={parentLine.arabic}
              english={parentLine.translation}
              variant="chip"
              className="w-full justify-center"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/* ── Transcript Line Row ──────────────────────────────────── */
const buildShadowClipForLine = (
  line: TranscriptLine,
  video?: DiscoverVideoType,
  shadowAudioUrl?: string | null,
): ShadowClip | null => {
  const startMs = Number(line.startMs);
  const endMs = Number(line.endMs);
  const hasTiming = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const isYouTube = video?.platform === "youtube";
  const youtubeId = isYouTube ? extractYouTubeId(video?.embed_url ?? null, video?.source_url ?? null) : null;

  if (!video || !line.arabic || !hasTiming) return null;

  const base = {
    id: `line-${line.id}`,
    text: line.arabic,
    translation: line.translation,
    startSec: startMs / 1000,
    endSec: endMs / 1000,
    dialect: video.dialect,
    locale: DIALECT_LOCALE[video.dialect] ?? "ar-SA",
    sourceTitle: video.title,
  };

  // Prefer a downloadable native-audio clip whenever we have one. An <audio>
  // element started by the user's tap plays reliably on every platform — the
  // cross-origin YouTube iframe, by contrast, refuses to autoplay until the
  // user has interacted inside it (that's why shadowing used to need the main
  // video played first). We only fall back to driving the iframe when no audio
  // file exists. Either way the reference stays the actual native clip.
  if (shadowAudioUrl) {
    return { ...base, source: "audio", audioUrl: shadowAudioUrl };
  }
  if (isYouTube && youtubeId) {
    return { ...base, source: "youtube", youtubeId };
  }
  return null;
};

const TranscriptRow = ({
  line,
  isActive,
  showTranslation,
  showLiteral,
  fusha,
  onSave,
  savedWords,
  lineRef,
  onSeek,
  video,
  shadowAudioUrl,
  isShadowing,
  onToggleShadow,
  externalYouTubeController,
}: {
  line: TranscriptLine;
  isActive: boolean;
  showTranslation: boolean;
  showLiteral?: boolean;
  /** The line in Modern Standard Arabic, when the Fusha row is on and one exists. */
  fusha?: string;
  onSave?: (word: VocabItem) => void;
  savedWords?: Set<string>;
  lineRef?: React.Ref<HTMLDivElement>;
  onSeek?: (ms: number) => void;
  video?: DiscoverVideoType;
  shadowAudioUrl?: string | null;
  isShadowing?: boolean;
  onToggleShadow?: (lineId: string) => void;
  externalYouTubeController?: ExternalYouTubeController | null;
}) => {
  const shadowClip = buildShadowClipForLine(line, video, shadowAudioUrl);

  return (
    <div
      ref={lineRef}
      className={cn(
        "px-4 py-3 rounded-lg transition-all duration-300 border border-transparent",
        isActive
          ? "bg-primary/8 border-primary/30 scale-[1.01]"
          : "hover:bg-muted/40",
      )}
      onClick={() => line.startMs !== undefined && onSeek?.(line.startMs)}
      role={line.startMs !== undefined ? "button" : undefined}
      style={{ cursor: line.startMs !== undefined ? "pointer" : "default" }}
    >
      {/* Arabic text */}
      <p
        className={cn(
          "text-lg leading-[2] transition-colors",
          isActive ? "text-foreground font-medium" : "text-foreground/80",
        )}
        dir="rtl"
        style={{ fontFamily: "'Noto Naskh Arabic', 'Traditional Arabic', serif" }}
      >
        {line.tokens && line.tokens.length > 0
          ? line.tokens.map((token, i) => (
              <span key={token.id} className="inline">
                <ClickableWord
                  token={token}
                  parentLine={line}
                  onSave={onSave}
                  isSaved={savedWords?.has(token.surface)}
                />
                {i < line.tokens.length - 1 && !/^[،؟.!:؛]+$/.test(token.surface) && " "}
              </span>
            ))
          : line.arabic}
      </p>

      {/* Fusha row — the same sentence in MSA, next to the dialect rather than
          down with the translation, because it is not what the line means. */}
      {fusha && <FushaLine dialect={line.arabic} fusha={fusha} className="mt-1" />}

      {line.arabic && (
        <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <AskAISentence
            arabic={line.arabic}
            english={line.translation}
            variant="chip"
            className="h-8 px-3 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          />
          {shadowClip && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleShadow?.(line.id)}
              className={cn(
                "h-8 px-3 gap-1.5 rounded-full text-xs font-medium",
                isShadowing
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              )}
            >
              <Mic className="h-3.5 w-3.5" />
              {isShadowing ? "إغلاق" : "تدرّب بالمحاكاة"}
            </Button>
          )}
        </div>
      )}

      {/* Inline shadowing panel */}
      {isShadowing && shadowClip && (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineLineShadow
            clip={shadowClip}
            audioUrl={shadowAudioUrl ?? null}
            startMs={line.startMs}
            endMs={line.endMs}
            externalYouTubeController={externalYouTubeController}
            onClose={() => onToggleShadow?.(line.id)}
          />
        </div>
      )}

      {/* English translation */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          showTranslation ? "max-h-64 opacity-100 mt-1" : "max-h-0 opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily: "'Open Sans', sans-serif" }}
      >
        <TranslationPair
          variant="compact"
          literal={showLiteral ? line.literal : undefined}
          natural={line.translation}
        />
      </div>
    </div>
  );
};

/* ── Inline shadow loader: extracts the native clip WAV (when audio is
 *    available) then renders the shadowing panel. ─────────────────────── */
const InlineLineShadow = ({
  clip,
  audioUrl,
  startMs,
  endMs,
  externalYouTubeController,
  onClose,
}: {
  clip: ShadowClip;
  audioUrl: string | null;
  startMs?: number;
  endMs?: number;
  externalYouTubeController?: ExternalYouTubeController | null;
  onClose: () => void;
}) => {
  const [nativeClipWav, setNativeClipWav] = useState<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNativeClipWav(null);
    if (audioUrl && startMs !== undefined && endMs !== undefined) {
      extractAudioClipFromUrl(audioUrl, startMs, endMs)
        .then((blob) => {
          if (!cancelled) setNativeClipWav(blob);
        })
        .catch(() => {
          /* acoustic component is optional */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [audioUrl, startMs, endMs]);

  return (
    <LineShadowPanel
      clip={clip}
      nativeClipWav={nativeClipWav}
      externalYouTubeController={externalYouTubeController}
      onClose={onClose}
    />
  );
};

/* ── Like Button ──────────────────────────────────────────── */
const LikeButton = ({ videoId, isAuthenticated }: { videoId: string; isAuthenticated: boolean }) => {
  const isLiked = useIsVideoLiked(videoId);
  const { data: likeCount = 0 } = useVideoLikeCount(videoId);
  const likeVideo = useLikeVideo();
  const unlikeVideo = useUnlikeVideo();

  const handleToggle = async () => {
    if (!isAuthenticated) {
      toast.error("سجّل الدخول للإعجاب بالفيديوهات");
      return;
    }
    try {
      if (isLiked) {
        await unlikeVideo.mutateAsync(videoId);
      } else {
        await likeVideo.mutateAsync(videoId);
      }
    } catch {
      toast.error("تعذّر تحديث الإعجاب");
    }
  };

  const isPending = likeVideo.isPending || unlikeVideo.isPending;

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all shrink-0",
        isLiked
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
      )}
    >
      <Heart
        className={cn("h-5 w-5 transition-all", isLiked && "fill-primary")}
      />
      {likeCount > 0 && (
        <span className="text-sm font-semibold">{likeCount}</span>
      )}
    </button>
  );
};

/* ── Grammar Notes Section ───────────────────────────────── */
type GrammarPoint = {
  title: string;
  explanation: string;
  examples?: string[];
  cefr_level?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
};

const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const difficultyToCefr = (d?: string | null): "A1" | "A2" | "B1" | "B2" | "C1" | "C2" => {
  const v = (d || "").toLowerCase();
  if (v.startsWith("begin")) return "A2";
  if (v.startsWith("adv")) return "C1";
  return "B1";
};

const GrammarNotesSection = ({
  videoId,
  points,
  videoDifficulty,
}: {
  videoId: string;
  points: GrammarPoint[];
  videoDifficulty?: string | null;
}) => {
  const { placementLevel } = useUserLevel();
  const qc = useQueryClient();
  const userLevel = (placementLevel as any) || difficultyToCefr(videoDifficulty);
  const [showAll, setShowAll] = useState(false);
  const [generating, setGenerating] = useState(false);

  const filtered = useMemo(() => {
    if (showAll) return points;
    const userIdx = LEVEL_ORDER.indexOf(userLevel);
    if (userIdx < 0) return points;
    return points.filter((p) => {
      const lvl = (p.cefr_level || difficultyToCefr(videoDifficulty)) as any;
      const idx = LEVEL_ORDER.indexOf(lvl);
      // show points at user level or one below
      return idx >= 0 && idx <= userIdx && idx >= userIdx - 1;
    });
  }, [points, showAll, userLevel, videoDifficulty]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-grammar-points", {
        body: { video_id: videoId, target_level: userLevel, count: 4 },
      });
      if (error) throw error;
      if ((data as any)?.added > 0) {
        toast.success(`أُضيفت ${(data as any).added} ملاحظة قواعد جديدة`);
        qc.invalidateQueries({ queryKey: ["discover-video", videoId] });
      } else {
        toast.info((data as any)?.message || "لا ملاحظات قواعد جديدة");
      }
    } catch (e: any) {
      toast.error(e?.message || "تعذّر توليد ملاحظات القواعد");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <details className="group" open>
      <summary className="flex items-center justify-between gap-2 cursor-pointer text-sm font-semibold text-foreground">
        <span className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
          ملاحظات القواعد ({filtered.length}
          {points.length !== filtered.length ? `/${points.length}` : ""})
        </span>
        <span className="flex items-center gap-2">
          {points.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setShowAll((v) => !v);
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              {showAll ? `مستواي (${userLevel})` : "كل المستويات"}
            </button>
          )}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {points.length === 0
              ? "لا ملاحظات قواعد بعد."
              : `لا ملاحظات على مستواك (${userLevel}). جرّب «كل المستويات» أو ولّد المزيد.`}
          </p>
        )}
        {filtered.map((p, i) => (
          <div key={i} className="p-3 rounded-lg bg-muted/50 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">{p.title}</h4>
              {p.cefr_level && (
                <Badge variant="outline" className="text-[10px] font-mono">{p.cefr_level}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{p.explanation}</p>
            {p.examples && p.examples.length > 0 && (
              <ul className="mt-1 space-y-1">
                {p.examples.slice(0, 2).map((ex, j) => (
                  <li
                    key={j}
                    dir="rtl"
                    className="text-sm text-foreground/90 px-2 py-1 rounded bg-background/60"
                    style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
                  >
                    {ex}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full mt-2"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-2" />
          )}
          ولّد المزيد على مستواي ({userLevel})
        </Button>
      </div>
    </details>
  );
};

/* ── Main Page ────────────────────────────────────────────── */
const DiscoverVideo = () => {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { data: video, isLoading } = useDiscoverVideo(videoId);
  const { user, isAuthenticated } = useAuth();
  const addUserVocabulary = useAddUserVocabulary();
  const recordView = useRecordVideoView();

  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [showTranslations, setShowTranslations] = useState(false);
  const [showLiteral, setShowLiteral] = useState(false);
  // Unlike its neighbours, the Fusha switch is the global "Formal Arabic (MSA)"
  // preference rather than page state: a learner who asked for MSA in Settings
  // or on a transcript means it everywhere, and one row appearing on some
  // screens and not others reads as a bug rather than a setting.
  const { prefs: displayPrefs, update: updateDisplayPrefs } = useDisplayPrefs();
  const showFusha = displayPrefs.showFormal;
  const setShowFusha = (on: boolean) => updateDisplayPrefs({ showFormal: on });
  const [playbackMode, setPlaybackMode] = useState<"continuous" | "line">("continuous");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [manualLineIndex, setManualLineIndex] = useState(0);
  // Timer-based sync for non-YouTube
  const [timerPlaying, setTimerPlaying] = useState(false);
  const [timerMs, setTimerMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLDivElement>(null);
  const [resolvedTikTokVideoId, setResolvedTikTokVideoId] = useState<string | null>(null);
  const [resolvedTikTokAuthorUrl, setResolvedTikTokAuthorUrl] = useState<string | null>(null);
  const [isYouTubePlaying, setIsYouTubePlaying] = useState(false);
  const [lineControlIndex, setLineControlIndex] = useState(0);
  const [tiktokAudioUrl, setTiktokAudioUrl] = useState<string | null>(null);
  const [tiktokAudioReady, setTiktokAudioReady] = useState(false);
  // Shadowing: which line's inline panel is open, and the resolved native
  // audio URL used to extract clips for acoustic scoring (null for videos
  // without downloadable audio, e.g. most YouTube).
  const [shadowLineId, setShadowLineId] = useState<string | null>(null);
  const [shadowAudioUrl, setShadowAudioUrl] = useState<string | null>(null);
  const [isTiktokAudioPlaying, setIsTiktokAudioPlaying] = useState(false);
  // When the muted player/v1 iframe never confirms it started (unresolved
  // video id, or cross-origin muted-autoplay refused), we prompt the user to
  // tap the video's own play button. Non-blocking hint — see render below.
  const [tiktokNeedsManualPlay, setTiktokNeedsManualPlay] = useState(false);
  const tiktokAudioRef = useRef<HTMLAudioElement | null>(null);
  const phraseEndMsRef = useRef<number | null>(null);
  const phraseStartMsRef = useRef<number | null>(null);
  const isSeekingRef = useRef(false);
  const shadowPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Record "continue where you left off" entry, throttled internally to 5s
  useEffect(() => {
    if (!video?.id) return;
    const title = (video as any).title || (video as any).title_arabic || "Video";
    const dialect = (video as any).dialect as string | undefined;
    const totalSec = Math.floor(currentTimeMs / 1000);
    if (totalSec <= 0) {
      recordContinue({ kind: "video", route: `/discover/${video.id}`, title, dialect });
      return;
    }
    const mm = Math.floor(totalSec / 60);
    const ss = (totalSec % 60).toString().padStart(2, "0");
    recordContinue({
      kind: "video",
      route: `/discover/${video.id}`,
      title,
      subtitle: `at ${mm}:${ss}`,
      dialect,
    });
  }, [video?.id, currentTimeMs]);

  // Resolve a downloadable native-audio URL for shadowing (used to extract
  // per-line clips for acoustic scoring). Null when none exists yet.
  useEffect(() => {
    if (!video) {
      setShadowAudioUrl(null);
      return;
    }
    let cancelled = false;
    resolveDiscoverVideoAudioUrl(video)
      .then((url) => {
        if (!cancelled) setShadowAudioUrl(url);
      })
      .catch(() => {
        if (!cancelled) setShadowAudioUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [video]);

  const handleToggleShadow = useCallback((lineId: string) => {
    setShadowLineId((cur) => (cur === lineId ? null : lineId));
  }, []);

  // Initialize YouTube player
  useEffect(() => {
    if (!video || video.platform !== "youtube" || !iframeRef.current) return;
    const ytVideoId = video.embed_url.match(/embed\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!ytVideoId) return;

    let cancelled = false;

    const initPlayer = () => {
      if (cancelled || playerRef.current || !iframeRef.current) return;
      playerRef.current = new window.YT.Player(iframeRef.current, {
        videoId: ytVideoId,
        playerVars: { enablejsapi: 1, modestbranding: 1, rel: 0 },
        events: {
          onStateChange: (event: any) => {
            if (event.data === 1) {
              setIsYouTubePlaying(true);
              // Apply current playback speed when video starts
              playerRef.current?.setPlaybackRate?.(playbackSpeedRef.current);
              if (intervalRef.current) clearInterval(intervalRef.current);
              intervalRef.current = setInterval(() => {
                if (playerRef.current?.getCurrentTime) {
                  setCurrentTimeMs(playerRef.current.getCurrentTime() * 1000);
                }
              }, 200);
            } else if (event.data === 3) {
              // Buffering — do NOT clear isSeekingRef here, as this fires
              // during seeks. The seek is still in progress; let it complete.
            } else {
              // Genuinely stopped (paused=2, ended=0, unstarted=-1, cued=5)
              setIsYouTubePlaying(false);
              isSeekingRef.current = false; // safe to clear now
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          },
        },
      });
    };

    loadYouTubeIframeAPI().then(initPlayer);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [video]);

  // Apply speed changes to YouTube player
  useEffect(() => {
    if (playerRef.current?.setPlaybackRate) {
      playerRef.current.setPlaybackRate(playbackSpeed);
    }
  }, [playbackSpeed]);

  const stopTikTokAudio = useCallback(() => {
    const audio = tiktokAudioRef.current;
    if (!audio) return;
    audio.pause();
    setIsTiktokAudioPlaying(false);
  }, []);

  const playTikTokAudio = useCallback((startMs?: number) => {
    const audio = tiktokAudioRef.current;
    if (!audio || !tiktokAudioReady) return;
    if (typeof startMs === "number") {
      audio.currentTime = Math.max(0, startMs / 1000);
    }
    audio.play().catch(() => toast.error("تعذّر تشغيل الصوت"));
  }, [tiktokAudioReady]);

  const handleSeek = useCallback((ms: number) => {
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(ms / 1000, true);
      playerRef.current.playVideo?.();
      return;
    }
    if (tiktokAudioRef.current && tiktokAudioReady) {
      playTikTokAudio(ms);
    }
  }, [playTikTokAudio, tiktokAudioReady]);

  // Resolve hidden audio source for TikTok videos (from video-audio bucket)
  useEffect(() => {
    if (!video || video.platform !== "tiktok") {
      setTiktokAudioUrl(null);
      setTiktokAudioReady(false);
      return;
    }
    let cancelled = false;
    resolveDiscoverVideoAudioUrl(video).then((url) => {
      if (!cancelled) setTiktokAudioUrl(url);
    });
    return () => { cancelled = true; };
  }, [video]);

  // Apply playback speed to hidden TikTok audio
  useEffect(() => {
    if (tiktokAudioRef.current) {
      tiktokAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, tiktokAudioReady]);


  // Timer-based playback for non-YouTube videos (respects playback speed)
  useEffect(() => {
    if (timerPlaying) {
      timerRef.current = setInterval(() => {
        setTimerMs((prev) => prev + Math.round(100 * playbackSpeed));
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerPlaying, playbackSpeed]);

  const handleSaveToMyWords = useCallback(
    async (word: VocabItem) => {
      if (!isAuthenticated || !user) {
        toast.error("سجّل الدخول لحفظ الكلمات");
        return;
      }
      try {
        // Best-effort: clip the sentence audio from the source video so the
        // flashcard plays with native audio. If native audio isn't available
        // (typical for YouTube videos without an extracted track), fall back
        // to TTS so the flashcard is always saved with playable audio.
        let sentenceAudioUrl: string | undefined;
        let wordAudioUrl: string | undefined;
        if (
          video &&
          typeof word.startMs === "number" &&
          typeof word.endMs === "number" &&
          word.endMs > word.startMs
        ) {
          try {
            const audioSrc = await resolveDiscoverVideoAudioUrl(video);
            if (audioSrc) {
              const uploaded = await extractAndUploadAudioClip(
                audioSrc,
                word.startMs,
                word.endMs,
                user.id,
                "sentence",
              );
              if (uploaded) sentenceAudioUrl = uploaded;
            }
          } catch (clipErr) {
            console.warn("Discover sentence audio clip failed:", clipErr);
          }
        }

        // TTS fallback for sentence + word (routed to native dialect voice).
        const dialectHint = (video as any)?.dialect ?? null;
        if (!sentenceAudioUrl && word.sentenceText) {
          sentenceAudioUrl =
            (await synthesizeAndUploadTTS(word.sentenceText, user.id, dialectHint, "sentence")) ?? undefined;
        }
        if (!wordAudioUrl && word.arabic) {
          wordAudioUrl =
            (await synthesizeAndUploadTTS(word.arabic, user.id, dialectHint, "word")) ?? undefined;
        }

        await addUserVocabulary.mutateAsync({
          word_arabic: word.arabic,
          word_english: word.english,
          sentence_text: word.sentenceText,
          sentence_english: word.sentenceEnglish,
          sentence_audio_url: sentenceAudioUrl,
          word_audio_url: wordAudioUrl,
          source: "discover",
        });
        setSavedWords((prev) => new Set(prev).add(word.arabic));
        toast.success("حُفظت في كلماتي");
      } catch (err: any) {
        if (err?.code === "23505") {
          setSavedWords((prev) => new Set(prev).add(word.arabic));
          toast.info("موجودة في كلماتي");
        } else {
          toast.error("تعذّر حفظ الكلمة");
        }
      }
    },
    [isAuthenticated, user, video, addUserVocabulary],
  );

  const allLines = useMemo(
    () => ((video?.transcript_lines as any[]) ?? []) as TranscriptLine[],
    [video],
  );
  const onScreenLines = useMemo(
    () => allLines.filter((l: any) => l?.source === "on_screen" || l?.segmentType === "text_overlay"),
    [allLines],
  );
  const lines = useMemo(
    () => allLines.filter((l: any) => !(l?.source === "on_screen" || l?.segmentType === "text_overlay")),
    [allLines],
  );

  // Most of the Discover library was analysed before the Fusha pass existed,
  // so the row is filled in on demand the first time a learner asks for it.
  const { fushaFor, status: fushaStatus } = useFushaLines(
    lines,
    showFusha,
    video?.dialect ?? "Gulf",
  );

  // For YouTube: find active line by time. For others: use manual index.
  const isYouTube = video?.platform === "youtube";
  const isTikTok = video?.platform === "tiktok";
  const horizontalVideoMaxHeightClass = "max-h-[min(45vh,calc(100dvh-15rem))]";
  const verticalVideoMaxHeightClass = "max-h-[min(72vh,calc(100dvh-13rem))]";

  const playLineByIndex = useCallback(
    (index: number) => {
      if (!lines.length) return;
      const clampedIndex = Math.max(0, Math.min(index, lines.length - 1));
      const targetLine = lines[clampedIndex];
      if (!targetLine) return;

      setLineControlIndex(clampedIndex);
      setManualLineIndex(clampedIndex);

      // Track the target line's start/end time for phrase-mode pause
      phraseStartMsRef.current = targetLine.startMs ?? null;
      phraseEndMsRef.current = targetLine.endMs ?? null;

      if (isYouTube && targetLine.startMs !== undefined) {
        isSeekingRef.current = true;
        setTimeout(() => { isSeekingRef.current = false; }, 2000);
        handleSeek(targetLine.startMs);
      } else if (isTikTok && targetLine.startMs !== undefined) {
        if (tiktokAudioReady && tiktokAudioRef.current) {
          isSeekingRef.current = true;
          setTimeout(() => { isSeekingRef.current = false; }, 1500);
          tiktokAudioRef.current.currentTime = targetLine.startMs / 1000;
          tiktokAudioRef.current.play().catch(() => {});
        } else {
          // Fallback: legacy TikTok without uploaded source audio
          setTimerMs(targetLine.startMs);
        }
      }
    },
    [handleSeek, isYouTube, isTikTok, lines, tiktokAudioReady],
  );

  useEffect(() => {
    return () => {
      if (shadowPollRef.current) clearInterval(shadowPollRef.current);
    };
  }, []);

  // Drives shadow-clip playback through the MAIN video's already-existing YT
  // player instead of a fresh iframe. A brand new hidden iframe created only
  // for shadowing has no prior engagement with the browser's autoplay policy,
  // so its first programmatic playVideo() gets silently blocked until some
  // other YouTube embed on the page has already played — this is why
  // shadowing previously required pressing play on the main video first.
  // Reusing the main player, which is already proven to play, avoids that.
  const mainYouTubeShadowController = useMemo<ExternalYouTubeController | null>(() => {
    if (!isYouTube) return null;
    return {
      play: async (startSec, endSec, rate, onEnded) => {
        const p = playerRef.current;
        if (!p?.seekTo || !p?.playVideo) return false;
        if (shadowPollRef.current) {
          clearInterval(shadowPollRef.current);
          shadowPollRef.current = null;
        }
        isSeekingRef.current = true;
        setTimeout(() => { isSeekingRef.current = false; }, 1200);
        try {
          p.setPlaybackRate?.(rate);
        } catch {
          /* not all rates supported */
        }
        p.seekTo(startSec, true);
        p.playVideo();

        // Confirm playback actually STARTED (currentTime advancing inside the
        // clip, or player state === PLAYING) before reporting success. If it
        // never starts within the watchdog window, resolve false so the panel
        // recovers instead of hanging forever on "Listening…".
        return await new Promise<boolean>((resolve) => {
          const startedAt = Date.now();
          let confirmed = false;
          let lastCur = -1;
          let settled = false;
          const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
          shadowPollRef.current = setInterval(() => {
            const cur = p.getCurrentTime?.() ?? 0;
            if (!confirmed) {
              const advancing = lastCur >= 0 && cur > lastCur + 0.01;
              const isPlaying = p.getPlayerState?.() === 1; // YT.PlayerState.PLAYING
              if ((isPlaying || advancing) && cur >= startSec - 0.3 && cur < endSec) {
                confirmed = true;
                settle(true);
              } else if (Date.now() - startedAt > 5000) {
                if (shadowPollRef.current) {
                  clearInterval(shadowPollRef.current);
                  shadowPollRef.current = null;
                }
                try { p.pauseVideo?.(); } catch { /* ignore */ }
                settle(false);
                return;
              }
            }
            lastCur = cur;
            if (confirmed && cur >= endSec - 0.05) {
              try { p.pauseVideo?.(); } catch { /* ignore */ }
              if (shadowPollRef.current) {
                clearInterval(shadowPollRef.current);
                shadowPollRef.current = null;
              }
              try {
                p.setPlaybackRate?.(playbackSpeedRef.current);
              } catch {
                /* not all rates supported */
              }
              onEnded();
            }
          }, 100);
        });
      },
      pause: () => {
        if (shadowPollRef.current) {
          clearInterval(shadowPollRef.current);
          shadowPollRef.current = null;
        }
        playerRef.current?.pauseVideo?.();
      },
    };
  }, [isYouTube]);

  const activeLineId = useMemo(() => {
    if (!lines.length) return null;
    if (isYouTube) {
      if (currentTimeMs <= 0) return null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startMs !== undefined && currentTimeMs >= line.startMs) {
          if (line.endMs === undefined || currentTimeMs <= line.endMs + 500) {
            return line.id;
          }
        }
      }
      return null;
    }
    if (isTikTok && tiktokAudioReady) {
      if (currentTimeMs <= 0) return null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startMs !== undefined && currentTimeMs >= line.startMs) {
          if (line.endMs === undefined || currentTimeMs <= line.endMs + 500) {
            return line.id;
          }
        }
      }
      return null;
    }
    // Timer-based sync fallback (legacy TikTok without uploaded audio)
    if (timerMs > 0 || timerPlaying) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startMs !== undefined && timerMs >= line.startMs) {
          if (line.endMs === undefined || timerMs <= line.endMs + 500) {
            return line.id;
          }
        }
      }
      return null;
    }
    // Fallback: manual navigation
    const idx = Math.max(0, Math.min(manualLineIndex, lines.length - 1));
    return lines[idx]?.id ?? null;
  }, [lines, currentTimeMs, isYouTube, isTikTok, tiktokAudioReady, manualLineIndex, timerMs, timerPlaying]);

  const activeLine = useMemo(
    () => lines.find((l) => l.id === activeLineId) ?? null,
    [lines, activeLineId],
  );

  // In phrase mode, show the line at lineControlIndex to avoid stale activeLine during seek lag
  const displayLine = (playbackMode === "line" && lines[lineControlIndex])
    ? lines[lineControlIndex]
    : activeLine ?? lines[lineControlIndex] ?? null;

  usePageAiContext(
    useMemo(
      () =>
        video
          ? {
              kind: "video" as const,
              title: video.title,
              summary: `Watching a ${video.dialect} dialect video${video.cefr_level ? ` (${video.cefr_level})` : ""} with tap-to-translate subtitles.`,
              content: displayLine
                ? `Current subtitle: ${displayLine.arabic}${displayLine.translation ? ` — ${displayLine.translation}` : ""}`
                : undefined,
            }
          : null,
      [video, displayLine],
    ),
  );
  const displayLineShadowClip = useMemo(
    () => (displayLine ? buildShadowClipForLine(displayLine, video ?? undefined, shadowAudioUrl) : null),
    [displayLine, video, shadowAudioUrl],
  );

  useEffect(() => {
    if (!activeLine) return;
    if (isSeekingRef.current) return;
    if (playbackMode === "line") return;
    const nextIndex = lines.findIndex((line) => line.id === activeLine.id);
    if (nextIndex >= 0) {
      setLineControlIndex(nextIndex);
      setManualLineIndex(nextIndex);
    }
  }, [activeLine, lines, playbackMode]);

  // When switching to phrase mode, pause the video/audio and lock to current phrase
  useEffect(() => {
    if (playbackMode !== "line") return;
    if (isYouTube) {
      playerRef.current?.pauseVideo?.();
    } else if (isTikTok) {
      tiktokAudioRef.current?.pause();
    }
    const currentLine = lines[lineControlIndex];
    if (currentLine) {
      phraseStartMsRef.current = currentLine.startMs ?? null;
      phraseEndMsRef.current = currentLine.endMs ?? null;
    }
  }, [playbackMode, isYouTube, isTikTok]); // intentionally exclude lines/lineControlIndex — only fire on mode switch

  // Phrase-end auto-pause for both YouTube and TikTok (hidden audio)
  useEffect(() => {
    if (playbackMode !== "line") return;
    const isPlaying = isYouTube ? isYouTubePlaying : (isTikTok && isTiktokAudioPlaying);
    if (!isPlaying) return;

    const startMs = phraseStartMsRef.current;
    const endMs = phraseEndMsRef.current;
    if (endMs == null) return;

    if (isSeekingRef.current) {
      if (startMs != null && currentTimeMs >= startMs && currentTimeMs < endMs) {
        isSeekingRef.current = false;
      }
      return;
    }

    if (currentTimeMs >= endMs) {
      if (isYouTube) {
        playerRef.current?.pauseVideo?.();
        setIsYouTubePlaying(false);
      } else if (isTikTok) {
        tiktokAudioRef.current?.pause();
      }
    }
  }, [currentTimeMs, isYouTube, isTikTok, isYouTubePlaying, isTiktokAudioPlaying, playbackMode]);

  // Auto-scroll to active line
  useEffect(() => {
    if (!activeLineId) return;
    const el = lineRefs.current.get(activeLineId);
    if (el && transcriptContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLineId]);

  // Track view progress for personalized feed (throttled every 10s, marks complete at >=85%)
  const lastReportedRef = useRef<{ s: number; completed: boolean }>({ s: 0, completed: false });
  useEffect(() => {
    if (!videoId || !user) return;
    // Use the real media clock (currentTimeMs) whenever one drives playback:
    // YouTube, native html5, and TikTok with an extracted audio track. Only the
    // legacy manual-timer TikTok fallback relies on timerMs. Reading timerMs on
    // the TikTok-audio path left watched_seconds at 0 and never recorded a view.
    const usingRealClock =
      isYouTube || video?.platform === "html5" || (isTikTok && tiktokAudioReady);
    const seconds = Math.floor((usingRealClock ? currentTimeMs : timerMs) / 1000);
    if (seconds <= 0) return;
    const duration = video?.duration_seconds ?? 0;
    const completed = duration > 0 && seconds / duration >= 0.85;
    const last = lastReportedRef.current;
    if (seconds - last.s < 10 && completed === last.completed) return;
    lastReportedRef.current = { s: seconds, completed };
    recordView.mutate({ videoId, watchedSeconds: seconds, completed });
  }, [currentTimeMs, timerMs, videoId, user, video?.duration_seconds, video?.platform, isYouTube, isTikTok, tiktokAudioReady, recordView]);


  const vocabulary = useMemo(
    () => ((video?.vocabulary as any[]) ?? []) as VocabItem[],
    [video],
  );

  const resolvedEmbedUrl = useMemo(() => {
    if (!video) return "";
    if (video.platform !== "tiktok") return video.embed_url;

    return (
      getTikTokEmbedUrl(video.embed_url) ||
      getTikTokEmbedUrl(video.source_url) ||
      video.embed_url
    );
  }, [video]);

  const tiktokVideoId = useMemo(() => {
    if (!video || video.platform !== "tiktok") return null;

    const source = `${resolvedEmbedUrl} ${video.embed_url} ${video.source_url}`;
    const match = source.match(/(?:video\/|embed\/v2\/|player\/v1\/)(\d{8,})/);
    return match?.[1] ?? null;
  }, [video, resolvedEmbedUrl]);

  const resolvedTikTokCiteUrl = useMemo(() => {
    if (!video || video.platform !== "tiktok") return "";
    if (resolvedTikTokVideoId && resolvedTikTokAuthorUrl) {
      return `${resolvedTikTokAuthorUrl.replace(/\/$/, "")}/video/${resolvedTikTokVideoId}`;
    }

    // Prefer a canonical watch URL whenever we have an ID.
    // Short/share/embed URLs are more likely to trigger unavailable responses in embed.js.
    if (resolvedTikTokVideoId) {
      return `https://www.tiktok.com/video/${resolvedTikTokVideoId}`;
    }

    return video.source_url || resolvedEmbedUrl || video.embed_url;
  }, [video, resolvedEmbedUrl, resolvedTikTokAuthorUrl, resolvedTikTokVideoId]);

  // Use TikTok's official player iframe as a muted visual companion only.
  // Audio comes exclusively from the extracted source track below.
  //
  // The mute MUST come from the URL param, spelled `muted` (an earlier `mute=1`
  // was ignored, leaving the player audible). But muting alone isn't enough: a
  // cross-origin iframe won't honour a postMessage("play") until it has had a
  // real user gesture INSIDE it, so the first press of our external red button
  // could never start the frame (tapping the video directly did, because that
  // is an in-iframe gesture).
  //
  // `autoplay=1` is what breaks that deadlock: the player is allowed to start
  // muted on its own (muted autoplay needs no gesture), and once it has started
  // it accepts our play/pause/seek commands for the rest of the session. We
  // immediately park it (seek 0 + pause) on that first autoplay tick — see the
  // priming branch in the message listener — so it sits warmed-up and ready
  // without running ahead of the audio.
  const tiktokIframeUrl = useMemo(() => {
    if (!video || video.platform !== "tiktok") return "";
    // rel=0 disables TikTok's "more videos" related-videos overlay. Without it,
    // once the primed frame is sitting paused the player covers it with a grid
    // of other clips instead of the still poster frame.
    const params = "?autoplay=1&muted=1&music_info=0&description=0&rel=0";
    if (resolvedTikTokVideoId) return `https://www.tiktok.com/player/v1/${resolvedTikTokVideoId}${params}`;
    return resolvedEmbedUrl;
  }, [video, resolvedEmbedUrl, resolvedTikTokVideoId]);

  const tiktokIframeElRef = useRef<HTMLIFrameElement | null>(null);
  const sendTikTokCommand = useCallback((type: string, value?: number) => {
    const iframe = tiktokIframeElRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(
        { type, "x-tiktok-player": true, value },
        "*",
      );
    } catch {
      // best-effort visual sync only
    }
  }, []);

  // Robust, self-correcting sync of the muted TikTok video to a desired play
  // state. A single fire-and-forget postMessage("play") races the iframe
  // player's initialization and is silently dropped — which is why pressing
  // the custom (red) play button below the video used to start the audio but
  // leave the video frozen. Here we re-send the command until the player
  // confirms the target state via onStateChange (1 = playing, 2 = paused,
  // 0 = ended), or we exhaust a short retry budget.
  const tiktokPlayerReadyRef = useRef(false);
  // One-time autoplay "priming": the muted frame is allowed to start on its own
  // (muted autoplay needs no gesture); once it has, later play commands land. We
  // park it immediately so it doesn't run ahead of the audio. mountedAt bounds
  // priming to that initial autoplay, so a much later in-iframe tap isn't parked.
  const tiktokPrimedRef = useRef(false);
  const tiktokMountedAtRef = useRef(0);
  // Whether the frame has already been aligned to the audio for the current
  // play run. Guards against re-seeking on every "playing" event — buffering
  // recovery (state 3 → 1) mid-clip otherwise re-seeks and makes motion choppy.
  const tiktokAlignedRef = useRef(false);
  const tiktokObservedStateRef = useRef<number | null>(null);
  const tiktokVideoSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ensureTikTokVideoPlaying = useCallback((desired: boolean) => {
    if (tiktokVideoSyncTimerRef.current) {
      clearInterval(tiktokVideoSyncTimerRef.current);
      tiktokVideoSyncTimerRef.current = null;
    }
    // Only the player/v1 iframe accepts inbound postMessage control. When we
    // never resolved a numeric TikTok video id the iframe falls back to a plain
    // embed URL that ignores these commands, so there's nothing to drive — ask
    // the user to tap the video's own play button instead.
    if (!resolvedTikTokVideoId) {
      if (desired) setTiktokNeedsManualPlay(true);
      return;
    }
    const reachedTarget = () =>
      desired
        ? tiktokObservedStateRef.current === 1
        : tiktokObservedStateRef.current === 2 || tiktokObservedStateRef.current === 0;
    if (reachedTarget()) {
      if (desired) setTiktokNeedsManualPlay(false);
      return;
    }
    // Align the muted video to the hidden audio (our master clock) before we
    // start it, so the frame and the sound begin from the same position.
    if (desired) {
      const audio = tiktokAudioRef.current;
      if (audio) sendTikTokCommand("seekTo", audio.currentTime);
    }
    const attempt = () => {
      // Re-assert mute (defense in depth) then drive to the desired state.
      sendTikTokCommand("mute");
      sendTikTokCommand(desired ? "play" : "pause");
    };
    attempt();
    // Retry on a time budget rather than a fixed count: the player can take a
    // second or two to finish initializing, and commands sent before its
    // onPlayerReady are silently dropped. Keep re-asserting until the player
    // confirms the target state via onStateChange, or ~4s elapse.
    const startedAt = Date.now();
    tiktokVideoSyncTimerRef.current = setInterval(() => {
      if (reachedTarget()) {
        if (desired) setTiktokNeedsManualPlay(false);
        if (tiktokVideoSyncTimerRef.current) {
          clearInterval(tiktokVideoSyncTimerRef.current);
          tiktokVideoSyncTimerRef.current = null;
        }
        return;
      }
      if (Date.now() - startedAt > 4000) {
        if (tiktokVideoSyncTimerRef.current) {
          clearInterval(tiktokVideoSyncTimerRef.current);
          tiktokVideoSyncTimerRef.current = null;
        }
        // The frame never reported "playing" — muted cross-origin autoplay is
        // not guaranteed even with autoplay permission. Surface a manual-tap
        // hint so the user can start the video with a real in-iframe gesture.
        if (desired && tiktokObservedStateRef.current !== 1) {
          setTiktokNeedsManualPlay(true);
        }
        return;
      }
      attempt();
    }, 300);
  }, [sendTikTokCommand, resolvedTikTokVideoId]);

  // Stop any pending retry loop when the video changes or the page unmounts,
  // so a stray timer never posts commands to a torn-down iframe.
  useEffect(() => {
    setTiktokNeedsManualPlay(false);
    tiktokPrimedRef.current = false;
    tiktokMountedAtRef.current = Date.now();
    tiktokAlignedRef.current = false;
    return () => {
      if (tiktokVideoSyncTimerRef.current) {
        clearInterval(tiktokVideoSyncTimerRef.current);
        tiktokVideoSyncTimerRef.current = null;
      }
    };
  }, [video?.id]);

  // Listen for TikTok player state changes so pressing play/pause INSIDE the
  // TikTok iframe also drives our hidden audio (and therefore the transcript
  // + translation sync). Without this, tapping play on the TikTok video
  // itself leaves the audio + subtitles frozen.
  useEffect(() => {
    if (!isTikTok || !tiktokIframeUrl) return;
    const onMessage = (e: MessageEvent) => {
      const data = e?.data as { type?: string; value?: any; "x-tiktok-player"?: boolean } | undefined;
      if (!data || data["x-tiktok-player"] !== true) return;
      // Re-assert mute whenever the player talks to us (defense in depth).
      const audio = tiktokAudioRef.current;
      switch (data.type) {
        case "onPlayerReady":
          tiktokPlayerReadyRef.current = true;
          sendTikTokCommand("mute");
          break;
        case "onStateChange":
        case "onPlay":
        case "play": {
          sendTikTokCommand("mute");
          const state =
            data.type === "onStateChange" && typeof data.value === "number"
              ? data.value
              : null;
          if (state !== null) {
            // Record the player's real state so ensureTikTokVideoPlaying's
            // retry loop can stop once the video actually reaches the target.
            tiktokObservedStateRef.current = state;
            // The frame is actually playing now — clear any manual-tap hint.
            if (state === 1) setTiktokNeedsManualPlay(false);
          }
          // "Playing" = an explicit state 1, or a bare onPlay/play with no value.
          const startedPlaying = state === 1 || state === null;

          // Priming: the very first "playing" comes from autoplay=1, before the
          // user pressed play. Park the muted video at the start (paused, warmed
          // up) so later play commands are honoured — and do NOT start the audio.
          if (
            startedPlaying &&
            !tiktokPrimedRef.current &&
            Date.now() - tiktokMountedAtRef.current < 6000 &&
            (!audio || audio.paused)
          ) {
            tiktokPrimedRef.current = true;
            sendTikTokCommand("seekTo", 0);
            sendTikTokCommand("pause");
            break;
          }

          if (!audio || !tiktokAudioReady) break;
          // Mirror the player's real state onto the hidden audio (master clock).
          if (state === 2) {
            tiktokAlignedRef.current = false; // real pause — next play re-aligns
            if (!audio.paused) audio.pause();
          } else if (state === 0) {
            tiktokAlignedRef.current = false;
            audio.pause();
          } else if (startedPlaying) {
            if (audio.paused) {
              // Started from inside the iframe (a direct tap): align the frame
              // to the audio and start the audio so the two run together.
              sendTikTokCommand("seekTo", audio.currentTime);
              audio.play().catch(() => {});
              tiktokAlignedRef.current = true;
            } else if (!tiktokAlignedRef.current) {
              // First "playing" of this run after a red-button start: align the
              // frame to the audio ONCE. Do NOT repeat on buffering recovery
              // (state 3 → 1) — re-seeking mid-clip is what makes motion choppy.
              sendTikTokCommand("seekTo", audio.currentTime);
              tiktokAlignedRef.current = true;
            }
          }
          break;
        }
        case "onPause":
        case "pause":
          if (audio && !audio.paused) audio.pause();
          break;
        case "onCurrentTime":
        case "currentTime":
          // Intentionally no continuous re-seeking. The frame and the hidden
          // audio are the same media at 1x, so aligning once when playback
          // starts (and on explicit scrubs via the audio's onSeeked handler)
          // keeps them together. Seeking the iframe on every tick to shave
          // sub-second drift made the video visibly choppy — and tended to feed
          // itself, since a fresh seek briefly reports a transitional position
          // that reads as more drift.
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isTikTok, tiktokIframeUrl, tiktokAudioReady, sendTikTokCommand]);

  // Keep the TikTok iframe visual-only. Sound is driven exclusively by our
  // hidden <audio> element via the extracted source track. (The legacy
  // blockquote embed path has been removed — the iframe is the only renderer.)

  useEffect(() => {
    if (!video || video.platform !== "tiktok") return;

    setResolvedTikTokVideoId(tiktokVideoId);
    setResolvedTikTokAuthorUrl(null);
    if (tiktokVideoId) return;

    const candidateUrl = video.source_url || video.embed_url || resolvedEmbedUrl;
    if (!candidateUrl) return;

    let cancelled = false;

    const resolveTikTokVideoId = async () => {
      try {
        const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(candidateUrl)}`);
        const data = await response.json();
        const resolvedId = extractTikTokVideoId(`${data?.html ?? ""} ${data?.author_url ?? ""} ${candidateUrl}`);
        if (!cancelled) {
          if (resolvedId) {
            setResolvedTikTokVideoId(resolvedId);
          }
          if (typeof data?.author_url === "string" && data.author_url.includes("tiktok.com/@")) {
            setResolvedTikTokAuthorUrl(data.author_url);
          }
        }
      } catch {
        // Keep best-effort fallback with source URL only.
      }
    };

    resolveTikTokVideoId();

    return () => {
      cancelled = true;
    };
  }, [video, resolvedEmbedUrl, tiktokVideoId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Video not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Video section - sticky for YouTube, static for TikTok (vertical videos need more space) */}
      <div className={cn(isYouTube ? "sticky top-0 z-30" : "relative z-30", "bg-background")}>
        {/* Back nav */}
        <div className="px-4 py-2 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/discover")}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex-1" />
          <div className="flex gap-1.5">
            <Badge variant="outline" className="text-xs">{video.dialect}</Badge>
            <Badge variant="outline" className="text-xs">{video.difficulty}</Badge>
          </div>
        </div>

        {/* Video embed */}
        <div className="bg-black relative">
          {video.platform === "youtube" ? (
            <div className={cn("aspect-video mx-auto", horizontalVideoMaxHeightClass)}>
              <div ref={iframeRef} className="w-full h-full" />
            </div>
          ) : video.platform === "tiktok" ? (
            <div className="mx-auto flex w-full justify-center px-2 py-2">
              <div className="w-full max-w-[420px]">
                <div className={cn("relative aspect-[9/16] w-full overflow-hidden rounded-md bg-black", verticalVideoMaxHeightClass)}>
                  {tiktokIframeUrl ? (
                    <iframe
                      ref={tiktokIframeElRef}
                      src={tiktokIframeUrl}
                      className="absolute inset-0 h-full w-full border-0"
                      title={video.title}
                      allowFullScreen
                      scrolling="no"
                      // autoplay permission is REQUIRED for postMessage("play") to work.
                      // Silence is enforced via the mute=1 URL param (respected on init)
                      // and we never send unmute commands.
                      allow="autoplay; fullscreen; picture-in-picture"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  ) : (
                    <a
                      href={resolvedTikTokCiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-full w-full items-center justify-center text-sm text-white/80"
                    >
                      شاهد على تيك توك
                    </a>
                  )}
                  {/* Fallback prompt when the muted iframe never confirms it
                      started. pointer-events-none is essential: the hint must
                      never intercept the tap meant for TikTok's own play button
                      sitting underneath it. */}
                  {tiktokNeedsManualPlay && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
                      <span className="rounded-full bg-black/75 px-3 py-1 text-xs font-medium text-white shadow-lg">
                        المس الفيديو لتشغيله
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={cn("aspect-video mx-auto", horizontalVideoMaxHeightClass)}>
              <iframe
                src={resolvedEmbedUrl}
                className="w-full h-full"
                title={video.title}
                allowFullScreen
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}

        </div>
      </div>

      {/* Title bar */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1
              className="text-base font-bold text-foreground"
              style={{ fontFamily: "'Montserrat', sans-serif" }}
            >
              {video.title}
            </h1>
            {video.title_arabic && (
              <p
                className="text-sm text-foreground/70 mt-0.5"
                dir="rtl"
                style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}
              >
                {video.title_arabic}
              </p>
            )}
          </div>
          <LikeButton videoId={video.id} isAuthenticated={isAuthenticated} />
        </div>
      </div>

      {/* TikTok-only: hidden audio sync. When source MP4 is available we drive
          the highlight from a real <audio> element. Otherwise fall back to a manual timer. */}
      {isTikTok && tiktokAudioUrl && (
        <>
          <audio
            ref={tiktokAudioRef}
            src={tiktokAudioUrl}
            preload="auto"
            crossOrigin="anonymous"
            className="hidden"
            onLoadedMetadata={() => {
              setTiktokAudioReady(true);
              if (tiktokAudioRef.current) {
                tiktokAudioRef.current.playbackRate = playbackSpeed;
              }
              sendTikTokCommand("mute");
            }}
            onTimeUpdate={(e) => setCurrentTimeMs((e.currentTarget.currentTime || 0) * 1000)}
            onPlay={() => { setIsTiktokAudioPlaying(true); ensureTikTokVideoPlaying(true); }}
            onPause={() => { setIsTiktokAudioPlaying(false); ensureTikTokVideoPlaying(false); }}
            onSeeked={(e) => { sendTikTokCommand("mute"); sendTikTokCommand("seekTo", e.currentTarget.currentTime); }}
            onEnded={() => { setIsTiktokAudioPlaying(false); sendTikTokCommand("pause"); }}
          />
          {lines.length > 0 && (
            <div className="px-4 py-2 border-b border-border/50 bg-card/50 flex items-center justify-center gap-2">
              <Button
                variant={isTiktokAudioPlaying ? "secondary" : "default"}
                size="sm"
                className="gap-2"
                onClick={() => {
                  const audio = tiktokAudioRef.current;
                  if (!audio) return;
                  // Drive the video directly from the click too (rides the real
                  // user gesture, in addition to the audio onPlay/onPause path).
                  if (isTiktokAudioPlaying) {
                    audio.pause();
                    ensureTikTokVideoPlaying(false);
                  } else {
                    audio.play().catch(() => toast.error("تعذّر تشغيل الصوت"));
                    ensureTikTokVideoPlaying(true);
                  }
                }}
                disabled={!tiktokAudioReady}
              >
                {isTiktokAudioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isTiktokAudioPlaying ? "إيقاف مؤقت" : "تشغيل"}
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.floor(currentTimeMs / 1000)}s
              </span>
            </div>
          )}
        </>
      )}

      {/* Legacy TikTok fallback (no uploaded source audio) */}
      {isTikTok && !tiktokAudioUrl && lines.length > 0 && (
        <div className="px-4 py-2 border-b border-border/50 bg-card/50 flex flex-col items-center gap-1">
          {isAuthenticated && (
            <p className="text-[11px] text-muted-foreground/80 text-center px-2">
              Source audio missing — auto-sync unavailable. Re-upload the audio in Admin → Edit Video to enable it.
            </p>
          )}
          <div className="flex items-center justify-center gap-2">
            <Button
              variant={timerPlaying ? "secondary" : "default"}
              size="sm"
              className="gap-2"
              onClick={() => {
                setTimerPlaying((p) => !p);
                // Start timer from the current manual line position so the user
                // can press play without first scrubbing to a line.
                if (!timerPlaying && timerMs === 0 && lines[manualLineIndex]?.startMs !== undefined) {
                  setTimerMs(lines[manualLineIndex].startMs!);
                }
              }}
            >
              {timerPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {timerPlaying ? "أوقف المزامنة" : "ابدأ مزامنة الترجمة"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setTimerPlaying(false); setTimerMs(0); setManualLineIndex(0); setLineControlIndex(0); }}
            >
              Reset
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.floor(timerMs / 1000)}s
            </span>
          </div>
        </div>
      )}

      {/* Active subtitle display with navigation arrows */}
      {(
        <div className="px-4 py-4 border-b border-border bg-card/50 min-h-[80px]">
          <div className="flex items-center gap-2">
            {/* Previous line arrow */}
            <button
              onClick={() => playLineByIndex(lineControlIndex - 1)}
              disabled={lineControlIndex <= 0 || lines.length === 0}
              className={cn(
                "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                "bg-muted/60 transition-all duration-200",
                "hover:bg-muted active:scale-95",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-muted/60"
              )}
              aria-label="السطر السابق"
            >
              <ChevronLeft className="h-5 w-5 text-foreground" />
            </button>

            {/* Active line content */}
            <div className="flex-1 min-w-0">
              {displayLine ? (
                <div className="text-center space-y-1.5">
                  <p
                    className="text-lg font-medium text-foreground leading-[2]"
                    dir="rtl"
                    style={{ fontFamily: "'Noto Naskh Arabic', 'Traditional Arabic', serif" }}
                  >
                    {displayLine.tokens && displayLine.tokens.length > 0
                      ? displayLine.tokens.map((token, i) => (
                          <span key={token.id} className="inline">
                            <ClickableWord
                              token={token}
                              parentLine={displayLine}
                              onSave={isAuthenticated ? handleSaveToMyWords : undefined}
                              isSaved={savedWords?.has(token.surface)}
                            />
                            {i < displayLine.tokens.length - 1 && !/^[،؟.!:؛]+$/.test(token.surface) && " "}
                          </span>
                        ))
                      : displayLine.arabic}
                  </p>
                  {showFusha && (
                    fushaFor(displayLine) ? (
                      <FushaLine
                        dialect={displayLine.arabic}
                        fusha={fushaFor(displayLine)}
                        variant="inline"
                      />
                    ) : fushaStatus === "loading" ? (
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 text-center">
                        جارٍ التحويل إلى الفصحى…
                      </p>
                    ) : null
                  )}
                  {showTranslations && displayLine.translation && (
                    <>
                      <p
                        className="text-sm text-muted-foreground leading-relaxed"
                        style={{ fontFamily: "'Open Sans', sans-serif" }}
                      >
                        {displayLine.translation}
                      </p>
                    </>
                  )}
                  {showLiteral && displayLine.literal && (
                    <p
                      className="text-xs italic text-muted-foreground/80 leading-relaxed"
                      style={{ fontFamily: "'Open Sans', sans-serif" }}
                    >
                      <span className="not-italic uppercase tracking-wide text-[9px] mr-1.5 text-muted-foreground/60">
                        Literal
                      </span>
                      {displayLine.literal}
                    </p>
                  )}
                  {displayLine.arabic && (
                    <div className="flex flex-wrap justify-center gap-2 mt-2">
                      <AskAISentence
                        arabic={displayLine.arabic}
                        english={displayLine.translation}
                        variant="chip"
                        className="h-8 px-3 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                      />
                      {displayLineShadowClip && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleShadow(displayLine.id)}
                          className={cn(
                            "h-8 px-3 gap-1.5 rounded-full text-xs font-medium",
                            shadowLineId === displayLine.id
                              ? "bg-primary text-primary-foreground hover:bg-primary/90"
                              : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                          )}
                        >
                          <Mic className="h-3.5 w-3.5" />
                          {shadowLineId === displayLine.id ? "إغلاق" : "تدرّب بالمحاكاة"}
                        </Button>
                      )}
                    </div>
                  )}
                  {shadowLineId === displayLine.id && displayLineShadowClip && (
                    <div className="mx-auto max-w-xl text-left" onClick={(e) => e.stopPropagation()}>
                      <InlineLineShadow
                        clip={displayLineShadowClip}
                        audioUrl={shadowAudioUrl ?? null}
                        startMs={displayLine.startMs}
                        endMs={displayLine.endMs}
                        externalYouTubeController={mainYouTubeShadowController}
                        onClose={() => handleToggleShadow(displayLine.id)}
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground/60">{lineControlIndex + 1} / {lines.length}</p>
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground italic">
                  {lines.length > 0 ? (isYouTube ? "شغّل الفيديو لترى الترجمة" : "المس تشغيل على الفيديو للبدء") : "لا يتوفر نص للفيديو"}
                </p>
              )}
            </div>

            {/* Next line arrow */}
            <button
              onClick={() => playLineByIndex(lineControlIndex + 1)}
              disabled={lineControlIndex >= lines.length - 1 || lines.length === 0}
              className={cn(
                "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                "bg-muted/60 transition-all duration-200",
                "hover:bg-muted active:scale-95",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-muted/60"
              )}
              aria-label="السطر التالي"
            >
              <ChevronRight className="h-5 w-5 text-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-border/50 bg-card/50">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground text-xs"
          onClick={() => setShowFullTranscript(!showFullTranscript)}
        >
          <List className="h-3.5 w-3.5" />
          {showFullTranscript ? "أخفِ" : "أظهر"} النص ({lines.length})
        </Button>
        <div className="flex items-center gap-1.5">
          {/* Speed control */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                {playbackSpeed}x
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[100px]">
              {[0.5, 0.75, 1, 1.25, 1.5].map((speed) => (
                <DropdownMenuItem
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={cn("text-sm", playbackSpeed === speed && "font-bold text-primary")}
                >
                  {speed}x {speed === 1 && "(Normal)"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Playback mode toggle */}
          <Button
            variant={playbackMode === "line" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => setPlaybackMode((prev) => (prev === "continuous" ? "line" : "continuous"))}
          >
            {playbackMode === "continuous" ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {playbackMode === "continuous" ? "متواصل" : "جملة بجملة"}
          </Button>
          {showTranslations ? (
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {/* On an English video the spoken line is English, so what these
              reveal is the Arabic support: the dialect gloss, the word-for-word
              literal in English word order, and the Fusha rendering. */}
          <span className="text-xs text-muted-foreground">المعنى</span>
          <Switch
            checked={showTranslations}
            onCheckedChange={setShowTranslations}
          />
          <span className="text-xs text-muted-foreground ml-2">حرفي</span>
          <Switch
            checked={showLiteral}
            onCheckedChange={setShowLiteral}
          />
          <span className="text-xs text-muted-foreground ml-2">فصحى</span>
          <Switch
            checked={showFusha}
            onCheckedChange={setShowFusha}
            aria-label="أظهر سطر الفصحى"
          />
        </div>
      </div>

      {playbackMode === "line" && lines.length > 0 && (
        <div className="border-b border-border/50 bg-card/40 px-4 py-2">
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => playLineByIndex(lineControlIndex - 1)} disabled={lineControlIndex <= 0}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="default" size="sm" className="gap-2" onClick={() => playLineByIndex(lineControlIndex)}>
              <Play className="h-4 w-4" />
              Phrase {lineControlIndex + 1}/{lines.length}
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => playLineByIndex(lineControlIndex + 1)} disabled={lineControlIndex >= lines.length - 1}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Full transcript (toggleable) */}
      {showFullTranscript && (
        <div
          ref={transcriptContainerRef}
          className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
        >
          {lines.map((line) => (
            <TranscriptRow
              key={line.id}
              line={line}
              isActive={activeLineId === line.id}
              showTranslation={showTranslations}
              showLiteral={showLiteral}
              fusha={showFusha ? fushaFor(line) : undefined}
              onSave={isAuthenticated ? handleSaveToMyWords : undefined}
              savedWords={savedWords}
              lineRef={(el) => {
                if (el) lineRefs.current.set(line.id, el);
                else lineRefs.current.delete(line.id);
              }}
              onSeek={handleSeek}
              video={video}
              shadowAudioUrl={shadowAudioUrl}
              isShadowing={shadowLineId === line.id}
              onToggleShadow={handleToggleShadow}
              externalYouTubeController={mainYouTubeShadowController}
            />
          ))}
        </div>
      )}

      {/* Vocabulary, grammar & cultural context footer */}
      <div className="border-t border-border bg-card px-4 py-4 space-y-4">
        {onScreenLines.length > 0 && (
          <details className="group" open={!!video.is_meme}>
            <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
              On-Screen Text ({onScreenLines.length})
            </summary>
            <div className="mt-3 space-y-2">
              {onScreenLines.map((line) => (
                <div key={line.id} className="p-2 rounded-lg bg-muted/50">
                  <p dir="rtl" className="text-base font-medium text-foreground" style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}>
                    {line.arabic}
                  </p>
                  {line.translation && showTranslations && (
                    <p className="mt-1 text-xs text-muted-foreground">{line.translation}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {vocabulary.length > 0 && (
          <details className="group">
            <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
              Key Vocabulary ({vocabulary.length})
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {vocabulary.map((v, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50 text-sm"
                >
                  <span dir="rtl" className="font-medium text-foreground" style={{ fontFamily: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif" }}>
                    {v.arabic}
                  </span>
                  <span className="text-muted-foreground text-xs truncate">{v.english}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <GrammarNotesSection
          videoId={video.id}
          points={(video.grammar_points as any[]) ?? []}
          videoDifficulty={video.difficulty}
        />


        {video.cultural_context && (
          <details className="group" open={!!video.is_meme}>
            <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 text-muted-foreground" />
              {video.is_meme ? "تحليل الميم" : "السياق الثقافي"}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {video.cultural_context}
            </p>
          </details>
        )}

        {/* Video Rating */}
        <VideoRating videoId={video.id} userId={user?.id} />
      </div>
    </div>

  );
};

export default DiscoverVideo;
