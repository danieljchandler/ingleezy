export type VideoFrame = {
  dataUri: string;
  timestampSeconds: number;
};

/**
 * Extract frames from a video at regular intervals, each with its timestamp.
 *
 * @param source   File object or blob URL string
 * @param intervalSeconds  Seconds between frames (default 4)
 * @param maxFrames        Cap on total frames extracted (default 20)
 * @param maxDimension     Max width/height in pixels, aspect-ratio preserved (default 768)
 */
export async function extractFramesWithTimestamps(
  source: File | string,
  intervalSeconds = 4,
  maxFrames = 20,
  maxDimension = 768,
): Promise<VideoFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const needsRevoke = typeof source !== 'string';
    video.src = url;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration === 0) {
        if (needsRevoke) URL.revokeObjectURL(url);
        reject(new Error('Could not determine video duration'));
        return;
      }

      const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d')!;

      // Build list of timestamps to sample. Meme captions are often only on
      // the opening/closing frames, so include near-start and near-end samples
      // instead of only interior points.
      const frameCount = Math.min(
        Math.max(Math.ceil(duration / intervalSeconds) + 1, duration > 2 ? 3 : 1),
        maxFrames,
      );

      const timestamps: number[] = [];
      if (frameCount === 1) {
        timestamps.push(Math.max(0, Math.min(duration / 2, duration - 0.05)));
      } else {
        const start = Math.min(0.25, Math.max(0, duration / 10));
        const end = Math.max(start, duration - Math.min(0.25, duration / 10));
        const step = (end - start) / (frameCount - 1);
        for (let i = 0; i < frameCount; i++) {
          timestamps.push(Math.max(0, Math.min(duration - 0.05, start + step * i)));
        }
      }

      const seekToTime = (time: number): Promise<void> =>
        new Promise((res) => {
          video.currentTime = time;
          video.onseeked = () => res();
        });

      const frames: VideoFrame[] = [];
      try {
        for (const ts of timestamps) {
          await seekToTime(ts);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frames.push({
            dataUri: canvas.toDataURL('image/jpeg', 0.88),
            timestampSeconds: Math.round(ts * 10) / 10,
          });
        }
        if (needsRevoke) URL.revokeObjectURL(url);
        resolve(frames);
      } catch (e) {
        if (needsRevoke) URL.revokeObjectURL(url);
        reject(e);
      }
    };

    video.onerror = () => {
      if (needsRevoke) URL.revokeObjectURL(url);
      reject(new Error('Failed to load video for frame extraction'));
    };
  });
}
