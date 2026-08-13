import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { aProfile, aVocabularyWord, TEST_USER_ID, wordId } from "@/test/support/factories";
import { useTutorUpload } from "./useTutorUpload";
import type { SupabaseBackend } from "@/test/support/server/handler";
import type { CandidateData } from "@/components/tutor/CandidateCard";

/**
 * Turning a recording of a real tutor into flashcards.
 *
 * A learner uploads an hour of their own lesson and gets back cards cut from
 * it: the word as their tutor actually said it, the sentence around it, and an
 * image where one helps. That provenance is the point — a card whose audio is
 * the voice of the person who taught it is worth more than the same word from a
 * synthesiser, because the learner is being drilled on the accent they are
 * actually going to hear.
 *
 * The pipeline is long: upload, word-level transcription, segmentation on
 * pauses, AI classification, then clip-and-store per approved candidate. Most
 * of it is best-effort by design — one failed image should not cost the other
 * forty cards — which makes the failure paths the part worth pinning.
 */

vi.mock("@/lib/audioClipper", () => ({
  decodeAudioFile: vi.fn(async () => ({ duration: 60, sampleRate: 44100 })),
  clipToWav: vi.fn(() => new Blob([new Uint8Array(16)], { type: "audio/wav" })),
}));

const A_LESSON = () =>
  new File([new Uint8Array(64)], "lesson.mp3", { type: "audio/mpeg" });

/** Deepgram's word-level output: text with a start and end in seconds. */
const words = (...spec: Array<[string, number, number]>) =>
  spec.map(([text, start, end]) => ({ text, start, end }));

const aCandidate = (over: Record<string, unknown> = {}) => ({
  word_text: "سوق",
  word_standard: "سوق",
  word_english: "market",
  sentence_text: "رحت السوق",
  sentence_english: "I went to the market",
  word_start_ms: 0,
  word_end_ms: 500,
  sentence_start_ms: 0,
  sentence_end_ms: 2000,
  confidence: 0.9,
  classification: "CONCRETE",
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
  vi.restoreAllMocks();
});

interface Stubs {
  transcript?: Record<string, unknown>;
  classification?: Record<string, unknown>;
  extra?: (backend: SupabaseBackend) => void;
}

function render({ transcript, classification, extra }: Stubs = {}, dialect = "Gulf") {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const harness = renderHookWithProviders(() => useTutorUpload(), {
    persona: "free",
    seed: (backend) => {
      backend.db.seed("profiles", [
        aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect }),
      ]);
      backend.stubFunction(
        "deepgram-transcribe",
        transcript ?? { words: words(["سوق", 0, 0.5]) },
      );
      backend.stubFunction(
        "classify-tutor-segments",
        classification ?? { success: true, candidates: [aCandidate()] },
      );
      backend.stubFunction("generate-flashcard-image", {
        imageUrl: "https://cdn.test/market.png",
      });
      extra?.(backend);
    },
  });
  cleanup = harness.cleanup;
  return harness;
}

/**
 * Wait until the session has landed.
 *
 * `processFile` refuses outright when `useAuth` has no user, and it has none on
 * the first pass — so starting before the session resolves would leave the hook
 * on the upload step and every assertion below describing a run that never
 * happened. The profile read only happens for a signed-in learner, which makes
 * it the signal.
 */
async function ready(harness: ReturnType<typeof render>) {
  await waitFor(() =>
    expect(
      harness.backend.db.reads.filter((read) => read.table === "profiles").length,
    ).toBeGreaterThan(0),
  );
}

/** Run a file through to the review step. */
async function process(harness: ReturnType<typeof render>) {
  await ready(harness);
  await act(async () => {
    await harness.result.current.processFile(A_LESSON());
  });
  await waitFor(() => expect(harness.result.current.step).toBe("review"));
}

const approveAll = (harness: ReturnType<typeof render>) => {
  act(() => {
    for (const candidate of harness.result.current.candidates) {
      harness.result.current.approveCandidate(candidate.id);
    }
  });
};

describe("processing an upload", () => {
  it("transcribes from the stored file rather than posting it", async () => {
    const harness = render();
    await process(harness);

    // An hour of lesson audio as a FormData payload hits the edge function's
    // size limit; a URL to the object that was just uploaded does not.
    const body = harness.backend.lastCallTo("deepgram-transcribe")?.body as {
      audioUrl?: string;
    };
    expect(body.audioUrl).toContain("/storage/v1/object/public/");
  });

  it("lands on the review step with the candidates it found", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [aCandidate({ word_text: "سوق" }), aCandidate({ word_text: "مطعم" })],
      },
    });
    await process(harness);

    expect(harness.result.current.candidates.map((candidate) => candidate.word_text)).toEqual([
      "سوق",
      "مطعم",
    ]);
    expect(harness.result.current.progress).toBe(100);
  });

  it("starts every candidate unreviewed", async () => {
    const harness = render();
    await process(harness);

    // The learner is the one who decides what becomes a card; auto-approving
    // would fill their deck with whatever the classifier happened to like.
    expect(harness.result.current.candidates[0].status).toBe("pending");
  });

  it("suggests an image only where a picture can mean something", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [
          aCandidate({ word_text: "سوق", classification: "CONCRETE" }),
          aCandidate({ word_text: "يمشي", classification: "ACTION" }),
          aCandidate({ word_text: "ربما", classification: "ABSTRACT" }),
        ],
      },
    });
    await process(harness);

    // A picture of "market" helps; a picture of "perhaps" is a stock photo of
    // nothing, and generating it costs money and teaches a false association.
    expect(harness.result.current.candidates.map((c) => c.image_enabled)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("makes the audio available for the learner to check against", async () => {
    const harness = render();
    await process(harness);

    // The review step plays the clip back; nothing else could tell the learner
    // whether the classifier cut the word at the right place.
    expect(harness.result.current.audioUrl).toBeTruthy();
    expect(harness.result.current.file?.name).toBe("lesson.mp3");
  });
});

describe("cutting the transcript into segments", () => {
  it("breaks on a pause rather than mid-sentence", async () => {
    const harness = render({
      transcript: {
        words: words(["رحت", 0, 0.4], ["السوق", 0.5, 1.0], ["اشتريت", 3.0, 3.5]),
      },
    });
    await process(harness);

    const body = harness.backend.lastCallTo("classify-tutor-segments")?.body as {
      segments: Array<{ text: string }>;
    };
    // Half a second of silence is where a speaker finished a thought. The
    // classifier is looking for a word in a usable sentence, and a segment
    // spanning two of them gives it neither.
    expect(body.segments.map((segment) => segment.text)).toEqual(["رحت السوق", "اشتريت"]);
  });

  it("keeps words spoken in one breath together", async () => {
    const harness = render({
      transcript: { words: words(["رحت", 0, 0.4], ["السوق", 0.5, 1.0]) },
    });
    await process(harness);

    const body = harness.backend.lastCallTo("classify-tutor-segments")?.body as {
      segments: Array<{ text: string; startMs: number; endMs: number }>;
    };
    expect(body.segments).toEqual([{ text: "رحت السوق", startMs: 0, endMs: 1000 }]);
  });

  it("sends the word timings alongside, for clipping", async () => {
    const harness = render({
      transcript: { words: words(["رحت", 0, 0.4], ["السوق", 0.5, 1.0]) },
    });
    await process(harness);

    const body = harness.backend.lastCallTo("classify-tutor-segments")?.body as {
      words: Array<{ text: string; startMs: number; endMs: number; index: number }>;
    };
    // The segment gives the classifier context; the per-word timings are what
    // let it name a clip boundary to the millisecond.
    expect(body.words).toEqual([
      { text: "رحت", startMs: 0, endMs: 400, index: 0 },
      { text: "السوق", startMs: 500, endMs: 1000, index: 1 },
    ]);
  });

  it("classifies against the dialect the learner is studying", async () => {
    const harness = render({}, "Egyptian");
    await process(harness);

    expect(harness.backend.lastCallTo("classify-tutor-segments")?.body).toMatchObject({
      dialectModule: "Egyptian",
    });
  });
});

describe("when processing fails", () => {
  it("returns to the upload step when transcription fails", async () => {
    const harness = render({}, "Gulf");
    harness.backend.stubFunctionFailure("deepgram-transcribe", 500, { error: "asr down" });
    await ready(harness);

    await act(async () => {
      await harness.result.current.processFile(A_LESSON());
    });

    // Back where they started, with the file still selected, so retrying is one
    // click rather than a re-upload of an hour of audio.
    await waitFor(() => expect(harness.result.current.step).toBe("upload"));
  });

  it("says so when the recording had no speech in it", async () => {
    const harness = render({ transcript: { words: [] } });
    await ready(harness);

    await act(async () => {
      await harness.result.current.processFile(A_LESSON());
    });

    // A silent or unreadable file is the commonest bad upload, and continuing
    // would produce zero candidates with no explanation.
    await waitFor(() => expect(harness.result.current.step).toBe("upload"));
    expect(harness.result.current.candidates).toEqual([]);
  });

  it("returns to upload when classification fails", async () => {
    const harness = render({ classification: { success: false, error: "model unavailable" } });
    await ready(harness);

    await act(async () => {
      await harness.result.current.processFile(A_LESSON());
    });

    await waitFor(() => expect(harness.result.current.step).toBe("upload"));
  });

  it("refuses to process for a signed-out visitor", async () => {
    const harness = renderHookWithProviders(() => useTutorUpload(), { persona: "anonymous" });
    cleanup = harness.cleanup;

    await act(async () => {
      await harness.result.current.processFile(A_LESSON());
    });

    // The clips are stored under the learner's own folder and the cards are
    // written to their deck; there is nowhere to put either.
    expect(harness.result.current.step).toBe("upload");
    expect(harness.backend.callsTo("deepgram-transcribe")).toEqual([]);
  });
});

describe("reviewing the candidates", () => {
  it("approves and rejects individually", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [aCandidate({ word_text: "سوق" }), aCandidate({ word_text: "مطعم" })],
      },
    });
    await process(harness);
    const [first, second] = harness.result.current.candidates;

    act(() => {
      harness.result.current.approveCandidate(first.id);
      harness.result.current.rejectCandidate(second.id);
    });

    expect(harness.result.current.candidates.map((c) => c.status)).toEqual([
      "approved",
      "rejected",
    ]);
  });

  it("lets the learner correct what the model heard", async () => {
    const harness = render();
    await process(harness);
    const [candidate] = harness.result.current.candidates;

    act(() => {
      harness.result.current.updateCandidate(candidate.id, {
        word_english: "souq",
        image_enabled: false,
      } as Partial<CandidateData>);
    });

    // ASR on dialect Arabic is wrong often enough that an uncorrectable card
    // would mean importing the mistakes along with the words.
    expect(harness.result.current.candidates[0]).toMatchObject({
      word_english: "souq",
      image_enabled: false,
    });
  });

  it("leaves the other candidates alone", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [aCandidate({ word_text: "سوق" }), aCandidate({ word_text: "مطعم" })],
      },
    });
    await process(harness);

    act(() => {
      harness.result.current.approveCandidate(harness.result.current.candidates[0].id);
    });

    expect(harness.result.current.candidates[1].status).toBe("pending");
  });
});

describe("creating the cards", () => {
  it("writes one card per approved candidate", async () => {
    const harness = render();
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    const rows = harness.backend.db.rows("user_vocabulary");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: TEST_USER_ID,
      word_arabic: "سوق",
      word_english: "market",
      source: "tutor-upload",
      dialect: "Gulf",
    });
    await waitFor(() => expect(harness.result.current.step).toBe("confirm"));
  });

  it("attaches the tutor's own audio for the word and the sentence", async () => {
    const harness = render();
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    const row = harness.backend.db.rows("user_vocabulary")[0];
    // The whole reason to build cards from a lesson recording rather than from
    // a dictionary.
    expect(row.word_audio_url).toContain("/storage/v1/object/public/");
    expect(row.sentence_audio_url).toContain("/storage/v1/object/public/");
  });

  it("stores no sentence audio when the classifier found no sentence", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [aCandidate({ sentence_text: null, sentence_start_ms: null, sentence_end_ms: null })],
      },
    });
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    // A zero-length clip would play as a click, which reads as broken audio
    // rather than as an absent example.
    expect(harness.backend.db.rows("user_vocabulary")[0].sentence_audio_url).toBeNull();
  });

  it("skips the candidates the learner rejected", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [aCandidate({ word_text: "سوق" }), aCandidate({ word_text: "مطعم" })],
      },
    });
    await process(harness);
    act(() => {
      harness.result.current.approveCandidate(harness.result.current.candidates[0].id);
      harness.result.current.rejectCandidate(harness.result.current.candidates[1].id);
    });

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    expect(harness.backend.db.rows("user_vocabulary").map((row) => row.word_arabic)).toEqual([
      "سوق",
    ]);
  });

  it("does nothing when nothing was approved", async () => {
    const harness = render();
    await process(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    expect(harness.backend.db.rows("user_vocabulary")).toEqual([]);
    expect(harness.result.current.step).toBe("review");
  });

  it("tags every card with the upload it came from", async () => {
    const harness = render();
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    // So a learner can find the cards from one lesson again, and so a bad
    // import can be undone as a batch.
    expect(harness.backend.db.rows("user_vocabulary")[0].source_upload_id).toBeTruthy();
  });
});

describe("finding images for the cards", () => {
  it("reuses an image the curriculum already has", async () => {
    const harness = render({
      extra: (backend) =>
        backend.db.seed("vocabulary_words", [
          aVocabularyWord({
            id: wordId(0),
            word_english: "market",
            image_url: "https://cdn.test/existing.png",
          }),
        ]),
    });
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    // Generating a picture of a market when the app already owns one is a
    // model call and a storage object for nothing.
    expect(harness.backend.db.rows("user_vocabulary")[0].image_url).toBe(
      "https://cdn.test/existing.png",
    );
    expect(harness.backend.callsTo("generate-flashcard-image")).toEqual([]);
  });

  it("generates one when nothing matches", async () => {
    const harness = render();
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    expect(harness.backend.db.rows("user_vocabulary")[0].image_url).toBe(
      "https://cdn.test/market.png",
    );
  });

  it("saves the card anyway when the image cannot be made", async () => {
    const harness = render();
    harness.backend.stubFunctionFailure("generate-flashcard-image", 500);
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    // Best-effort by design: one failed picture must not cost the learner the
    // word, which is the part they actually recorded.
    const row = harness.backend.db.rows("user_vocabulary")[0];
    expect(row.image_url).toBeNull();
    expect(row.word_arabic).toBe("سوق");
  });

  it("asks for no image on an abstract word", async () => {
    const harness = render({
      classification: {
        success: true,
        candidates: [aCandidate({ classification: "ABSTRACT" })],
      },
    });
    await process(harness);
    approveAll(harness);

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    expect(harness.backend.callsTo("generate-flashcard-image")).toEqual([]);
  });
});

describe("when saving fails", () => {
  it("reports success even though nothing was written", async () => {
    const harness = render();
    await process(harness);
    approveAll(harness);
    harness.backend.db.failInserts("user_vocabulary", 500, { message: "boom" });

    await act(async () => {
      await harness.result.current.createFlashcards();
    });

    // Pinned. The batch insert's error is logged and only retried when the code
    // is 23505 (a duplicate). Any other failure — a permissions error, an
    // outage, a constraint violation — falls straight through to the success
    // path: the learner is told "Created 1 flashcards!", moved to the confirm
    // step, and has nothing in their deck. The one thing this screen exists to
    // do is the one thing it does not check.
    expect(harness.backend.db.rows("user_vocabulary")).toEqual([]);
    await waitFor(() => expect(harness.result.current.step).toBe("confirm"));
    expect(harness.result.current.progress).toBe(100);
  });
});
