import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "user-token" } } })) },
  },
}));

import { clearEnglishSpeechCache, englishSpeechUrl } from "./englishSpeech";

describe("englishSpeechUrl", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearEnglishSpeechCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(new Blob(["mp3"], { type: "audio/mpeg" })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the English voice for the trimmed phrase, as the signed-in learner", async () => {
    await englishSpeechUrl("  park  ");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/elevenlabs-tts$/);
    expect(JSON.parse(init.body)).toEqual({ text: "park" });
    expect(init.headers.Authorization).toBe("Bearer user-token");
  });

  it("fetches each phrase once", async () => {
    const first = await englishSpeechUrl("park");
    const second = await englishSpeechUrl("park");

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails loudly on a refused request rather than playing nothing", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(englishSpeechUrl("park")).rejects.toThrow("elevenlabs-tts 500");
  });

  it("refuses an empty phrase without calling anything", async () => {
    await expect(englishSpeechUrl("   ")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
