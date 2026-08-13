import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Mic, Square, Play, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface InlineAudioRecorderProps {
  onSave: (url: string) => void;
  onCancel: () => void;
}

export const InlineAudioRecorder = ({ onSave, onCancel }: InlineAudioRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [duration, setDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    // Auto-start recording when mounted
    startRecording();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordedBlob(null);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Microphone access denied',
        description: 'Please allow microphone access to record audio.',
      });
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const togglePlayback = () => {
    if (!recordedBlob) return;

    if (!audioRef.current) {
      const url = URL.createObjectURL(recordedBlob);
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setIsPlaying(false);
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const saveRecording = async () => {
    if (!recordedBlob) return;

    setUploading(true);
    try {
      const fileName = `${crypto.randomUUID()}.webm`;

      const { error: uploadError } = await supabase.storage
        .from('flashcard-audio')
        .upload(fileName, recordedBlob, {
          contentType: 'audio/webm',
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('flashcard-audio').getPublicUrl(fileName);

      onSave(publicUrl);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted border">
      {!recordedBlob ? (
        <>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-mono">{formatTime(duration)}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={stopRecording}
            className="h-7 px-2"
          >
            <Square className="h-3 w-3 mr-1" />
            Stop
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 px-2"
          >
            <X className="h-3 w-3" />
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm font-mono text-muted-foreground">
            {formatTime(duration)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={togglePlayback}
            className="h-7 w-7 p-0"
          >
            <Play className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRecordedBlob(null);
              startRecording();
            }}
            className="h-7 px-2"
          >
            <Mic className="h-3 w-3 mr-1" />
            Redo
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={saveRecording}
            disabled={uploading}
            className="h-7 px-2"
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Check className="h-3 w-3 mr-1" />
                Save
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 px-2"
          >
            <X className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
};
