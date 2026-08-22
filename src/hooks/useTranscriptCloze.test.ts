import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aDiscoverVideo,
  aSavedTranscription,
  transcriptionId,
  videoId,
} from "@/test/support/factories";
import { useTranscriptCloze } from "./useTranscriptCloze";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Minting a cloze sentence from content the learner has met.
 *
 * A cloze card is far more use when the sentence is a real one, so this scans
 * the learner's own transcriptions and the published English library for the
 * target word and offers the best sentence it finds. Nothing about it is
 * visible when it fails — the card simply does not appear — so a matcher that
 * quietly stops finding anything would go unnoticed indefinitely.
 *
 * It searches ENGLISH now. Before the flip it searched the Arabic side, which
 * was right when Arabic was the studied language and became the wrong card
 * entirely once the blank moved to the English word; it was disabled outright
 * rather than half-flipped, and stayed off until `process-english-video` gave
 * the database English transcript lines to search.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(
  params: { wordEnglish?: string | null; dialect?: string; enabled?: boolean },
  seed?: (backend: SupabaseBackend) => void,
) {
  const harness = renderHookWithProviders(
    () =>
      useTranscriptCloze({
        wordEnglish: params.wordEnglish === undefined ? "market" : params.wordEnglish,
        dialect: params.dialect ?? "Gulf",
        enabled: params.enabled,
      }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

const aLine = (english: string, over: Record<string, unknown> = {}) => ({
  id: "l1",
  english,
  arabic: "السوق مزدحم اليوم",
  translation: "the market is busy today",
  startMs: 0,
  endMs: 2000,
  ...over,
});

/** Seed the learner's own transcriptions, and nothing in the shared library. */
const withUploads = (...rows: Array<{ lines: unknown[]; title?: string }>) =>
  (backend: SupabaseBackend) => {
    backend.db.seed("discover_videos", []);
    backend.db.seed(
      "saved_transcriptions",
      rows.map((row, index) =>
        aSavedTranscription({
          id: transcriptionId(index),
          title: row.title ?? `Transcription ${index}`,
          lines: row.lines,
        }),
      ),
    );
  };

/** Seed the shared library, and no uploads of the learner's own. */
const withLibrary = (
  ...rows: Array<{ lines: unknown[]; title?: string; dialect?: string | null }>
) =>
  (backend: SupabaseBackend) => {
    backend.db.seed("saved_transcriptions", []);
    backend.db.seed(
      "discover_videos",
      rows.map((row, index) =>
        aDiscoverVideo({
          id: videoId(index),
          title: row.title ?? `Clip ${index}`,
          dialect: row.dialect === undefined ? "Gulf" : row.dialect,
          transcript_lines: row.lines,
        }),
      ),
    );
  };

describe("finding a sentence", () => {
  it("returns the English line containing the word, with its scaffold", async () => {
    const { result } = render({}, withUploads({ lines: [aLine("I go to the market on Fridays")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The English is what gets blanked; the Arabic is what is revealed after
    // the learner answers. Returning them the other way round is the whole
    // failure this flip was for.
    expect(result.current.data).toMatchObject({
      english: "I go to the market on Fridays",
      arabic: "السوق مزدحم اليوم",
      sourceTitle: "Transcription 0",
      origin: "upload",
    });
  });

  it("falls back to the line translation when there is no dialect scaffold", async () => {
    const { result } = render(
      {},
      withUploads({ lines: [aLine("I go to the market on Fridays", { arabic: undefined })] }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.arabic).toBe("the market is busy today");
  });

  it("carries the timings so the clip can be played", async () => {
    const { result } = render(
      {},
      withUploads({
        lines: [aLine("I go to the market on Fridays", { startMs: 4000, endMs: 7000 })],
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Without them the cloze is text only, which loses the reason for
    // preferring the learner's own audio in the first place.
    expect(result.current.data).toMatchObject({ startMs: 4000, endMs: 7000 });
  });

  it("returns null when the word appears nowhere", async () => {
    const { result } = render({}, withUploads({ lines: [aLine("I go to the shop on Fridays")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns null when there is no content at all", async () => {
    const { result } = render({}, (backend) => {
      backend.db.seed("saved_transcriptions", []);
      backend.db.seed("discover_videos", []);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("ignores a bridged Arabic line, which has no English at all", async () => {
    const { result } = render(
      {},
      withLibrary({
        lines: [{ id: "l1", arabic: "أنا أروح السوق", translation: "I go to the market" }],
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Hakiya-bridged clips are Arabic speech. The English translation beside
    // the line is not a sentence the learner heard, so blanking a word out of
    // it would present a translation as if it were the source.
    expect(result.current.data).toBeNull();
  });
});

describe("the word boundary", () => {
  it("matches a word at the start of a sentence, whatever its case", async () => {
    const { result } = render({}, withUploads({ lines: [aLine("Market day is the busiest")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Case-insensitive on purpose, and it has to be: `ReviewClozeCard` builds
    // its blank case-insensitively too, so a sensitive match here would hand
    // the card a sentence it then could not find the word in — a cloze with
    // nothing blanked out.
    expect(result.current.data).not.toBeNull();
  });

  it("matches a word at the end of a sentence", async () => {
    const { result } = render({}, withUploads({ lines: [aLine("On Friday we go to the market")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
  });

  it("matches a word followed by punctuation", async () => {
    const { result } = render({}, withUploads({ lines: [aLine("Are we going to the market?")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
  });

  it("does not match the word inside a longer one", async () => {
    const { result } = render(
      {},
      withUploads({ lines: [aLine("The supermarket near us is open late")] }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not match an inflected form", async () => {
    const { result } = render(
      {},
      withUploads({ lines: [aLine("The markets are open late on Fridays")] }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Pinned, not fixed, and it is the English-side cost of the boundary rule
    // — the Arabic version had the mirror problem with the attached ال. A
    // learner saving "market" gets no cloze from a line that only ever says
    // "markets". Stemming would fix it and would also start matching words
    // that merely share a prefix, which is the worse failure: a cloze whose
    // blank is not the word being tested.
    expect(result.current.data).toBeNull();
  });
});

describe("choosing between candidates", () => {
  it("prefers the learner's own audio over the shared library", async () => {
    const { result } = render({}, (backend) => {
      backend.db.seed("saved_transcriptions", [
        aSavedTranscription({
          title: "My own recording",
          lines: [aLine("I walk to the market every single Friday morning with my brother")],
        }),
      ]);
      backend.db.seed("discover_videos", [
        aDiscoverVideo({ title: "A clip", transcript_lines: [aLine("The market is busy")] }),
      ]);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Even though the library sentence is shorter. A sentence the learner
    // recorded is one they have already heard, which is worth more than
    // brevity — length only decides between candidates of the same origin.
    expect(result.current.data).toMatchObject({
      origin: "upload",
      sourceTitle: "My own recording",
    });
  });

  it("uses the library when the learner has no transcriptions", async () => {
    const { result } = render({}, withLibrary({ lines: [aLine("The market is busy")], title: "A clip" }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The reason the library is a source at all: a learner who has never
    // opened the transcriber would otherwise never see a cloze card.
    expect(result.current.data).toMatchObject({ origin: "library", sourceTitle: "A clip" });
  });

  it("prefers the shortest sentence", async () => {
    const { result } = render(
      {},
      withUploads({
        lines: [
          aLine("I always walk down to the market on Friday morning with my older brother"),
          aLine("We visit the market weekly", { id: "l2" }),
        ],
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A cloze is a fill-in-the-blank; a long sentence buries the gap.
    expect(result.current.data?.english).toBe("We visit the market weekly");
  });

  it("skips a sentence too short to give any context", async () => {
    const { result } = render(
      {},
      withUploads({
        lines: [aLine("Market now"), aLine("We visit the market weekly", { id: "l2" })],
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Under three words there is nothing left once the target is blanked.
    expect(result.current.data?.english).toBe("We visit the market weekly");
  });

  it("skips a sentence too long to read as a card", async () => {
    const long = ["market", ...Array.from({ length: 25 }, (_, i) => `word${i}`)].join(" ");
    const { result } = render({}, withUploads({ lines: [aLine(long)] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("looks across every transcription, not just the newest", async () => {
    const { result } = render(
      {},
      withUploads(
        { lines: [aLine("I go to the shop on Fridays")], title: "No match here" },
        { lines: [aLine("We visit the market weekly")], title: "The one with it" },
      ),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sourceTitle).toBe("The one with it");
  });
});

describe("dialect", () => {
  it("skips a library clip tagged for another dialect", async () => {
    const { result } = render(
      { dialect: "Gulf" },
      withLibrary({ lines: [aLine("We visit the market weekly")], dialect: "Egyptian" }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The English would have been fine; the scaffold revealed underneath it
    // would not, and that is the half the learner reads to understand.
    expect(result.current.data).toBeNull();
  });

  it("accepts a Gulf clip tagged with the country it was detected as", async () => {
    const { result } = render(
      { dialect: "Gulf" },
      withLibrary({ lines: [aLine("We visit the market weekly")], dialect: "Kuwaiti" }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The analysis pipeline stores the specific Gulf country rather than the
    // module name, so a bare equality check loses most of the Gulf library.
    expect(result.current.data).not.toBeNull();
  });

  it("uses an untagged clip for any dialect", async () => {
    const { result } = render(
      { dialect: "Gulf" },
      withLibrary({ lines: [aLine("We visit the market weekly")], dialect: null }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
  });
});

describe("when not to run at all", () => {
  it("does not query without a word", async () => {
    const { result } = render(
      { wordEnglish: null },
      withUploads({ lines: [aLine("We visit the market weekly")] }),
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("treats a whitespace-only word as no word", async () => {
    const { result } = render(
      { wordEnglish: "   " },
      withUploads({ lines: [aLine("We visit the market weekly")] }),
    );

    // Otherwise the empty pattern would match the first sentence in the corpus.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("does not query when disabled", async () => {
    const { result } = render(
      { enabled: false },
      withUploads({ lines: [aLine("We visit the market weekly")] }),
    );

    // How the card keeps this off the wire entirely for a word that already
    // carries its own example sentence.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });
});
