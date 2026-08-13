import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Loader2, ArrowLeft, Play, Pause, Volume2, Plus, Check, Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TappableEnglishText } from "@/components/shared/TappableEnglishText";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { useAuth } from "@/hooks/useAuth";
import { useAddUserVocabulary } from "@/hooks/useUserVocabulary";
import {
  useListenEpisode,
  useGenerateListenLineAudio,
  useIncrementPlayCount,
  useDeleteListenEpisode,
} from "@/hooks/useListen";
import { toast } from "sonner";

const ListenEpisode = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: episode, isLoading } = useListenEpisode(id);
  const { prefs } = useDisplayPrefs();
  const showEnglish = prefs?.showEnglish ?? false;
  const lineAudio = useGenerateListenLineAudio();
  const incrementPlay = useIncrementPlayCount();
  const addVocab = useAddUserVocabulary();
  const deleteEp = useDeleteListenEpisode();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingLine, setPlayingLine] = useState<number | null>(null);
  const [isPlayingFull, setIsPlayingFull] = useState(false);
  const [addedVocab, setAddedVocab] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const incrementedRef = useRef(false);

  useEffect(() => {
    if (episode && !incrementedRef.current) {
      incrementedRef.current = true;
      incrementPlay.mutate(episode.id);
    }
  }, [episode, incrementPlay]);

  if (isLoading) {
    return <AppShell><div className="flex justify-center pt-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></AppShell>;
  }
  if (!episode) {
    return <AppShell><div className="text-center pt-20"><p className="text-muted-foreground">Episode not found.</p><Button variant="ghost" onClick={() => navigate("/listen")}>Back</Button></div></AppShell>;
  }

  const playLine = async (lineIndex: number) => {
    try {
      const url = await lineAudio.mutateAsync({ episodeId: episode.id, lineIndex });
      if (audioRef.current) audioRef.current.pause();
      const a = new Audio(url);
      audioRef.current = a;
      setPlayingLine(lineIndex);
      a.onended = () => setPlayingLine(null);
      a.onerror = () => { setPlayingLine(null); toast.error("Playback failed"); };
      await a.play();
    } catch (e: any) {
      setPlayingLine(null);
      toast.error(e?.message ?? "Could not play");
    }
  };

  const togglePlayFull = async () => {
    if (!episode.full_audio_url) return;
    if (isPlayingFull && audioRef.current) {
      audioRef.current.pause();
      setIsPlayingFull(false);
      return;
    }
    const a = new Audio(episode.full_audio_url);
    audioRef.current = a;
    a.onended = () => setIsPlayingFull(false);
    a.onerror = () => { setIsPlayingFull(false); toast.error("Playback failed"); };
    setIsPlayingFull(true);
    await a.play();
  };

  const addOneVocab = async (v: { arabic: string; english: string }) => {
    if (addedVocab.has(v.arabic)) return;
    try {
      await addVocab.mutateAsync({
        word_arabic: v.arabic,
        word_english: v.english,
        source: "listen",
        dialect: episode.dialect,
      });
      setAddedVocab((s) => new Set(s).add(v.arabic));
    } catch (e: any) {
      if (String(e?.message).includes("موجودة")) {
        setAddedVocab((s) => new Set(s).add(v.arabic));
      } else {
        toast.error(e?.message ?? "Could not add");
      }
    }
  };

  const addAllVocab = async () => {
    for (const v of episode.key_vocabulary) await addOneVocab(v);
    toast.success("Words added to your deck");
  };

  const confirmDelete = async () => {
    setConfirmDeleteOpen(false);
    await deleteEp.mutateAsync(episode.id);
    navigate("/listen");
  };

  const isOwner = user?.id === episode.creator_id;

  return (
    <AppShell>
      <div className="space-y-5 pb-24">
        <Button variant="ghost" size="sm" onClick={() => navigate("/listen")} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" />Back to library
        </Button>

        <header className="space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <Badge variant="secondary" className="capitalize">{episode.format}</Badge>
            <Badge variant="outline">{episode.dialect}</Badge>
            <Badge variant="outline" className="capitalize">{episode.length_bucket}</Badge>
          </div>
          <h1 className="font-english text-2xl font-bold leading-tight">{episode.title}</h1>
          {episode.summary && <p className="text-sm text-muted-foreground">{episode.summary}</p>}

          {episode.audio_mode === "full" && (
            <div className="pt-2">
              {episode.audio_status === "pending" && (
                <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" />Recording voices…</div>
              )}
              {episode.audio_status === "failed" && (
                <p className="text-sm text-destructive">Audio failed — you can still play each line on tap.</p>
              )}
              {episode.full_audio_url && (
                <Button onClick={togglePlayFull} size="lg" className="w-full">
                  {isPlayingFull ? <><Pause className="h-4 w-4 mr-2" />Pause episode</> : <><Play className="h-4 w-4 mr-2" />Play full episode</>}
                </Button>
              )}
            </div>
          )}
        </header>

        <section className="space-y-3">
          {episode.script.map((line, i) => (
            <Card key={i} className="p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                  {line.speaker}
                </span>
                <div className="flex items-center gap-1 shrink-0">

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => playLine(i)}
                    disabled={lineAudio.isPending && playingLine !== i}
                    aria-label="Play line"
                  >
                    {playingLine === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="font-english text-base leading-relaxed">
                <TappableEnglishText
                  text={line.english ?? ""}
                  sentenceArabic={line.arabic}
                  source="listen"
                />
              </p>
              {showEnglish && line.arabic && (
                <div className="space-y-1">
                  <p dir="rtl" className="font-arabic text-sm text-muted-foreground">{line.arabic}</p>
                  {line.literal && (
                    <p dir="rtl" className="font-arabic text-xs text-muted-foreground/80">{line.literal}</p>
                  )}
                </div>
              )}
            </Card>
          ))}
        </section>

        {episode.key_vocabulary.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Key vocabulary</h2>
              <Button size="sm" variant="outline" onClick={addAllVocab}><Plus className="h-3.5 w-3.5 mr-1" />Add all to My Words</Button>
            </div>
            <div className="space-y-1.5">
              {episode.key_vocabulary.map((v) => {
                const added = addedVocab.has(v.arabic);
                return (
                  <Card key={v.arabic} className="p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-english font-semibold">{v.english}</p>
                      <p dir="rtl" className="font-arabic text-xs text-muted-foreground">{v.arabic}{v.note ? ` — ${v.note}` : ""}</p>
                    </div>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => addOneVocab(v)} disabled={added}>
                      {added ? <Check className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {isOwner && (
          <div className="pt-4">
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />Delete episode
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this episode?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the episode. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default ListenEpisode;
