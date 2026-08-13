import { describe, expect, it } from "vitest";
import { extractTikTokVideoId, getTikTokEmbedUrl, parseVideoUrl } from "./videoEmbed";

describe("TikTok URL helpers", () => {
  it("normalizes full TikTok URL to player embed", () => {
    const url = "https://www.tiktok.com/@creator/video/7451234567890123456";
    expect(getTikTokEmbedUrl(url)).toBe("https://www.tiktok.com/player/v1/7451234567890123456");
  });

  it("extracts video ID from player URL", () => {
    const url = "https://www.tiktok.com/player/v1/7451234567890123456?autoplay=1";
    expect(extractTikTokVideoId(url)).toBe("7451234567890123456");
  });

  it("extracts video ID from item_id query params", () => {
    const url = "https://www.tiktok.com/share/video/?item_id=7451234567890123456";
    expect(extractTikTokVideoId(url)).toBe("7451234567890123456");
  });

  it("parses TikTok full URLs as player embed", () => {
    const parsed = parseVideoUrl("https://www.tiktok.com/@creator/video/7451234567890123456");
    expect(parsed).toEqual({
      platform: "tiktok",
      videoId: "7451234567890123456",
      embedUrl: "https://www.tiktok.com/player/v1/7451234567890123456",
    });
  });
});
