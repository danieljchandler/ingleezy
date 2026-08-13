/**
 * ClipSourcePlayer — plays a native-speaker clip from either:
 *   - YouTube (via IFrame API, seek + stop-at-end)
 *   - Direct audio URL (HTMLAudioElement)
 *
 * Exposes an imperative handle: play(rate), pause(). Calls onEnded when the
 * clip naturally reaches its end timestamp (NOT when paused manually).
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ShadowClip } from "@/hooks/useShadowQueue";
import { loadYouTubeIframeAPI } from "@/lib/youtubeIframeApi";

export interface ClipSourcePlayerHandle {
  /** Resolves true once playback actually started, false if the clip could not be played (e.g. player never became ready). */
  play: (rate?: number) => Promise<boolean>;
  pause: () => void;
  isReady: () => boolean;
}

/**
 * Lets a caller drive an ALREADY-EXISTING, already-engaged YouTube player
 * (e.g. a page's main video) instead of ClipSourcePlayer spinning up its own
 * fresh iframe. Browsers gate unmuted autoplay on a cross-origin iframe
 * behind that origin having established engagement on the page — a brand
 * new hidden iframe created just for shadowing has none, so its first
 * programmatic playVideo() is silently blocked until some other YouTube
 * embed on the page has already played. Reusing the main player sidesteps
 * that entirely since it's already proven to play.
 */
export interface ExternalYouTubeController {
  /** Seek to startSec, play at rate, and invoke onEnded once endSec is reached. Resolves true if playback started. */
  play: (startSec: number, endSec: number, rate: number, onEnded: () => void) => Promise<boolean>;
  pause: () => void;
}

interface Props {
  clip: ShadowClip;
  onEnded: () => void;
  onError?: (msg: string) => void;
  className?: string;
  /** When set and clip.source === "youtube", drive this instead of creating a new iframe. */
  externalYouTubeController?: ExternalYouTubeController | null;
}

interface YTPlayer {
  seekTo: (s: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState?: () => number;
  setPlaybackRate: (r: number) => void;
  destroy: () => void;
}

export const ClipSourcePlayer = forwardRef<ClipSourcePlayerHandle, Props>(
  ({ clip, onEnded, onError, className, externalYouTubeController }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const ytPlayerRef = useRef<YTPlayer | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const endedCalledRef = useRef(false);
    const usesExternalYouTube = clip.source === "youtube" && !!externalYouTubeController;
    const [ready, setReady] = useState(clip.source === "audio" || usesExternalYouTube);
    // Resolves once the YT player fires onReady (or null if it never will — cancelled/failed).
    // play() awaits this instead of assuming ytPlayerRef is already populated.
    const readyPromiseRef = useRef<Promise<YTPlayer | null> | null>(null);

    // Reset endedCalled when clip changes
    useEffect(() => {
      endedCalledRef.current = false;
    }, [clip.id]);

    // Mount YouTube player — skipped when an external controller drives an existing player instead.
    useEffect(() => {
      if (clip.source !== "youtube" || !clip.youtubeId || usesExternalYouTube) return;
      let cancelled = false;
      let player: YTPlayer | null = null;
      let resolveReady: (p: YTPlayer | null) => void;
      readyPromiseRef.current = new Promise<YTPlayer | null>((resolve) => {
        resolveReady = resolve;
      });
      loadYouTubeIframeAPI().then(() => {
        if (cancelled || !containerRef.current) {
          resolveReady(null);
          return;
        }
        const YT = (window as unknown as { YT: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer } }).YT;
        const div = document.createElement("div");
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(div);
        player = new YT.Player(div, {
          videoId: clip.youtubeId,
          width: "100%",
          height: "100%",
          playerVars: { controls: 0, modestbranding: 1, rel: 0, playsinline: 1, disablekb: 1, fs: 0 },
          events: {
            onReady: () => {
              ytPlayerRef.current = player;
              setReady(true);
              resolveReady(player);
            },
            onError: () => {
              onError?.("Video failed to load");
              resolveReady(null);
            },
          },
        });
      });
      return () => {
        cancelled = true;
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        try {
          player?.destroy();
        } catch {
          /* ignore */
        }
        ytPlayerRef.current = null;
        readyPromiseRef.current = null;
        setReady(false);
      };
    }, [clip.id, clip.youtubeId, clip.source, onError, usesExternalYouTube]);

    useImperativeHandle(ref, () => ({
      isReady: () => {
        if (clip.source === "youtube") return usesExternalYouTube ? true : !!ytPlayerRef.current && ready;
        return !!audioRef.current;
      },
      play: async (rate = 1) => {
        endedCalledRef.current = false;
        if (clip.source === "youtube" && externalYouTubeController) {
          return externalYouTubeController.play(clip.startSec, clip.endSec, rate, () => {
            if (!endedCalledRef.current) {
              endedCalledRef.current = true;
              onEnded();
            }
          });
        }
        if (clip.source === "youtube") {
          let p = ytPlayerRef.current;
          if (!p) {
            const waitPromise = readyPromiseRef.current;
            if (!waitPromise) {
              onError?.("Video isn't loaded yet — try again.");
              return false;
            }
            const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
            p = await Promise.race([waitPromise, timeout]);
            if (!p) {
              onError?.("Video is taking too long to load — try again.");
              return false;
            }
          }
          const player = p;
          player.seekTo(clip.startSec, true);
          try {
            player.setPlaybackRate(rate);
          } catch {
            /* not all rates supported */
          }
          player.playVideo();
          if (pollRef.current) clearInterval(pollRef.current);

          // Confirm playback actually STARTED before reporting success; if the
          // browser blocks autoplay (fresh iframe with no engagement), resolve
          // false within the watchdog window so the UI recovers instead of
          // hanging forever on "Listening…".
          return await new Promise<boolean>((resolve) => {
            const startedAt = Date.now();
            let confirmed = false;
            let lastCur = -1;
            let settled = false;
            const settle = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
            pollRef.current = setInterval(() => {
              const cur = player.getCurrentTime();
              if (!confirmed) {
                const advancing = lastCur >= 0 && cur > lastCur + 0.01;
                const isPlaying = player.getPlayerState?.() === 1; // YT.PlayerState.PLAYING
                if ((isPlaying || advancing) && cur >= clip.startSec - 0.3 && cur < clip.endSec) {
                  confirmed = true;
                  settle(true);
                } else if (Date.now() - startedAt > 5000) {
                  if (pollRef.current) clearInterval(pollRef.current);
                  pollRef.current = null;
                  try { player.pauseVideo(); } catch { /* ignore */ }
                  onError?.("Couldn't play the clip — tap Listen to try again.");
                  settle(false);
                  return;
                }
              }
              lastCur = cur;
              if (confirmed && cur >= clip.endSec - 0.05) {
                player.pauseVideo();
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                if (!endedCalledRef.current) {
                  endedCalledRef.current = true;
                  onEnded();
                }
              }
            }, 100);
          });
        } else {
          const a = audioRef.current;
          if (!a) {
            onError?.("Audio isn't loaded yet — try again.");
            return false;
          }
          a.playbackRate = rate;
          a.currentTime = clip.startSec;
          const finish = () => {
            a.pause();
            a.removeEventListener("timeupdate", onTime);
            a.removeEventListener("ended", finish);
            if (!endedCalledRef.current) {
              endedCalledRef.current = true;
              onEnded();
            }
          };
          const onTime = () => {
            if (a.currentTime >= clip.endSec - 0.05) finish();
          };
          a.addEventListener("timeupdate", onTime);
          // Safety net: if the clip's end timestamp overruns the file's actual
          // duration, timeupdate never crosses endSec — the natural "ended"
          // event still advances us to recording instead of hanging.
          a.addEventListener("ended", finish);
          try {
            await a.play();
            return true;
          } catch (e) {
            a.removeEventListener("timeupdate", onTime);
            a.removeEventListener("ended", finish);
            onError?.(e instanceof Error ? e.message : "Audio playback failed");
            return false;
          }
        }
      },
      pause: () => {
        if (clip.source === "youtube") {
          if (externalYouTubeController) {
            externalYouTubeController.pause();
            return;
          }
          ytPlayerRef.current?.pauseVideo();
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        } else {
          audioRef.current?.pause();
        }
      },
    }), [clip, ready, onEnded, onError, externalYouTubeController, usesExternalYouTube]);

    if (clip.source === "audio") {
      return (
        <div className={className}>
          <audio ref={audioRef} src={clip.audioUrl} preload="auto" />
        </div>
      );
    }
    if (usesExternalYouTube) return null;
    return <div ref={containerRef} className={className} />;
  }
);
ClipSourcePlayer.displayName = "ClipSourcePlayer";
