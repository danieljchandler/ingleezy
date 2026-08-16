import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileAudio, Download, Loader2, X, BookOpen, Languages, Sparkles, Save, Check, Plus, Link2, Type } from "lucide-react";
import { toast } from "sonner";
import { LoadingPanel } from "@/components/loading/LoadingPanel";
import { HomeButton } from "@/components/HomeButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TranscriptResult, VocabItem, GrammarPoint, OnScreenTextSegment } from "@/types/transcript";
import { decodeAudioFile, clipToWav } from "@/lib/audioClipper";
import { extractFramesWithTimestamps } from "@/lib/videoFrameExtractor";
import { LineByLineTranscript } from "@/components/transcript/LineByLineTranscript";
import { TimeRangeSelector } from "@/components/transcript/TimeRangeSelector";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function normalizeTranscriptResult(input: TranscriptResult): TranscriptResult {
  const safeLines = Array.isArray(input.lines) ? input.lines : [];
  const safeVocab = Array.isArray(input.vocabulary) ? input.vocabulary : [];
  const safeGrammar = Array.isArray(input.grammarPoints) ? input.grammarPoints : [];

  return {
    rawTranscriptArabic: String(input.rawTranscriptArabic ?? ""),
    culturalContext:
      input.culturalContext === undefined ? undefined : String(input.culturalContext),
    dialect: input.dialect,
    vocabulary: safeVocab
      .filter((v) => v && typeof v === "object")
      .map((v) => ({
        arabic: String((v as VocabItem).arabic ?? ""),
        english: String((v as VocabItem).english ?? ""),
        root: (v as VocabItem).root ? String((v as VocabItem).root) : undefined,
      }))
      .filter((v) => v.arabic.length > 0),
    grammarPoints: safeGrammar
      .filter((g) => g && typeof g === "object")
      .map((g) => ({
        title: String((g as GrammarPoint).title ?? ""),
        explanation: String((g as GrammarPoint).explanation ?? ""),
        examples: Array.isArray((g as GrammarPoint).examples)
          ? (g as GrammarPoint).examples!.map(String)
          : undefined,
      }))
      .filter((g) => g.title.length > 0),
    lines: safeLines
      .filter((l) => l && typeof l === "object")
      .map((l, idx) => {
        const line = l as TranscriptResult["lines"][number];
        const tokens = Array.isArray(line.tokens) ? line.tokens : [];
        return {
          id: typeof line.id === "string" && line.id ? line.id : `line-${idx}`,
          arabic: String(line.arabic ?? ""),
          translation: String(line.translation ?? ""),
          // Both of these used to be dropped here, so a transcript that came
          // back with a word-for-word gloss and a Fusha rendering rendered
          // neither — the normalizer rebuilds each line field by field.
          literal: line.literal ? String(line.literal) : undefined,
          fusha: line.fusha ? String(line.fusha) : undefined,
          tokens: tokens
            .filter((t) => t && typeof t === "object")
            .map((t, tIdx) => ({
              id: typeof t.id === "string" && t.id ? t.id : `tok-${idx}-${tIdx}`,
              surface: String(t.surface ?? ""),
              standard: t.standard ? String(t.standard) : undefined,
              gloss: t.gloss ? String(t.gloss) : undefined,
            }))
            .filter((t) => t.surface.length > 0),
        };
      })
      .filter((l) => l.arabic.length > 0),
  };
}

interface DeepgramWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

interface DeepgramTranscriptionResult {
  text: string;
  words?: DeepgramWord[];
}

function mapTimestampsToLines(
  lines: TranscriptResult["lines"],
  words: DeepgramWord[]
): TranscriptResult["lines"] {
  if (!words || words.length === 0) return lines;
  
  const normalizeArabic = (text: string) => 
    text.replace(/[\u064B-\u0652\u0670]/g, '')
        .replace(/[^\u0600-\u06FF]/g, '')
        .trim();
  
  let wordIndex = 0;
  
  return lines.map(line => {
    const lineWords = line.arabic.split(/\s+/).filter(Boolean);
    if (lineWords.length === 0) return line;
    
    let startMs: number | undefined;
    let endMs: number | undefined;
    
    const startSearchIndex = wordIndex;
    let matchedFirst = false;
    
    for (let i = 0; i < lineWords.length; i++) {
      const lineWord = normalizeArabic(lineWords[i]);
      if (!lineWord) continue;
      
      for (let j = matchedFirst ? wordIndex : startSearchIndex; j < words.length; j++) {
        const transcribedWord = normalizeArabic(words[j].text);
        if (transcribedWord === lineWord || transcribedWord.includes(lineWord) || lineWord.includes(transcribedWord)) {
          if (!matchedFirst) {
            startMs = Math.round(words[j].start * 1000);
            matchedFirst = true;
          }
          endMs = Math.round(words[j].end * 1000);
          wordIndex = j + 1;
          break;
        }
      }
    }
    
    if (startMs !== undefined && endMs !== undefined) {
      return { ...line, startMs, endMs };
    }
    
    return line;
  });
}

/**
 * Filter transcription words to only those within a time range
 */
function filterWordsByTimeRange(
  words: DeepgramWord[],
  startSec: number,
  endSec: number
): DeepgramWord[] {
  return words.filter(w => w.start >= startSec && w.end <= endSec);
}

/**
 * Filter raw transcript text by keeping only words within time range
 */
function filterTranscriptByTimeRange(
  text: string,
  words: DeepgramWord[],
  startSec: number,
  endSec: number
): string {
  const filteredWords = filterWordsByTimeRange(words, startSec, endSec);
  if (filteredWords.length === 0) return text; // fallback to full text
  return filteredWords.map(w => w.text).join(" ");
}

const MAX_DURATION = 180; // 3 minutes

const Transcribe = () => {
  const { user, isAuthenticated } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminAuth();
  const { activeDialect } = useDialect();

  const addUserVocabulary = useAddUserVocabulary();
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [vocabSectionWords, setVocabSectionWords] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  /**
   * The transcript text that is known to be in the library, or null.
   *
   * Stored rather than a boolean, because "is this saved?" is a question about
   * *which* transcript is on screen, and a boolean cannot answer it. The flag
   * used to be set true by the save handler and by the loader, and reset false
   * by an effect keyed on the transcript text — and on the loader's path both
   * happened in the same batch, so the reset always won. Opening something
   * from the library offered to save it again, and pressing the button it
   * offered added a second copy, every time.
   */
  const [savedTranscript, setSavedTranscript] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [transcriptResult, setTranscriptResult] = useState<TranscriptResult | null>(null);
  const [debugTrace, setDebugTrace] = useState<{
    phase: string;
    at: string;
    message?: string;
    details?: unknown;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const enginesUsedRef = useRef<string[]>([]);

  // URL import state
  const [urlInput, setUrlInput] = useState("");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);

  // Duration & time range state
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number]>([0, MAX_DURATION]);

  // Derived state
  const transcript = transcriptResult?.rawTranscriptArabic ?? "";
  const vocabulary = transcriptResult?.vocabulary ?? [];
  const grammarPoints = transcriptResult?.grammarPoints ?? [];
  const culturalContext = transcriptResult?.culturalContext;
  const lines = transcriptResult?.lines ?? [];

  // Load a previously saved transcription when ?saved=<id> is present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedId = params.get("saved");
    if (!savedId || !user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("saved_transcriptions")
        .select("title,raw_transcript_arabic,vocabulary,grammar_points,lines,cultural_context,audio_url")
        .eq("id", savedId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("تعذّر تحميل التفريغ المحفوظ", { description: error?.message });
        return;
      }
      setTranscriptResult({
        rawTranscriptArabic: data.raw_transcript_arabic ?? "",
        vocabulary: (Array.isArray(data.vocabulary) ? data.vocabulary : []) as any,
        grammarPoints: (Array.isArray(data.grammar_points) ? data.grammar_points : []) as any,
        culturalContext: (data.cultural_context ?? undefined) as any,
        lines: (Array.isArray(data.lines) ? data.lines : []) as any,
      } as TranscriptResult);
      if (data.audio_url) setAudioUrl(data.audio_url);
      setSavedTranscript(data.raw_transcript_arabic ?? "");
      setSaveTitle(data.title ?? "");
      toast.success(`فُتح «${data.title}»`);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Check if current URL is in URL params (indicates this was loaded from cache)
  const currentUrlFromParams = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('url');
    } catch {
      return null;
    }
  }, []);

  const debugEnabled = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).has("debug");
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!debugTrace) return;
    try {
      sessionStorage.setItem("__transcribe_debug_trace", JSON.stringify(debugTrace));
    } catch { /* ignore */ }
  }, [debugTrace]);

  useEffect(() => {
    try {
      const storedTrace = sessionStorage.getItem("__transcribe_debug_trace");
      const unloadAt = sessionStorage.getItem("__transcribe_unload_at");
      const unloadPhase = sessionStorage.getItem("__transcribe_unload_phase");
      const unloadActive = sessionStorage.getItem("__transcribe_unload_active");

      if (storedTrace && !debugTrace) {
        setDebugTrace(JSON.parse(storedTrace));
      }

      // Always clear markers first to prevent stale toasts on future loads
      sessionStorage.removeItem("__transcribe_unload_at");
      sessionStorage.removeItem("__transcribe_unload_phase");
      sessionStorage.removeItem("__transcribe_unload_active");

      // Only show the toast if the crash was recent (within 30 seconds)
      if (unloadAt && unloadActive === "1") {
        const crashAge = Date.now() - new Date(unloadAt).getTime();
        if (crashAge < 10_000) {
          toast.error("أُعيد تحميل الصفحة أثناء الرفع", {
            description: unloadPhase ? `آخر مرحلة: ${unloadPhase}` : "صار تحديث غير متوقّع للصفحة.",
          });
        }
      }
    } catch (err) {
      console.error("Failed to restore transcribe debug state:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const onBeforeUnload = () => {
      try {
        if (!isProcessing && !isAnalyzing) return;
        sessionStorage.setItem("__transcribe_unload_at", new Date().toISOString());
        sessionStorage.setItem("__transcribe_unload_phase", debugTrace?.phase ?? "unknown");
        sessionStorage.setItem("__transcribe_unload_active", "1");
      } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [debugTrace?.phase, isAnalyzing, isProcessing]);

  // Detect duration from uploaded file
  const detectFileDuration = useCallback((selectedFile: File) => {
    const mediaEl = selectedFile.type.startsWith("video/")
      ? document.createElement("video")
      : document.createElement("audio");
    
    mediaEl.preload = "metadata";
    const objectUrl = URL.createObjectURL(selectedFile);
    mediaEl.src = objectUrl;
    
    mediaEl.onloadedmetadata = () => {
      const dur = Math.ceil(mediaEl.duration);
      setMediaDuration(dur);
      setTimeRange([0, Math.min(dur, MAX_DURATION)]);
      URL.revokeObjectURL(objectUrl);
    };

    mediaEl.onerror = () => {
      console.warn("Could not detect media duration");
      URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const isVideoFile = (f: File) =>
    f.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi)$/i.test(f.name);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
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

        if (!isAdmin && isVideoFile(selectedFile)) {
          toast.error("رفع الفيديو للإدارة فقط", { description: "ارفع ملف صوت (MP3، WAV، M4A، OGG)" });
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        setFile(selectedFile);
        setTranscriptResult(null);
        
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(selectedFile));
        detectFileDuration(selectedFile);
      }
    } catch (err) {
      console.error("handleFileSelect error:", err);
      setDebugTrace({ phase: "fileSelectError", at: new Date().toISOString(), message: err instanceof Error ? err.message : String(err) });
      toast.error("تعذّر اختيار الملف");
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    try {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) {
        if (!isAdmin && isVideoFile(droppedFile)) {
          toast.error("رفع الفيديو للإدارة فقط", { description: "ارفع ملف صوت (MP3، WAV، M4A، OGG)" });
          return;
        }
        setFile(droppedFile);
        setTranscriptResult(null);
        
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(droppedFile));
        detectFileDuration(droppedFile);
      }
    } catch (err) {
      console.error("handleDrop error:", err);
      toast.error("تعذّر تحميل الملف");
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const clearFile = () => {
    setFile(null);
    setTranscriptResult(null);
    setMediaDuration(null);
    setTimeRange([0, MAX_DURATION]);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearUrl = () => {
    setUrlInput("");
    setMediaDuration(null);
    setTimeRange([0, MAX_DURATION]);
    setTranscriptResult(null);
  };

  // URL processing
  const processUrl = async () => {
    let trimmed = urlInput.trim();
    if (!trimmed) return;

    // Store URL in component state and URL params for caching
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('url', trimmed);
    window.history.replaceState({}, '', `${window.location.pathname}?${searchParams}`);
    // Auto-prepend https:// if missing
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      trimmed = `https://${trimmed}`;
    }

    // Basic URL validation
    try {
      const parsed = new URL(trimmed);
      if (!parsed.hostname.includes('.')) {
        toast.error("رابط غير صالح", { description: "أدخل رابطاً صحيحاً (مثل https://youtube.com/watch?v=...)" });
        return;
      }
    } catch {
      toast.error("رابط غير صالح", { description: "أدخل رابطاً صحيحاً" });
      return;
    }

    setIsLoadingUrl(true);
    try {
      // Detect platform for logging
      const hostname = new URL(trimmed).hostname;
      let platform = 'other';
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) platform = 'youtube';
      else if (hostname.includes('tiktok.com')) platform = 'tiktok';
      else if (hostname.includes('instagram.com')) platform = 'instagram';
      else if (hostname.includes('x.com') || hostname.includes('twitter.com')) platform = 'x';

      // Log the import (fire-and-forget)
      supabase.from('content_import_logs').insert({
        user_id: user?.id ?? null,
        url: trimmed,
        platform,
      }).then(({ error: logErr }) => {
        if (logErr) console.warn('Import log failed:', logErr.message);
      });

      const { data, error } = await supabase.functions.invoke("download-media", {
        body: { url: trimmed },
      });

      if (error) throw new Error(error.message);
      
      // Check if we got cached transcription data
      if (data?.cached && data?.transcriptionData) {
        toast.success("استخدمنا تفريغاً مخزّناً!", {
          description: `Processed ${data.cacheAge ? Math.floor(data.cacheAge) : '?'} days ago • ${data.processingEngines?.length || 0} engines`,
          duration: 5000,
        });
        
        // Set the cached result directly
        const cached = normalizeTranscriptResult(data.transcriptionData);
        setTranscriptResult(cached);
        setIsLoadingUrl(false);
        return;
      }
      
      if (!data?.audioBase64) throw new Error("ما لقينا ملف صوت");

      // Convert base64 to File
      const binaryStr = atob(data.audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: data.contentType || 'video/mp4' });
      const filename = data.filename || 'downloaded-media.mp4';
      const downloadedFile = new File([blob], filename, { type: blob.type });

      // Use the file upload path instead of URL path
      setFile(downloadedFile);
      
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(downloadedFile));
      detectFileDuration(downloadedFile);

      toast.success("تم تنزيل الملف!", {
        description: `${filename} (${(data.size / 1024 / 1024).toFixed(1)}MB)`,
      });
    } catch (err) {
      console.error("URL processing error:", err);
      toast.error("تعذّرت معالجة الرابط", {
        description: err instanceof Error ? err.message : "حدث خطأ غير متوقع",
      });
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const analyzeTranscript = async (
    rawText: string,
    munsitText?: string,
    fanarText?: string,
    sonioxText?: string,
    visualContext?: string,
  ): Promise<{
    vocabulary: VocabItem[];
    grammarPoints: GrammarPoint[];
    culturalContext?: string;
    lines?: TranscriptResult["lines"];
    dialect?: TranscriptResult["dialect"];
    difficulty?: TranscriptResult["difficulty"];
  } | null> => {
    setIsAnalyzing(true);
    try {
      setDebugTrace({ phase: "request:analyze", at: new Date().toISOString() });

      const body: Record<string, string> = { transcript: rawText };
      if (munsitText) body.munsitTranscript = munsitText;
      if (fanarText) body.fanarTranscript = fanarText;
      if (sonioxText) body.sonioxTranscript = sonioxText;
      if (visualContext) body.visualContext = visualContext;
      
      // Add original URL if this analysis came from a URL import (for caching)
      const currentUrlParam = new URLSearchParams(window.location.search).get('url');
      if (currentUrlParam) body.originalUrl = currentUrlParam;

      // Pass active dialect module so the analyzer uses Egyptian/Yemeni/Gulf prompts
      body.dialectModule = activeDialect;

      const { data, error } = await supabase.functions.invoke<{
        success: boolean;
        result?: TranscriptResult;
        error?: string;
        details?: unknown;
      }>("analyze-gulf-arabic", {
        body,
      });

      if (error) throw new Error(error.message || "فشل التحليل");
      if (!data?.success || !data.result) throw new Error(data?.error || "فشل التحليل");

      const normalized = normalizeTranscriptResult(data.result);

      toast.success("اكتمل التحليل!", {
        description: `Extracted ${normalized.vocabulary.length} words and ${normalized.lines.length} sentences`,
      });

      setDebugTrace({
        phase: "response:analyze",
        at: new Date().toISOString(),
        details: { lines: normalized.lines.length, vocab: normalized.vocabulary.length },
      });

      return {
        vocabulary: normalized.vocabulary,
        grammarPoints: normalized.grammarPoints,
        culturalContext: normalized.culturalContext,
        lines: normalized.lines,
        dialect: data.result.dialect,
        difficulty: data.result.difficulty,
      };
    } catch (error) {
      console.error("Analysis error:", error);
      setDebugTrace({ phase: "error:analyze", at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      toast.error("فشل التحليل", { description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" });
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const transcribeFile = async () => {
    if (!file) return;

    setDebugTrace({ phase: "start", at: new Date().toISOString() });
    setIsProcessing(true);
    setProgress(0);
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) { if (progressInterval) clearInterval(progressInterval); return 90; }
          return prev + Math.random() * 10;
        });
      }, 500);

      // Clone files for parallel uploads (some browsers can't share a File across concurrent reads)
      const fileClone = new File([file], file.name, { type: file.type });
      const fileClone2 = new File([file], file.name, { type: file.type });
      const fileClone3 = new File([file], file.name, { type: file.type });

      const formData = new FormData();
      formData.append("audio", file);

      const munsitFormData = new FormData();
      // munsit-transcribe expects the file under "file" (not "audio")
      munsitFormData.append("file", fileClone);

      const fanarFormData = new FormData();
      fanarFormData.append("audio", fileClone2);

      const sonioxFormData = new FormData();
      sonioxFormData.append("audio", fileClone3);
      // Dialect module steers Soniox's context biasing (vocab terms + domain)
      sonioxFormData.append("dialect", activeDialect);

      setDebugTrace({ phase: "request:transcribe", at: new Date().toISOString(), details: { name: file.name, size: file.size, type: file.type } });
      
      // Use direct fetch instead of supabase.functions.invoke to avoid
      // client-level timeouts / request transforms that can reload the page.
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const authToken = session?.access_token || supabaseKey;

      // Fire all transcription engines in parallel
      const deepgramPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/deepgram-transcribe`, {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${authToken}`,
            },
            body: formData,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(errBody || `Deepgram failed (${resp.status})`);
          }
          return await resp.json() as DeepgramTranscriptionResult;
        } catch (e) {
          clearTimeout(timeout);
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error("Deepgram تأخّر — جرّب مقطعاً أقصر.");
          }
          throw e;
        }
      })();

      // Munsit re-enabled: the Mar 2026 disable referenced api.cntxt.tools DNS,
      // but the edge function has been calling api.munsit.com successfully ever
      // since — the page was running without its best Arabic engine for an
      // obsolete reason.
      const munsitPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/munsit-transcribe`, {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${authToken}`,
            },
            body: munsitFormData,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(errBody || `Munsit failed (${resp.status})`);
          }
          return await resp.json() as { text?: string | null; error?: string };
        } catch (e) {
          clearTimeout(timeout);
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error("Munsit تأخّر — جرّب مقطعاً أقصر.");
          }
          throw e;
        }
      })();

      // Fanar ASR (budget-gated — the edge function handles budget checks)
      const fanarPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2 * 60 * 1000);
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/fanar-transcribe`, {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${authToken}`,
            },
            body: fanarFormData,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(errBody || `Fanar failed (${resp.status})`);
          }
          return await resp.json() as { text?: string | null; fanarUsed?: boolean; fanarAvailable?: boolean; budgetRemaining?: number };
        } catch (e) {
          clearTimeout(timeout);
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error("Fanar تأخّر.");
          }
          throw e;
        }
      })();

      // Soniox ASR
      const sonioxPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/soniox-transcribe`, {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${authToken}`,
            },
            body: sonioxFormData,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(errBody || `Soniox failed (${resp.status})`);
          }
          return await resp.json() as { text?: string | null; sonioxUsed?: boolean; words?: DeepgramWord[] };
        } catch (e) {
          clearTimeout(timeout);
          if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error("Soniox تأخّر.");
          }
          throw e;
        }
      })();

      // For video files, extract frames and detect on-screen text in parallel.
      // Often videos have POV captions, title cards, or contextual text overlays.
      // We capture them as a separate section so they aren't mistaken for spoken transcription.
      const visualContextPromise = (async (): Promise<{
        onScreenText: OnScreenTextSegment[];
        sceneContext: string;
      } | null> => {
        if (!isVideoFile(file)) return null;
        try {
          const frames = await extractFramesWithTimestamps(file, 3, 12, 768);
          if (frames.length === 0) return null;
          const { data, error: vcError } = await supabase.functions.invoke<{
            success: boolean;
            result?: {
              onScreenTextSegments: OnScreenTextSegment[];
              sceneContext: string;
              culturalContext: string;
            };
            error?: string;
          }>("extract-visual-context", {
            body: { frames, audioDuration: mediaDuration ?? undefined, videoTitle: file.name },
          });
          if (vcError || !data?.success || !data.result) {
            console.warn("Visual context extraction failed:", vcError?.message || data?.error);
            return null;
          }
          return {
            onScreenText: data.result.onScreenTextSegments || [],
            sceneContext: [data.result.sceneContext, data.result.culturalContext].filter(Boolean).join(" "),
          };
        } catch (e) {
          console.warn("Visual context extraction skipped:", e);
          return null;
        }
      })();

      const [deepgramResult, munsitResult, fanarResult, sonioxResult, visualResult] = await Promise.allSettled([deepgramPromise, munsitPromise, fanarPromise, sonioxPromise, visualContextPromise]);

      if (progressInterval) clearInterval(progressInterval);

      // Extract results with fallback
      const deepgramData = deepgramResult.status === "fulfilled" ? deepgramResult.value : null;
      const munsitData = munsitResult.status === "fulfilled" ? munsitResult.value : null;
      const fanarData = fanarResult.status === "fulfilled" ? fanarResult.value : null;
      const sonioxData = sonioxResult.status === "fulfilled" ? sonioxResult.value : null;

      if (deepgramResult.status === "rejected") {
        console.warn("Deepgram failed:", deepgramResult.reason);
      }
      if (munsitResult.status === "rejected") {
        console.warn("Munsit failed:", munsitResult.reason);
      } else if (munsitData && !munsitData.text && (munsitData as any).error) {
        console.warn("Munsit failed (non-blocking):", (munsitData as any).error);
      }
      if (fanarResult.status === "rejected") {
        console.warn("Fanar failed:", fanarResult.reason);
      }
      if (sonioxResult.status === "rejected") {
        console.warn("Soniox failed:", sonioxResult.reason);
      }

      // Need at least one to succeed
      if (!deepgramData?.text && !munsitData?.text && !fanarData?.text && !sonioxData?.text) {
        const munsitReason = munsitResult.status === "rejected"
          ? String(munsitResult.reason)
          : munsitData && !munsitData.text ? ((munsitData as any).error || 'no transcript') : null;
        const reasons = [
          deepgramResult.status === "rejected" ? `Deepgram: ${deepgramResult.reason}` : null,
          munsitReason ? `Munsit: ${munsitReason}` : null,
          fanarResult.status === "rejected" ? `Fanar: ${fanarResult.reason}` : null,
          sonioxResult.status === "rejected" ? `Soniox: ${sonioxResult.reason}` : null,
        ].filter(Boolean).join("; ");
        throw new Error(`All transcription engines failed. ${reasons}`);
      }

      const primaryText = deepgramData?.text || sonioxData?.text || munsitData?.text || fanarData?.text || "";
      const munsitText = munsitData?.text || undefined;
      const fanarText = (fanarData?.fanarUsed && fanarData?.text) ? fanarData.text : undefined;
      const sonioxText = (sonioxData?.sonioxUsed && sonioxData?.text) ? sonioxData.text : undefined;
      const deepgramWords = deepgramData?.words || [];

      // Log which engines succeeded
      const enginesUsed = [
        deepgramData?.text ? "Deepgram" : null,
        munsitData?.text ? "Munsit" : null,
        fanarText ? "Fanar" : null,
        sonioxText ? "Soniox" : null,
      ].filter(Boolean);
      console.log(`Transcription engines used: ${enginesUsed.join(" + ")}`);
      enginesUsedRef.current = enginesUsed as string[];
      if (fanarData && !fanarData.fanarUsed) {
        console.log(`Fanar ASR skipped: ${fanarData.fanarAvailable === false ? 'budget exhausted' : 'not used'} (remaining: ${fanarData.budgetRemaining ?? '?'})`);
      }

      // Apply time range filtering if duration is known and range is set
      let filteredText = primaryText;
      let filteredWords = deepgramWords;
      const filteredMunsitText = munsitText;
      const filteredFanarText = fanarText;
      const filteredSonioxText = sonioxText;

      if (mediaDuration && mediaDuration > MAX_DURATION && deepgramWords.length > 0) {
        filteredText = filterTranscriptByTimeRange(primaryText, deepgramWords, timeRange[0], timeRange[1]);
        filteredWords = filterWordsByTimeRange(deepgramWords, timeRange[0], timeRange[1]);
        // Other engines don't provide word-level timestamps, so we use them as-is
        console.log(`Time range filter: ${timeRange[0]}s-${timeRange[1]}s, words: ${deepgramWords.length} → ${filteredWords.length}`);
      }

      setProgress(100);

      const visualData = visualResult.status === "fulfilled" ? visualResult.value : null;
      const onScreenText = visualData?.onScreenText ?? [];
      const sceneContext = visualData?.sceneContext || undefined;

      const initialResult: TranscriptResult = {
        rawTranscriptArabic: filteredText,
        lines: [],
        vocabulary: [],
        grammarPoints: [],
        onScreenText: onScreenText.length > 0 ? onScreenText : undefined,
      };
      setTranscriptResult(initialResult);

      const engineCount = enginesUsed.length;
      const engineMsg = engineCount >= 4 ? "خلص التفريغ بأربعة محرّكات!" : engineCount >= 3 ? "خلص التفريغ بثلاثة محرّكات!" : engineCount === 2 ? "خلص التفريغ بمحرّكين!" : "خلص التفريغ!";
      const onScreenMsg = onScreenText.length > 0 ? ` Detected ${onScreenText.length} on-screen text overlay${onScreenText.length === 1 ? '' : 's'}.` : '';
      toast.success(engineMsg, { description: `Analyzing with multi-LLM ensemble...${onScreenMsg}` });

      const analysisData = await analyzeTranscript(filteredText, filteredMunsitText, filteredFanarText, filteredSonioxText, sceneContext);
      if (analysisData) {
        const linesWithTimestamps = mapTimestampsToLines(analysisData.lines || [], filteredWords);
        console.log('Mapped timestamps:', linesWithTimestamps.filter(l => l.startMs !== undefined).length, '/', linesWithTimestamps.length);
        
        setTranscriptResult(prev => prev ? {
          ...prev,
          vocabulary: analysisData.vocabulary,
          grammarPoints: analysisData.grammarPoints,
          culturalContext: analysisData.culturalContext,
          lines: linesWithTimestamps,
          dialect: analysisData.dialect,
          difficulty: analysisData.difficulty,
        } : null);
      }
    } catch (error) {
      console.error("Transcription error:", error);
      setDebugTrace({ phase: "error", at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
      toast.error("فشل التفريغ", { description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" });
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsProcessing(false);
      setProgress(0);
      setDebugTrace(prev => prev?.phase === "error" ? prev : { phase: "done", at: new Date().toISOString() });
    }
  };

  const exportTranscript = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("تم التصدير!");
  };

  const handleSaveClick = () => {
    if (!isAuthenticated) {
      toast.error("سجّل الدخول أولاً", { description: "تحتاج حساباً عشان تحفظ التفريغات" });
      return;
    }
    const defaultTitle = file?.name?.replace(/\.[^/.]+$/, "") || `Transcription ${new Date().toLocaleDateString('en-US')}`;
    setSaveTitle(defaultTitle);
    setShowSaveDialog(true);
  };

  const saveTranscription = async () => {
    if (!transcriptResult || !user) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from("saved_transcriptions").insert({
        user_id: user.id,
        title: saveTitle.trim() || `Transcription ${new Date().toLocaleDateString('en-US')}`,
        raw_transcript_arabic: transcriptResult.rawTranscriptArabic,
        lines: JSON.parse(JSON.stringify(transcriptResult.lines)),
        vocabulary: JSON.parse(JSON.stringify(transcriptResult.vocabulary)),
        grammar_points: JSON.parse(JSON.stringify(transcriptResult.grammarPoints)),
        cultural_context: transcriptResult.culturalContext || null,
        audio_url: audioUrl || null,
        dialect: activeDialect,
        engines_used: {
          asr: enginesUsedRef.current,
          translation: ['claude-sonnet-4.5 + gemini-3.5-flash + qwen3-max (weighted ensemble)'],
          analysis: 'analyze-gulf-arabic (AI Gateway ensemble)',
        },
      } as never);
      if (error) throw error;
      setSavedTranscript(transcriptResult?.rawTranscriptArabic ?? "");
      setShowSaveDialog(false);
      toast.success("حُفظ التفريغ!");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("فشل الحفظ", { description: error instanceof Error ? error.message : "حدث خطأ غير متوقع" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddToVocabSection = (word: VocabItem) => {
    if (!transcriptResult) return;
    if (vocabSectionWords.has(word.arabic)) {
      toast.info("الكلمة موجودة في قسم المفردات");
      return;
    }
    setTranscriptResult(prev => {
      if (!prev) return prev;
      const exists = prev.vocabulary.some(v => v.arabic === word.arabic);
      if (exists) return prev;
      return { ...prev, vocabulary: [...prev.vocabulary, word] };
    });
    setVocabSectionWords(prev => new Set(prev).add(word.arabic));
    toast.success("أُضيفت الكلمة إلى قسم المفردات");
  };
  
  const handleSaveToMyWords = async (word: VocabItem) => {
    if (!isAuthenticated) {
      toast.error("سجّل الدخول أولاً", { description: "تحتاج حساباً عشان تحفظ الكلمات" });
      return;
    }
    if (savedWords.has(word.arabic)) { toast.info("الكلمة محفوظة من قبل"); return; }
    try {
      console.log("Save to My Words - VocabItem:", JSON.stringify({ arabic: word.arabic, sentenceText: word.sentenceText, sentenceEnglish: word.sentenceEnglish, startMs: word.startMs, endMs: word.endMs }));
      let sentenceAudioUrl: string | undefined;

      // Clip sentence audio if timestamps are available. Prefer the local
      // File when present (fresh transcription); otherwise fall back to
      // fetching the previously uploaded audio_url (saved transcription /
      // imported video) so the clip is still attached to the flashcard.
      if (word.startMs !== undefined && word.endMs !== undefined) {
        try {
          let sourceFile: File | null = file;
          if (!sourceFile && audioUrl) {
            try {
              const resp = await fetch(audioUrl);
              if (resp.ok) {
                const blob = await resp.blob();
                sourceFile = new File([blob], "source-audio", {
                  type: blob.type || "audio/mpeg",
                });
              }
            } catch (fetchErr) {
              console.warn("Could not fetch source audio for clipping:", fetchErr);
            }
          }
          if (sourceFile) {
            const audioBuffer = await decodeAudioFile(sourceFile);
            const wavBlob = clipToWav(audioBuffer, word.startMs, word.endMs);
            const clipPath = `sentence-clips/${user!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`;
            const { error: uploadError } = await supabase.storage
              .from("flashcard-audio")
              .upload(clipPath, wavBlob, { contentType: "audio/wav" });
            if (!uploadError) {
              sentenceAudioUrl = supabase.storage.from("flashcard-audio").getPublicUrl(clipPath).data.publicUrl;
            } else {
              console.warn("Sentence audio upload failed:", uploadError);
            }
          }
        } catch (clipErr) {
          console.warn("Sentence audio clipping failed:", clipErr);
        }
      }

      await addUserVocabulary.mutateAsync({
        word_arabic: word.arabic,
        word_english: word.english,
        word_family: word.root,
        source: "transcription",
        sentence_text: word.sentenceText,
        sentence_english: word.sentenceEnglish,
        sentence_audio_url: sentenceAudioUrl,
      });
      setSavedWords(prev => new Set(prev).add(word.arabic));
      toast.success("حُفظت الكلمة في كلماتي");
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes("duplicate")) {
        setSavedWords(prev => new Set(prev).add(word.arabic));
        toast.info("الكلمة محفوظة من قبل");
      } else {
        toast.error("تعذّر حفظ الكلمة");
      }
    }
  };

  // Derived, so there is no ordering to get wrong: a freshly transcribed
  // clip is unsaved because its text is not the saved text, and re-running
  // the transcription un-saves it for the same reason.
  const isSaved =
    savedTranscript !== null &&
    savedTranscript === (transcriptResult?.rawTranscriptArabic ?? null);

  useEffect(() => {
    if (transcriptResult) {
      const existingVocab = new Set(transcriptResult.vocabulary.map(v => v.arabic));
      setVocabSectionWords(existingVocab);
    }
  }, [transcriptResult?.rawTranscriptArabic]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const hasInput = Boolean(file);
  const showTimeRange = mediaDuration !== null && mediaDuration > MAX_DURATION;

  // Video uploads & URL imports are admin-only. Audio uploads remain available to everyone.

  return (
    <ErrorBoundary name="Transcribe">
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <HomeButton />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground inline-flex items-center gap-2">تفريغ الصوت<InfoHint {...PAGE_HINTS["transcribe"]} size="md" />
            </h1>
            <p className="text-muted-foreground">
              {isAdmin
                ? "ارفع ملف صوت أو فيديو، أو الصق رابطاً من يوتيوب أو السوشال ميديا"
                : "ارفع ملف صوت عشان نفرّغه"}
            </p>
          </div>
        </div>

        {/* Input Area with Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>مصدر المحتوى</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="upload">
              <TabsList className={cn("grid w-full", isAdmin ? "grid-cols-2" : "grid-cols-1")}>
                <TabsTrigger value="upload" className="gap-2">
                  <Upload className="h-4 w-4" />رفع ملف</TabsTrigger>
                {isAdmin && (
                  <TabsTrigger value="url" className="gap-2">
                    <Link2 className="h-4 w-4" />رابط</TabsTrigger>
                )}
              </TabsList>

              {/* Upload Tab */}
              <TabsContent value="upload">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className={`
                    border-2 border-dashed rounded-lg p-8 text-center transition-colors
                    ${file ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                  `}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={isAdmin
                      ? "audio/*,video/*,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov"
                      : "audio/*,.mp3,.wav,.m4a,.ogg"}
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        <FileAudio className="h-8 w-8 text-primary" />
                        <div className="text-right">
                          <p className="font-medium text-foreground">{file.name}</p>
                          <p className="text-sm text-muted-foreground">{formatFileSize(file.size)}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={clearFile} disabled={isProcessing}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-foreground font-medium">المس أو اسحب ملفاً هنا</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {isAdmin ? "MP3, WAV, M4A, OGG, MP4, WebM, MOV" : "MP3, WAV, M4A, OGG"}
                      </p>
                    </label>
                  )}
                </div>
              </TabsContent>

              {/* URL Tab — admin only */}
              {isAdmin && (
                <TabsContent value="url">
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="الصق رابط يوتيوب أو تيك توك أو إنستغرام أو أي فيديو..."
                        dir="ltr"
                        className="font-mono text-sm"
                        disabled={isLoadingUrl || isProcessing}
                      />
                      <Button
                        onClick={processUrl}
                        disabled={!urlInput.trim() || isLoadingUrl || isProcessing}
                        variant="secondary"
                      >
                        {isLoadingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : "استخرج"}
                      </Button>
                    </div>
                    
                    <p className="text-xs text-muted-foreground">
                      Supports direct links and pages with embedded video/audio
                    </p>
                  </div>
                </TabsContent>
              )}
            </Tabs>

            {/* Time Range Selector */}
            {showTimeRange && hasInput && (
              <div className="mt-4 p-4 rounded-lg border bg-muted/30">
                <TimeRangeSelector
                  duration={mediaDuration!}
                  maxRange={MAX_DURATION}
                  value={timeRange}
                  onChange={setTimeRange}
                />
              </div>
            )}

            {/* Duration info */}
            {mediaDuration !== null && hasInput && !showTimeRange && (
              <p className="mt-3 text-xs text-muted-foreground text-center">
                Duration: {Math.floor(mediaDuration / 60)}:{(mediaDuration % 60).toString().padStart(2, "0")}
              </p>
            )}

            {/* Process Button */}
            {hasInput && (
              <Button
                onClick={() => {
                  try { void transcribeFile(); } catch (err) {
                    console.error("transcribeFile handler error:", err);
                    toast.error("حدث خطأ غير متوقع");
                  }
                }}
                disabled={isProcessing}
                className="w-full mt-4"
              >
                {isProcessing ? (
                  <><Loader2 className="me-2 h-4 w-4 animate-spin" />جارٍ التفريغ...</>
                ) : "ابدأ التفريغ"}
              </Button>
            )}

            {/* Progress Bar */}
            {isProcessing && (
              <div className="mt-4 space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground text-center">
                  {Math.round(progress)}% - Processing file...
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Dialog */}
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>احفظ التفريغ</DialogTitle>
              <DialogDescription>أدخل عنواناً لحفظ هذا التفريغ في حسابك</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="عنوان التفريغ..." />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>إلغاء</Button>
              <Button onClick={saveTranscription} disabled={isSaving}>
                {isSaving ? (<><Loader2 className="me-2 h-4 w-4 animate-spin" />جارٍ الحفظ...</>) : (<><Save className="me-2 h-4 w-4" />حفظ</>)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cache Status Badge */}
        {currentUrlFromParams && lines.length > 0 && (
          <div className="mb-4">
            <Badge variant="secondary" className="bg-accent text-accent-foreground border-border">
              <Sparkles className="w-3 h-3 me-1" />نتيجة فورية من الذاكرة المؤقتة</Badge>
          </div>
        )}

        {/* Transcript Display */}
        {lines.length > 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="space-y-2">
                <CardTitle>النص</CardTitle>
                <CardDescription>{lines.length} {lines.length === 1 ? "sentence" : "sentences"}</CardDescription>
                {(transcriptResult?.dialect || transcriptResult?.difficulty) && (
                  <div className="flex gap-2 flex-wrap">
                    {transcriptResult.dialect && (
                      <Badge variant="secondary" className="text-xs">
                        {transcriptResult.dialect === 'Saudi' ? '🇸🇦' :
                         transcriptResult.dialect === 'Kuwaiti' ? '🇰🇼' :
                         transcriptResult.dialect === 'UAE' ? '🇦🇪' :
                         transcriptResult.dialect === 'Bahraini' ? '🇧🇭' :
                         transcriptResult.dialect === 'Qatari' ? '🇶🇦' :
                         transcriptResult.dialect === 'Omani' ? '🇴🇲' : '🌍'} {transcriptResult.dialect} Arabic
                      </Badge>
                    )}
                    {transcriptResult.difficulty && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          transcriptResult.difficulty === 'Beginner' ? 'border-green-500 text-green-600' :
                          transcriptResult.difficulty === 'Intermediate' ? 'border-yellow-500 text-yellow-600' :
                          transcriptResult.difficulty === 'Advanced' ? 'border-orange-500 text-orange-600' :
                          'border-red-500 text-red-600'
                        }`}
                      >
                        {transcriptResult.difficulty}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveClick} variant={isSaved ? "secondary" : "default"} disabled={isSaved}>
                  {isSaved ? (<><Check className="me-2 h-4 w-4" />محفوظ</>) : (<><Save className="me-2 h-4 w-4" />حفظ</>)}
                </Button>
                <Button onClick={exportTranscript} variant="outline">
                  <Download className="me-2 h-4 w-4" />تصدير</Button>
              </div>
            </CardHeader>
            <CardContent>
              <LineByLineTranscript 
                lines={lines} 
                audioUrl={audioUrl || undefined}
                onAddToVocabSection={handleAddToVocabSection}
                onSaveToMyWords={handleSaveToMyWords}
                savedWords={savedWords}
                vocabSectionWords={vocabSectionWords}
              />
            </CardContent>
          </Card>
        ) : transcript ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>النص</CardTitle>
                <CardDescription>{transcript.length} characters</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveClick} variant={isSaved ? "secondary" : "default"} disabled={isSaved}>
                  {isSaved ? (<><Check className="me-2 h-4 w-4" />محفوظ</>) : (<><Save className="me-2 h-4 w-4" />حفظ</>)}
                </Button>
                <Button onClick={exportTranscript} variant="outline">
                  <Download className="me-2 h-4 w-4" />تصدير</Button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-right text-lg leading-relaxed text-foreground" dir="rtl">
                {transcript}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* On-screen text overlays (POV captions, title cards, memes, etc.) */}
        {transcriptResult?.onScreenText && transcriptResult.onScreenText.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Type className="h-5 w-5 text-primary" />نص على الشاشة</CardTitle>
              <CardDescription>
                Text overlays detected in the video — captions, title cards, or contextual graphics that aren't part of the spoken transcript.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {transcriptResult.onScreenText.map((seg, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/50 border space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className="text-lg font-semibold text-foreground text-right flex-1"
                        dir="rtl"
                      >
                        {seg.text}
                      </p>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {seg.startSeconds.toFixed(1)}–{seg.endSeconds.toFixed(1)}s
                      </Badge>
                    </div>
                    {seg.translation && (
                      <p className="text-sm text-muted-foreground">{seg.translation}</p>
                    )}
                    {seg.transliteration && (
                      <p className="text-xs text-muted-foreground italic">{seg.transliteration}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analysis Loading */}
        {isAnalyzing && (
          <Card>
            <CardContent className="py-8">
              <LoadingPanel task="transcribeAnalysis" variant="inline" />
            </CardContent>
          </Card>
        )}

        {/* Vocabulary Section */}
        {vocabulary.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />مفردات أساسية</CardTitle>
              <CardDescription>
                {vocabulary.length} words extracted from the text
                {isAuthenticated && " — tap + to add a word to your list"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {vocabulary.map((item, index) => {
                  const wordKey = item.arabic;
                  const isSavedWord = savedWords.has(wordKey);
                  
                  const handleAddWord = async () => {
                    if (!isAuthenticated) { toast.error("سجّل الدخول أولاً"); return; }
                    
                    // Auto-match to a sentence containing this word
                    const matchedLine = lines.find(l => 
                      l.tokens?.some(t => t.surface === item.arabic) || 
                      l.arabic.includes(item.arabic)
                    );
                    
                    const enrichedVocab: VocabItem = {
                      ...item,
                      sentenceText: matchedLine?.arabic,
                      sentenceEnglish: matchedLine?.translation,
                      startMs: matchedLine?.startMs,
                      endMs: matchedLine?.endMs,
                    };
                    
                    try {
                      await handleSaveToMyWords(enrichedVocab);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "تعذّرت إضافة الكلمة");
                    }
                  };
                  
                  return (
                    <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-foreground">{item.arabic}</span>
                        {item.root && <Badge variant="outline" className="font-mono text-xs">{item.root}</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{item.english}</span>
                        {isAuthenticated && (
                          <Button variant={isSavedWord ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={handleAddWord} disabled={isSavedWord || addUserVocabulary.isPending}>
                            {isSavedWord ? <Check className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4" />}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grammar Section */}
        {grammarPoints.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Languages className="h-5 w-5 text-primary" />نقاط القواعد</CardTitle>
              <CardDescription>أنماط القواعد الإنجليزية الموجودة في النص</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {grammarPoints.map((item, index) => (
                  <div key={index} className="p-4 rounded-lg bg-muted/50 border">
                    <h4 className="font-semibold text-foreground mb-2">{item.title}</h4>
                    <p className="text-muted-foreground text-sm">{item.explanation}</p>
                    {item.examples && item.examples.length > 0 && (
                      <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside">
                        {item.examples.map((ex, i) => <li key={i}>{ex}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cultural Context */}
        {culturalContext && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />السياق الثقافي</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">{culturalContext}</p>
            </CardContent>
          </Card>
        )}

        {debugEnabled && (
          <Card>
            <CardHeader>
              <CardTitle>تشخيص</CardTitle>
              <CardDescription>حالة الصفحة (أضف <span className="font-mono">?debug</span> للرابط)</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap rounded-md bg-muted p-3 border">
                {JSON.stringify({
                  debugTrace,
                  state: {
                    hasFile: Boolean(file),
                    isProcessing,
                    isAnalyzing,
                    progress,
                    mediaDuration,
                    timeRange,
                    hasAudioUrl: Boolean(audioUrl),
                    transcriptChars: transcript.length,
                    lines: lines.length,
                  },
                }, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
};

export default Transcribe;