import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyMedia, uploadAnkiMedia, uploadAnkiMediaBatch } from "./uploadMedia";
import { supabase } from "@/integrations/supabase/client";

/**
 * Re-hosting the images and audio that came inside an `.apkg`.
 *
 * An Anki package carries its media as numbered files with no extension in the
 * archive and a manifest mapping them back to filenames. Those bytes have to be
 * uploaded before any card can reference them, and the two buckets are
 * separate, so a file classified as the wrong kind lands somewhere the reader
 * never looks — the card renders with a broken image and no error.
 *
 * A single deck can carry thousands of files, so the batch runs with bounded
 * concurrency: unbounded would open a request per file and get most of them
 * rate-limited.
 */

vi.mock("@/integrations/supabase/client", () => {
  const upload = vi.fn(async () => ({ error: null }));
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://cdn.test/${path}` },
  }));
  return {
    supabase: {
      storage: {
        from: vi.fn(() => ({ upload, getPublicUrl })),
      },
      __upload: upload,
      __getPublicUrl: getPublicUrl,
    },
  };
});

const store = supabase as unknown as {
  storage: { from: ReturnType<typeof vi.fn> };
  __upload: ReturnType<typeof vi.fn>;
  __getPublicUrl: ReturnType<typeof vi.fn>;
};

const bytes = () => new Uint8Array([1, 2, 3, 4]);

/** The bucket name the last upload went to. */
const lastBucket = () => store.storage.from.mock.calls.at(-2)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  store.__upload.mockResolvedValue({ error: null });
});

describe("classifying a file", () => {
  it("recognises the image extensions", () => {
    for (const name of ["a.jpg", "a.jpeg", "a.png", "a.gif", "a.webp", "a.svg", "a.bmp", "a.avif"]) {
      expect(classifyMedia(name), name).toBe("image");
    }
  });

  it("recognises the audio extensions", () => {
    for (const name of ["a.mp3", "a.m4a", "a.ogg", "a.oga", "a.wav", "a.flac", "a.aac", "a.opus"]) {
      expect(classifyMedia(name), name).toBe("audio");
    }
  });

  it("ignores case", () => {
    // Anki decks from Windows are full of .JPG and .MP3.
    expect(classifyMedia("PHOTO.JPG")).toBe("image");
    expect(classifyMedia("Sound.MP3")).toBe("audio");
  });

  it("matches only at the end of the name", () => {
    // A file called "mp3-player.txt" is not audio.
    expect(classifyMedia("mp3-player.txt")).toBeNull();
  });

  it("returns null for anything it does not handle", () => {
    for (const name of ["notes.txt", "deck.apkg", "readme", "video.mp4"]) {
      expect(classifyMedia(name), name).toBeNull();
    }
  });

  it("calls a .webm audio rather than video", () => {
    // Pinned. WebM is a container that carries either. Anki uses it for audio,
    // and the audio branch is checked second — but the image regex does not
    // list it, so it lands as audio. A deck with WebM *video* would be
    // uploaded into the audio bucket and play as sound only.
    expect(classifyMedia("clip.webm")).toBe("audio");
  });
});

describe("uploading one file", () => {
  it("puts an image in the image bucket and returns its URL", async () => {
    const result = await uploadAnkiMedia("user-1", "photo.png", bytes());

    expect(lastBucket()).toBe("flashcard-images");
    expect(result?.kind).toBe("image");
    expect(result?.url).toMatch(/^https:\/\/cdn\.test\/anki-import\/user-1\//);
  });

  it("puts audio in the audio bucket", async () => {
    const result = await uploadAnkiMedia("user-1", "word.mp3", bytes());

    expect(lastBucket()).toBe("flashcard-audio");
    expect(result?.kind).toBe("audio");
  });

  it("scopes the path to the learner", async () => {
    await uploadAnkiMedia("user-1", "photo.png", bytes());

    // Storage policies key on this prefix; a flat namespace would let one
    // learner's import overwrite another's.
    expect(store.__upload.mock.calls[0][0]).toMatch(/^anki-import\/user-1\//);
  });

  it("renames the file rather than trusting the deck's name", async () => {
    await uploadAnkiMedia("user-1", "../../etc/passwd.png", bytes());

    const path = store.__upload.mock.calls[0][0] as string;

    // Deck filenames are attacker-controlled in a shared deck. Only the
    // extension survives.
    expect(path).not.toContain("passwd");
    expect(path).not.toContain("..");
    expect(path.endsWith(".png")).toBe(true);
  });

  it("gives two files with the same name different paths", async () => {
    await uploadAnkiMedia("user-1", "photo.png", bytes());
    await uploadAnkiMedia("user-1", "photo.png", bytes());

    // Anki reuses filenames across decks; colliding would silently replace one
    // card's image with another's.
    expect(store.__upload.mock.calls[0][0]).not.toBe(store.__upload.mock.calls[1][0]);
  });

  it("refuses to overwrite an existing object", async () => {
    await uploadAnkiMedia("user-1", "photo.png", bytes());

    expect(store.__upload.mock.calls[0][2]).toMatchObject({ upsert: false });
  });

  it("sends a content type the browser will render", async () => {
    await uploadAnkiMedia("user-1", "photo.png", bytes());
    expect(store.__upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png" });

    await uploadAnkiMedia("user-1", "word.mp3", bytes());
    // Served without one, storage falls back to octet-stream and the browser
    // downloads the file instead of playing it.
    expect(store.__upload.mock.calls[1][2]).toMatchObject({ contentType: "audio/mpeg" });
  });

  it("falls back to a generic content type for an unmapped extension", async () => {
    await uploadAnkiMedia("user-1", "sound.aac", bytes());
    expect(store.__upload.mock.calls[0][2]).toMatchObject({ contentType: "audio/aac" });
  });

  it("skips a file it cannot classify without calling storage", async () => {
    const result = await uploadAnkiMedia("user-1", "notes.txt", bytes());

    expect(result).toBeNull();
    expect(store.__upload).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the upload is rejected", async () => {
    store.__upload.mockResolvedValue({ error: { message: "Payload too large" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await uploadAnkiMedia("user-1", "photo.png", bytes());

    // One oversized image must not abandon an import of ten thousand cards;
    // the card simply arrives without its picture.
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe("uploading a batch", () => {
  const files = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ filename: `photo${i}.png`, bytes: bytes() }));

  it("returns a map keyed by the deck's own filename", async () => {
    const result = await uploadAnkiMediaBatch("user-1", files(3));

    // The cards reference the original names, so that is what the map has to
    // be keyed on rather than the uploaded path.
    expect([...result.keys()]).toEqual(["photo0.png", "photo1.png", "photo2.png"]);
    expect(result.get("photo0.png")?.kind).toBe("image");
  });

  it("uploads every file", async () => {
    await uploadAnkiMediaBatch("user-1", files(10));

    expect(store.__upload).toHaveBeenCalledTimes(10);
  });

  it("leaves out the files that failed", async () => {
    store.__upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "nope" } })
      .mockResolvedValue({ error: null });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await uploadAnkiMediaBatch("user-1", files(3), { concurrency: 1 });

    expect(result.size).toBe(2);
    expect(result.has("photo1.png")).toBe(false);
  });

  it("leaves out files it could not classify", async () => {
    const result = await uploadAnkiMediaBatch("user-1", [
      { filename: "photo.png", bytes: bytes() },
      { filename: "notes.txt", bytes: bytes() },
    ]);

    expect(result.size).toBe(1);
  });

  it("reports progress once per file", async () => {
    const onProgress = vi.fn();

    await uploadAnkiMediaBatch("user-1", files(5), { onProgress });

    // The import dialog shows a bar; a count that skips failures would stall
    // short of the end.
    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenLastCalledWith(5, 5);
  });

  it("counts a failed file as progress too", async () => {
    store.__upload.mockResolvedValue({ error: { message: "nope" } });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onProgress = vi.fn();

    await uploadAnkiMediaBatch("user-1", files(3), { onProgress });

    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it("bounds how many uploads are in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    store.__upload.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { error: null };
    });

    await uploadAnkiMediaBatch("user-1", files(20), { concurrency: 3 });

    // Unbounded, a deck of a few thousand files opens a request each and most
    // come back rate-limited.
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("treats a concurrency of zero as one rather than stalling", async () => {
    const result = await uploadAnkiMediaBatch("user-1", files(2), { concurrency: 0 });

    // Zero workers would resolve immediately having uploaded nothing.
    expect(result.size).toBe(2);
  });

  it("returns an empty map for an empty deck", async () => {
    const result = await uploadAnkiMediaBatch("user-1", []);

    expect(result.size).toBe(0);
    expect(store.__upload).not.toHaveBeenCalled();
  });
});
