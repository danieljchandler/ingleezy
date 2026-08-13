import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioPlayerResult {
  /** True while audio is playing. */
  isPlaying: boolean;
  /** Play the given URL.  If already playing it restarts. */
  play: (url: string) => void;
  /** Stop playback and reset state. */
  stop: () => void;
}

/**
 * Hook that manages the lifecycle of a single Audio instance.
 *
 * - Only one sound plays at a time; calling `play()` again stops the previous.
 * - The Audio element is cleaned up (paused, handlers removed) on unmount so
 *   there are no leaked resources when the user navigates away.
 *
 * Usage:
 *   const { isPlaying, play, stop } = useAudioPlayer();
 *   <button onClick={() => play(audioUrl)}>🔊</button>
 */
export function useAudioPlayer(): UseAudioPlayerResult {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
  }, []);

  const play = useCallback(
    (url: string) => {
      cleanup();
      setIsPlaying(true);

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => setIsPlaying(false);
      audio.play().catch(() => setIsPlaying(false));
    },
    [cleanup],
  );

  const stop = useCallback(() => {
    cleanup();
    setIsPlaying(false);
  }, [cleanup]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { isPlaying, play, stop };
}
