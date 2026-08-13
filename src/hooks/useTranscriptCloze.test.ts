import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aSavedTranscription, transcriptionId } from "@/test/support/factories";
import { useTranscriptCloze } from "./useTranscriptCloze";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * Minting a cloze sentence from the learner's own transcriptions.
 *
 * A cloze card is far more use when the sentence is one the learner actually
 * heard, so this scans their saved transcriptions for the target word and
 * offers the best sentence it finds. Nothing about it is visible when it fails
 * — the card simply falls back to a generated sentence — so a matcher that
 * quietly stops finding anything would go unnoticed indefinitely.
 *
 * The match is word-boundary aware, which is the interesting part: Arabic
 * attaches the definite article and prepositions directly to the noun, so a
 * substring match would fire on every longer word sharing the stem, and a naive
 * `\b` would not fire at all because `\b` is defined against Latin word
 * characters.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(
  params: { wordArabic?: string | null; dialect?: string; enabled?: boolean },
  seed?: (backend: SupabaseBackend) => void,
) {
  const harness = renderHookWithProviders(
    () =>
      useTranscriptCloze({
        wordArabic: params.wordArabic ?? "قهوة",
        dialect: params.dialect ?? "Gulf",
        enabled: params.enabled,
      }),
    { persona: "free", seed },
  );
  cleanup = harness.cleanup;
  return harness;
}

/** Seed transcriptions holding the given lines. */
const withLines = (...rows: Array<{ lines: unknown[]; dialect?: string | null; title?: string }>) =>
  (backend: SupabaseBackend) => {
    backend.db.seed(
      "saved_transcriptions",
      rows.map((row, index) =>
        aSavedTranscription({
          id: transcriptionId(index),
          title: row.title ?? `Transcription ${index}`,
          dialect: row.dialect === undefined ? "Gulf" : row.dialect,
          lines: row.lines,
        }),
      ),
    );
  };

const aLine = (arabic: string, over: Record<string, unknown> = {}) => ({
  id: "l1",
  arabic,
  translation: "a translation",
  startMs: 0,
  endMs: 2000,
  ...over,
});

describe("finding a sentence", () => {
  it("returns the line containing the word", async () => {
    const { result } = render({}, withLines({ lines: [aLine("أنا أشرب قهوة كل صباح")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      arabic: "أنا أشرب قهوة كل صباح",
      english: "a translation",
      transcriptionTitle: "Transcription 0",
    });
  });

  it("carries the timings so the clip can be played", async () => {
    const { result } = render(
      {},
      withLines({ lines: [aLine("أنا أشرب قهوة كل صباح", { startMs: 4000, endMs: 7000 })] }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Without them the cloze is text only, which loses the reason for
    // preferring the learner's own audio in the first place.
    expect(result.current.data).toMatchObject({ startMs: 4000, endMs: 7000 });
  });

  it("returns null when the word appears nowhere", async () => {
    const { result } = render({}, withLines({ lines: [aLine("أنا أشرب شاي كل صباح")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns null when there are no transcriptions at all", async () => {
    const { result } = render({}, (backend) => backend.db.seed("saved_transcriptions", []));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("the word boundary", () => {
  it("matches a word at the start of a sentence", async () => {
    const { result } = render({}, withLines({ lines: [aLine("قهوة الصباح ألذ شيء")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
  });

  it("matches a word at the end of a sentence", async () => {
    const { result } = render({}, withLines({ lines: [aLine("أنا أحب شرب قهوة")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
  });

  it("matches a word followed by Arabic punctuation", async () => {
    const { result } = render({}, withLines({ lines: [aLine("هل تريد قهوة؟ أنا أريد")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The Arabic question mark is a different code point from the Latin one;
    // matching only the Latin set would miss most real sentences.
    expect(result.current.data).not.toBeNull();
  });

  it("matches a word followed by an Arabic comma", async () => {
    const { result } = render({}, withLines({ lines: [aLine("أريد قهوة، من فضلك")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).not.toBeNull();
  });

  it("does not match the word inside a longer one", async () => {
    const { result } = render({}, withLines({ lines: [aLine("هذه مقهوية غريبة جدا هنا")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The difference from the saved-word lookup, which is a bare `includes`:
    // here a stem that happens to appear inside another word is not a match.
    expect(result.current.data).toBeNull();
  });

  it("does not match the word with the definite article attached", async () => {
    const { result } = render({}, withLines({ lines: [aLine("أنا أشرب القهوة كل صباح")] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Pinned, not fixed, and it is the cost of the boundary rule. Arabic
    // attaches ال directly, so the overwhelmingly common written form of a
    // noun does not match its own dictionary form. A learner saving "قهوة"
    // gets no cloze from a transcription that says "القهوة" on every line.
    expect(result.current.data).toBeNull();
  });

  it("matches through the token list when the text does not", async () => {
    const { result } = render(
      {},
      withLines({
        lines: [
          aLine("أنا أشرب القهوة كل صباح", {
            tokens: [{ surface: "أنا" }, { surface: "قهوة" }, { surface: "صباح" }],
          }),
        ],
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The escape hatch for the above: a tokenised transcription carries the
    // lemma separately, so an attached article is recoverable when the ASR
    // pipeline produced tokens.
    expect(result.current.data).not.toBeNull();
  });
});

describe("choosing between candidates", () => {
  it("prefers the shortest sentence", async () => {
    const { result } = render(
      {},
      withLines({
        lines: [
          aLine("أنا أشرب قهوة في الصباح الباكر مع أصدقائي القدامى دائما"),
          aLine("أنا أشرب قهوة يوميا", { id: "l2" }),
        ],
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A cloze is a fill-in-the-blank; a forty-word sentence buries the gap.
    expect(result.current.data?.arabic).toBe("أنا أشرب قهوة يوميا");
  });

  it("skips a sentence too short to give any context", async () => {
    const { result } = render(
      {},
      withLines({ lines: [aLine("قهوة فقط"), aLine("أنا أشرب قهوة يوميا", { id: "l2" })] }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Under three words there is nothing left once the target is blanked. Three
    // is the floor and is itself allowed — the check is `< 3`.
    expect(result.current.data?.arabic).toBe("أنا أشرب قهوة يوميا");
  });

  it("skips a sentence too long to read as a card", async () => {
    const long = ["قهوة", ...Array.from({ length: 25 }, (_, i) => `كلمة${i}`)].join(" ");
    const { result } = render({}, withLines({ lines: [aLine(long)] }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("looks across every transcription, not just the newest", async () => {
    const { result } = render(
      {},
      withLines(
        { lines: [aLine("أنا أشرب شاي كل صباح")], title: "No match here" },
        { lines: [aLine("أنا أشرب قهوة يوميا")], title: "The one with it" },
      ),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.transcriptionTitle).toBe("The one with it");
  });
});

describe("dialect", () => {
  it("skips a transcription tagged with another dialect", async () => {
    const { result } = render(
      { dialect: "Gulf" },
      withLines({ lines: [aLine("أنا أشرب قهوة يوميا")], dialect: "Egyptian" }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A Gulf learner given an Egyptian sentence is being taught the wrong
    // forms in the one place the app claims to be dialect-specific.
    expect(result.current.data).toBeNull();
  });

  it("uses an untagged transcription for any dialect", async () => {
    const { result } = render(
      { dialect: "Gulf" },
      withLines({ lines: [aLine("أنا أشرب قهوة يوميا")], dialect: null }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Older transcriptions predate the dialect tag; excluding them would empty
    // the corpus for long-standing users.
    expect(result.current.data).not.toBeNull();
  });
});

describe("when not to run at all", () => {
  it("does not query without a word", async () => {
    const { result } = render({ wordArabic: null }, withLines({ lines: [aLine("أنا أشرب قهوة")] }));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("treats a whitespace-only word as no word", async () => {
    const { result } = render({ wordArabic: "   " }, withLines({ lines: [aLine("أنا أشرب قهوة")] }));

    // Otherwise the empty pattern would match the first sentence in the
    // corpus, the same way the saved-word lookup does.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });

  it("does not query when disabled", async () => {
    const { result } = render(
      { enabled: false },
      withLines({ lines: [aLine("أنا أشرب قهوة يوميا")] }),
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
  });
});
