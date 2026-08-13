import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { toast } from "sonner";
import { decodeAudioFile, clipToWav } from "@/lib/audioClipper";
import type { CandidateData } from "@/components/tutor/CandidateCard";

type Step = "upload" | "processing" | "review" | "confirm" | "creating";

interface DeepgramWord {
  text: string;
  start: number;
  end: number;
}

export function useTutorUpload() {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [uploadId] = useState(() => crypto.randomUUID());

  const updateCandidate = useCallback((id: string, updates: Partial<CandidateData>) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);

  const approveCandidate = useCallback((id: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, status: "approved" as const } : c));
  }, []);

  const rejectCandidate = useCallback((id: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, status: "rejected" as const } : c));
  }, []);

  const processFile = useCallback(async (selectedFile: File) => {
    if (!user) {
      toast.error("Please log in first");
      return;
    }

    setFile(selectedFile);
    setAudioUrl(URL.createObjectURL(selectedFile));
    setStep("processing");
    setProgress(0);

    try {
      // Step 1: Upload to storage for later clipping reference
      setProgressLabel("Uploading audio…");
      setProgress(5);

      const fileExt = selectedFile.name.split('.').pop() || 'mp3';
      const storagePath = `${user.id}/${uploadId}/source.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("tutor-audio-clips")
        .upload(storagePath, selectedFile);

      if (uploadError) {
        console.error("Storage upload error:", uploadError);
      }

      // Step 2: Transcribe with Deepgram (word-level timestamps)
      // Use the storage public URL when available — this avoids sending the entire
      // file as a FormData payload through the edge function (which has size limits
      // and chokes on large video files).
      setProgressLabel("Transcribing audio…");
      setProgress(15);

      let transcribeResult: { data: any; error: any };

      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage
          .from("tutor-audio-clips")
          .getPublicUrl(storagePath);
        transcribeResult = await supabase.functions.invoke("deepgram-transcribe", {
          body: { audioUrl: publicUrl },
        });
      } else {
        // Fallback: send file directly (only practical for small audio files)
        const formData = new FormData();
        formData.append("audio", selectedFile);
        transcribeResult = await supabase.functions.invoke("deepgram-transcribe", {
          body: formData,
        });
      }

      const { data: transcribeData, error: transcribeError } = transcribeResult;

      if (transcribeError || !transcribeData) {
        console.error("Transcription error full object:", transcribeError);
        let details = "";
        try {
          const resp = (transcribeError as any)?.context;
          if (resp && typeof resp.json === "function") {
            const body = await resp.json();
            details = body?.error || body?.details || body?.message || "";
          }
        } catch { /* ignore parse errors */ }
        throw new Error(details || transcribeError?.message || "Transcription failed");
      }

      setProgress(50);
      const words: DeepgramWord[] = transcribeData.words || [];
      
      if (words.length === 0) {
        throw new Error("No words detected in audio. Please try a different file.");
      }

      // Step 3: Build segments from word-level timestamps
      // Group consecutive words into segments (split on pauses > 500ms)
      setProgressLabel("Segmenting transcript…");
      setProgress(55);

      const segments: { text: string; startMs: number; endMs: number }[] = [];
      let currentSegment: { words: string[]; startMs: number; endMs: number } | null = null;

      for (const word of words) {
        const startMs = Math.round(word.start * 1000);
        const endMs = Math.round(word.end * 1000);

        if (!currentSegment) {
          currentSegment = { words: [word.text], startMs, endMs };
        } else if (startMs - currentSegment.endMs > 500) {
          // Pause detected — flush segment
          segments.push({
            text: currentSegment.words.join(" "),
            startMs: currentSegment.startMs,
            endMs: currentSegment.endMs,
          });
          currentSegment = { words: [word.text], startMs, endMs };
        } else {
          currentSegment.words.push(word.text);
          currentSegment.endMs = endMs;
        }
      }
      if (currentSegment) {
        segments.push({
          text: currentSegment.words.join(" "),
          startMs: currentSegment.startMs,
          endMs: currentSegment.endMs,
        });
      }

      // Step 4: AI classification — pass both segments and raw word timestamps
      setProgressLabel("Classifying vocabulary…");
      setProgress(65);

      // Build word-level list with indices for precise clipping
      const indexedWords = words.map((w, i) => ({
        text: w.text,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        index: i,
      }));

      const { data: classifyData, error: classifyError } = await supabase.functions.invoke(
        "classify-tutor-segments",
        { body: { segments, words: indexedWords, dialectModule: activeDialect } }
      );

      if (classifyError || !classifyData?.success) {
        throw new Error(classifyError?.message || classifyData?.error || "Classification failed");
      }

      setProgress(90);

      // Step 5: Build candidate objects
      const rawCandidates = classifyData.candidates || [];
      const candidateObjects: CandidateData[] = rawCandidates.map((c: any, i: number) => ({
        id: crypto.randomUUID(),
        word_text: c.word_text,
        word_standard: c.word_standard,
        word_english: c.word_english,
        sentence_text: c.sentence_text,
        sentence_english: c.sentence_english,
        word_start_ms: c.word_start_ms,
        word_end_ms: c.word_end_ms,
        sentence_start_ms: c.sentence_start_ms,
        sentence_end_ms: c.sentence_end_ms,
        confidence: c.confidence,
        classification: c.classification,
        status: "pending" as const,
        // Auto-suggest image for CONCRETE and ACTION only
        image_enabled: c.classification === "CONCRETE" || c.classification === "ACTION",
      }));

      setCandidates(candidateObjects);
      setProgress(100);
      setStep("review");

      toast.success(`Found ${candidateObjects.length} vocabulary candidates`);
    } catch (err) {
      console.error("Processing error:", err);
      toast.error("Processing failed", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
      setStep("upload");
    }
  }, [user, uploadId]);

  const createFlashcards = useCallback(async () => {
    if (!user || !file) return;

    const approved = candidates.filter(c => c.status === "approved");
    if (approved.length === 0) {
      toast.error("No approved candidates to create");
      return;
    }

    setStep("creating");
    setProgress(0);
    setProgressLabel("Preparing audio clips…");

    try {
      // === Step A: Overlap audio decode + image resolution ===
      const imageNeeded = approved.filter(c => c.image_enabled);
      const imageMap = new Map<string, string>();
      let imagesResolved = 0;

      const imageResolutionPromise = (async () => {
        if (imageNeeded.length === 0) return;
        setProgressLabel(`Generating images (0 of ${imageNeeded.length})…`);

        // Batch lookup existing images
        const lookupResults = await Promise.all(
          imageNeeded.map(async (candidate) => {
            try {
              const { data: existingWord } = await supabase
                .from("vocabulary_words")
                .select("image_url")
                .ilike("word_english", candidate.word_english || "")
                .not("image_url", "is", null)
                .limit(1)
                .maybeSingle();
              return { id: candidate.id, url: existingWord?.image_url || null, candidate };
            } catch {
              return { id: candidate.id, url: null, candidate };
            }
          })
        );

        const needGeneration: typeof lookupResults = [];
        for (const result of lookupResults) {
          if (result.url) {
            imageMap.set(result.id, result.url);
            imagesResolved++;
            setProgressLabel(`Generating images (${imagesResolved} of ${imageNeeded.length})…`);
          } else {
            needGeneration.push(result);
          }
        }

        if (needGeneration.length > 0) {
          await Promise.allSettled(
            needGeneration.map(async ({ id, candidate }) => {
              try {
                const imgPath = `tutor/${user.id}/${id}.png`;
                const { data: imgData, error: imgError } = await supabase.functions.invoke(
                  "generate-flashcard-image",
                  { body: { word_arabic: candidate.word_text, word_english: candidate.word_english, storage_path: imgPath } }
                );
                if (!imgError && imgData?.imageUrl) {
                  imageMap.set(id, imgData.imageUrl);
                }
              } catch (err) {
                console.error("Image generation failed for:", candidate.word_english, err);
              } finally {
                imagesResolved++;
                setProgressLabel(`Generating images (${imagesResolved} of ${imageNeeded.length})…`);
              }
            })
          );
        }
      })();

      // Run audio decode concurrently with image resolution
      setProgressLabel("Decoding audio…");
      const [audioBuffer] = await Promise.all([
        decodeAudioFile(file),
        imageResolutionPromise,
      ]);
      setProgress(50);

      // === Step B: Parallel audio clipping + upload ===
      setProgressLabel("Clipping & uploading audio…");

      // Clip all audio synchronously (CPU-bound, fast)
      interface ClipResult {
        candidateId: string;
        wordBlob: Blob;
        wordPath: string;
        sentBlob: Blob | null;
        sentPath: string | null;
      }

      const clips: ClipResult[] = approved.map(candidate => {
        const wordBlob = clipToWav(audioBuffer, candidate.word_start_ms, candidate.word_end_ms);
        const wordPath = `${user.id}/${uploadId}/word-${candidate.id}.wav`;

        let sentBlob: Blob | null = null;
        let sentPath: string | null = null;
        if (candidate.sentence_start_ms != null && candidate.sentence_end_ms != null && candidate.sentence_text) {
          sentBlob = clipToWav(audioBuffer, candidate.sentence_start_ms, candidate.sentence_end_ms);
          sentPath = `${user.id}/${uploadId}/sent-${candidate.id}.wav`;
        }

        return { candidateId: candidate.id, wordBlob, wordPath, sentBlob, sentPath };
      });

      // Upload all clips in parallel
      const uploadPromises = clips.flatMap(clip => {
        const promises: Promise<void>[] = [];
        promises.push(
          supabase.storage
            .from("tutor-audio-clips")
            .upload(clip.wordPath, clip.wordBlob, { contentType: "audio/wav" })
            .then(({ error }) => { if (error) console.error("Word clip upload error:", error); })
        );
        if (clip.sentBlob && clip.sentPath) {
          const sentBlob = clip.sentBlob;
          const sentPath = clip.sentPath;
          promises.push(
            supabase.storage
              .from("tutor-audio-clips")
              .upload(sentPath, sentBlob, { contentType: "audio/wav" })
              .then(({ error }) => { if (error) console.error("Sentence clip upload error:", error); })
          );
        }
        return promises;
      });

      await Promise.allSettled(uploadPromises);
      setProgress(80);

      // === Step C: Batch database insert ===
      setProgressLabel("Saving flashcards…");

      const insertRows: any[] = approved.map(candidate => {
        const clip = clips.find(c => c.candidateId === candidate.id)!;
        const { data: wordUrlData } = supabase.storage
          .from("tutor-audio-clips")
          .getPublicUrl(clip.wordPath);

        let sentenceAudioUrl: string | null = null;
        if (clip.sentPath) {
          const { data: sentUrlData } = supabase.storage
            .from("tutor-audio-clips")
            .getPublicUrl(clip.sentPath);
          sentenceAudioUrl = sentUrlData.publicUrl;
        }

        return {
          user_id: user.id,
          word_arabic: candidate.word_text,
          word_english: candidate.word_english,
          source: "tutor-upload",
          word_audio_url: wordUrlData.publicUrl,
          sentence_audio_url: sentenceAudioUrl,
          source_upload_id: uploadId,
          image_url: imageMap.get(candidate.id) || null,
          dialect: activeDialect,
        };
      });

      const { error: batchInsertError } = await supabase
        .from("user_vocabulary")
        .insert(insertRows);

      if (batchInsertError) {
        console.error("Batch insert error:", batchInsertError);
        // If batch fails (e.g. partial duplicates), fall back to individual inserts
        if (batchInsertError.code === "23505") {
          console.warn("Batch had duplicates, falling back to individual inserts…");
          for (const row of insertRows) {
            const { error } = await supabase.from("user_vocabulary").insert(row);
            if (error && error.code !== "23505") console.error("Insert error:", error);
          }
        }
      }

      setProgress(100);
      setProgressLabel("Done!");
      toast.success(`Created ${approved.length} flashcards!`);
      setStep("confirm");
    } catch (err) {
      console.error("Flashcard creation error:", err);
      toast.error("Failed to create flashcards", {
        description: err instanceof Error ? err.message : "An unexpected error occurred",
      });
      setStep("review");
    }
  }, [user, file, candidates, uploadId, activeDialect]);

  return {
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
  };
}
