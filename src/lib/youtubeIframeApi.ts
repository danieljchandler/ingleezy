/**
 * Shared singleton loader for the YouTube IFrame API.
 *
 * window.onYouTubeIframeAPIReady is a single global callback — if more than
 * one component sets it independently, the last one to register wins and
 * the other never finds out the API is ready (its player is never created,
 * so anything waiting on it hangs forever). Route every YouTube player
 * through this one loader instead of touching the global directly.
 */
let readyPromise: Promise<void> | null = null;

export function loadYouTubeIframeAPI(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT && w.YT.Player) return resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    w.onYouTubeIframeAPIReady = () => resolve();
  });
  return readyPromise;
}
