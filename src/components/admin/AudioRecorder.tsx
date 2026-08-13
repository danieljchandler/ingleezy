import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Mic, Square, Play, Pause, RotateCcw, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AudioRecorderProps {
  onSave: (url: string) => void;
  onCancel: () => void;
}

export const AudioRecorder = ({ onSave, onCancel }: AudioRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
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
        mimeType: 'audio/webm;codecs=opus'
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
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setRecordedBlob(null);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Microphone access denied',
        description: 'Please allow microphone access to record audio.',
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
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
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setPlaybackTime(0);
      };
      audioRef.current.ontimeupdate = () => {
        setPlaybackTime(Math.floor(audioRef.current?.currentTime || 0));
      };
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const resetRecording = () => {
    setRecordedBlob(null);
    setDuration(0);
    setPlaybackTime(0);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
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

      const { data: { publicUrl } } = supabase.storage
        .from('flashcard-audio')
        .getPublicUrl(fileName);

      onSave(publicUrl);
      toast({ title: 'Recording saved!' });
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
    <div className="space-y-4 p-4 rounded-xl bg-muted border-2 border-primary/20">
      {/* Recording controls */}
      {!recordedBlob ? (
        <div className="flex flex-col items-center gap-4">
          <div className="text-4xl font-mono tabular-nums">
            {formatTime(duration)}
          </div>
          
          <div className="flex items-center gap-3">
            {!isRecording ? (
              <Button
                type="button"
                size="lg"
                onClick={startRecording}
                className="rounded-full h-16 w-16"
              >
                <Mic className="h-6 w-6" />
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                variant="destructive"
                onClick={stopRecording}
                className="rounded-full h-16 w-16 animate-pulse"
              >
                <Square className="h-6 w-6" />
              </Button>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            {isRecording ? 'Recording... Click to stop' : 'Click to start recording'}
          </p>

          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {/* Playback display */}
          <div className="text-4xl font-mono tabular-nums">
            {formatTime(isPlaying ? playbackTime : duration)}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={togglePlayback}
              className="h-12 w-12 rounded-full"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>

            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={resetRecording}
              className="h-12 w-12 rounded-full"
            >
              <RotateCcw className="h-5 w-5" />
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Preview your recording before saving
          </p>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveRecording}
              disabled={uploading}
              className="gap-2"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save Recording
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
