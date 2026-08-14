import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile, TEST_USER_ID } from "@/test/support/factories";
import { PronunciationButton } from "./PronunciationButton";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * "انطقها" — the button on a flashcard that scores how the learner said the
 * English word.
 *
 * Recognition is the easy half of vocabulary. Producing a word aloud, with
 * sounds Arabic does not have (p/b, v/f, vowel contrasts), is where learners
 * actually stall, and it is the one thing they cannot assess for themselves.
 * A number and a per-word breakdown is the only feedback available to
 * somebody studying alone. Scoring always runs against English (en-US) —
 * the learner's own dialect shapes the coaching, not the reference model.
 */

// The scorer converts the take to 16 kHz WAV before sending it, which needs a
// real AudioContext to decode. jsdom has none, and the conversion is covered by
// src/lib/audioToWav.test.ts.
vi.mock("@/lib/audioToWav", () => ({
  blobToWav: vi.fn(async (blob: Blob) => blob),
}));

const A_WORD = "market";
const A_PHRASE = "I went to the market";

const aResult = (over: Record<string, unknown> = {}) => ({
  overall: 78,
  accuracy: 84,
  fluency: 72,
  completeness: 90,
  words: [
    { word: "went", accuracy: 90, errorType: "None" },
    { word: "market", accuracy: 60, errorType: "Mispronunciation" },
  ],
  recognizedText: "I went to the market",
  locale: "en-US",
  ...over,
});

// ── Recorder doubles ────────────────────────────────────────────────────────

interface FakeRecorder {
  state: string;
  start: ReturnType<typeof vi.fn>;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

let recorders: FakeRecorder[] = [];
let recordedBytes = 32;
let micThrows: Error | null = null;
const micTracks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];

const originals = {
  MediaRecorder: (globalThis as Record<string, unknown>).MediaRecorder,
  mediaDevices: Object.getOwnPropertyDescriptor(navigator, "mediaDevices"),
};

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });

  constructor() {
    recorders.push(this as unknown as FakeRecorder);
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(recordedBytes)]) });
    this.onstop?.();
  }
}

let cleanup: (() => void) | undefined;

beforeEach(() => {
  recorders = [];
  micTracks.length = 0;
  recordedBytes = 32;
  micThrows = null;
  localStorage.clear();

  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (micThrows) throw micThrows;
        const track = { stop: vi.fn() };
        micTracks.push(track);
        return { getTracks: () => [track] } as unknown as MediaStream;
      }),
    },
  });
  // jsdom's Blob has no arrayBuffer, and the scorer base64-encodes the take.
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
      return Promise.resolve(new ArrayBuffer(this.size));
    };
  }
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  (globalThis as Record<string, unknown>).MediaRecorder = originals.MediaRecorder;
  if (originals.mediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", originals.mediaDevices);
  }
  localStorage.clear();
  vi.useRealTimers();
});

interface Options {
  word?: string;
  gloss?: string;
  dialect?: string;
  seed?: (backend: SupabaseBackend) => void;
}

function render({ word = A_WORD, gloss, dialect = "Gulf", seed }: Options = {}) {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const harness = renderWithProviders(
    <PronunciationButton word={word} gloss={gloss} />,
    {
      persona: "free",
      seed: (backend) => {
        backend.db.seed("profiles", [
          aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect }),
        ]);
        backend.stubFunction("azure-pronunciation", aResult());
        backend.stubFunction("pronunciation-feedback", { tips: ["Hold the ق further back"] });
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return harness;
}

/**
 * Record a take and let it be scored.
 *
 * Stopped through the button rather than by calling the recorder directly,
 * because that is the path the component owns — stopping the recorder behind
 * its back leaves it believing it is still listening.
 */
async function recordTake() {
  fireEvent.click(screen.getByRole("button", { name: /انطقها/ }));
  await waitFor(() => expect(recorders).toHaveLength(1));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /إيقاف/ }));
  });
}

describe("offering to listen", () => {
  it("starts with an invitation rather than a score", () => {
    render();

    expect(screen.getByRole("button", { name: /انطقها/ })).toBeInTheDocument();
  });

  it("switches to a stop control while it is listening", async () => {
    render();

    fireEvent.click(screen.getByRole("button", { name: /انطقها/ }));

    // Without a visible stop the learner has no way to end a take early, and
    // the five-second cap would make every short word a four-second wait.
    await waitFor(() => expect(screen.getByRole("button", { name: /إيقاف/ })).toBeInTheDocument());
  });

  it("stops on its own after five seconds", async () => {
    vi.useFakeTimers();
    render();
    fireEvent.click(screen.getByRole("button", { name: /انطقها/ }));
    await act(async () => {});

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // A recorder left running is a microphone left open. Five seconds is well
    // past any single word or short phrase.
    expect(recorders[0].state).toBe("inactive");
    vi.useRealTimers();
  });

  it("releases the microphone when the take ends", async () => {
    render();

    await recordTake();

    // The browser's recording indicator staying lit after a flashcard is the
    // sort of thing that gets an app uninstalled.
    expect(micTracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true);
  });

  it("says nothing alarming when the microphone is refused", async () => {
    micThrows = new DOMException("Permission denied", "NotAllowedError");
    render();

    fireEvent.click(screen.getByRole("button", { name: /انطقها/ }));

    // Declining is a decision, and the card is still usable without it — the
    // button simply stays where it was.
    await waitFor(() => expect(screen.getByRole("button", { name: /انطقها/ })).toBeInTheDocument());
  });

  it("does not send a take with nothing in it", async () => {
    recordedBytes = 0;
    const { backend } = render();

    await recordTake();

    // A microphone that never started produces an empty blob, and scoring it
    // would report 0/100 as though the learner had spoken badly.
    expect(backend.callsTo("azure-pronunciation")).toEqual([]);
  });
});

describe("scoring against English", () => {
  const localeFor = async (dialect: string) => {
    const { backend } = render({ dialect });
    await recordTake();
    return (backend.lastCallTo("azure-pronunciation")?.body as { locale: string }).locale;
  };

  it("scores against English regardless of the learner's dialect", async () => {
    // The target language is English for every learner; the dialect shapes
    // the coaching tips, never the reference model.
    expect(await localeFor("Gulf")).toBe("en-US");
    expect(await localeFor("Egyptian")).toBe("en-US");
  });

  it("sends the word it asked the learner to say", async () => {
    const { backend } = render({ word: A_PHRASE });

    await recordTake();

    expect(backend.lastCallTo("azure-pronunciation")?.body).toMatchObject({
      referenceText: A_PHRASE,
    });
  });
});

describe("showing the score", () => {
  it("reports phoneme accuracy for a single word", async () => {
    render({ word: A_WORD });

    await recordTake();

    // A one-word take has no fluency to measure and nothing to be incomplete
    // about; accuracy is the only honest number.
    await waitFor(() => expect(screen.getByText("84")).toBeInTheDocument());
    expect(screen.queryByText("Fluency")).not.toBeInTheDocument();
  });

  it("reports the overall score for a phrase, with its parts", async () => {
    render({ word: A_PHRASE });

    await recordTake();

    // On a phrase, pausing in the wrong place and skipping a word are real
    // failures that accuracy alone would hide.
    await waitFor(() => expect(screen.getByText("78")).toBeInTheDocument());
    expect(screen.getByText("الدقة")).toBeInTheDocument();
    expect(screen.getByText("الطلاقة")).toBeInTheDocument();
    expect(screen.getByText("الاكتمال")).toBeInTheDocument();
  });

  it("breaks a phrase down word by word", async () => {
    render({ word: A_PHRASE });

    await recordTake();

    // "78/100" tells a learner they were imperfect; the per-word colours tell
    // them which word to say again.
    await waitFor(() => expect(screen.getByText("market")).toBeInTheDocument());
    expect(screen.getByText("went")).toBeInTheDocument();
  });

  it("offers another go", async () => {
    render();

    await recordTake();

    // Saying it again immediately is the entire practice loop.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /حاول من جديد/ })).toBeInTheDocument(),
    );
  });

  it("clears the score when the learner tries again", async () => {
    render();
    await recordTake();
    await waitFor(() => expect(screen.getByText("84")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /حاول من جديد/ }));

    expect(screen.queryByText("84")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /انطقها/ })).toBeInTheDocument();
  });
});

describe("the coaching tips", () => {
  it("asks for advice on what went wrong", async () => {
    const { backend } = render({ word: A_PHRASE, gloss: "رحت السوق" });

    await recordTake();

    // The scores go with the request, so the advice is about this take rather
    // than about the phrase in general. Column-named fields: word_english is
    // the spoken English target, word_arabic the meaning.
    await waitFor(() =>
      expect(backend.lastCallTo("pronunciation-feedback")?.body).toMatchObject({
        word_arabic: "رحت السوق",
        word_english: A_PHRASE,
        dialect: "en-US",
      }),
    );
  });

  it("shows them when they arrive", async () => {
    render();

    await recordTake();

    await waitFor(() =>
      expect(screen.getByText("Hold the ق further back")).toBeInTheDocument(),
    );
  });

  it("keeps the score when the advice fails", async () => {
    render({ seed: (b) => b.stubFunctionFailure("pronunciation-feedback", 500) });

    await recordTake();

    // Tips are commentary on a number the learner already has; losing them is
    // not worth losing the score.
    await waitFor(() => expect(screen.getByText("84")).toBeInTheDocument());
    expect(screen.queryByText("نصائح")).not.toBeInTheDocument();
  });
});

describe("when scoring fails", () => {
  it("says so and offers a retry", async () => {
    render({ seed: (b) => b.stubFunctionFailure("azure-pronunciation", 500, { error: "asr down" }) });

    await recordTake();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /أعد المحاولة/ })).toBeInTheDocument(),
    );
  });

  it("does not ask for tips about a score it does not have", async () => {
    const { backend } = render({
      seed: (b) => b.stubFunctionFailure("azure-pronunciation", 500),
    });

    await recordTake();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /أعد المحاولة/ })).toBeInTheDocument(),
    );
    expect(backend.callsTo("pronunciation-feedback")).toEqual([]);
  });
});

describe("moving to the next card", () => {
  it("clears the previous word's score", async () => {
    const { rerender } = render({ word: A_WORD });
    await recordTake();
    await waitFor(() => expect(screen.getByText("84")).toBeInTheDocument());

    rerender(<PronunciationButton word="مطعم" />);

    // A score carried over from the previous flashcard would tell the learner
    // how well they said a word they have not been asked for yet.
    await waitFor(() => expect(screen.queryByText("84")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /انطقها/ })).toBeInTheDocument();
  });
});
