import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { VerseAudioButton } from "./VerseAudioButton";

/**
 * The listen button beside a Bible verse.
 *
 * A reading page is a long list of these, and unlike the alphabet trainer's
 * speaker it does not synthesise anything until it is tapped: a chapter is
 * dozens of verses, each in up to three dialects, and generating all of them on
 * scroll would cost a TTS call per row for audio nobody asked for. That is the
 * whole reason for the `armed` flag — the first tap turns the request on, and
 * every tap after it drives the audio that came back.
 */

const tts = vi.hoisted(() => ({
  asked: [] as Array<{ text: string; skip?: boolean; dialect?: string }>,
  url: null as string | null,
  loading: false,
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; skip?: boolean; dialect?: string }) => {
    tts.asked.push(options);
    return {
      ttsUrl: options.skip ? null : tts.url,
      isLoading: options.skip ? false : tts.loading,
      regenerate: vi.fn(),
    };
  },
}));

interface FakeAudio {
  src: string;
  currentTime: number;
  onended: (() => void) | null;
  onpause: (() => void) | null;
  onplay: (() => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}
let audios: FakeAudio[] = [];
let playRejects = false;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.asked = [];
  tts.url = "blob:verse-audio";
  tts.loading = false;
  audios = [];
  playRejects = false;

  vi.stubGlobal(
    "Audio",
    // Fires the media events the component listens on, because it tracks
    // playback entirely through onplay/onpause/onended rather than its own
    // state — an audio that silently succeeded would leave the button wrong.
    class {
      currentTime = 0;
      onended: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onplay: (() => void) | null = null;
      play = vi.fn(() => {
        if (playRejects) return Promise.reject(new Error("blocked"));
        this.onplay?.();
        return Promise.resolve();
      });
      pause = vi.fn(() => {
        this.onpause?.();
      });
      constructor(public src: string) {
        audios.push(this as unknown as FakeAudio);
      }
    },
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

const VERSE = "في البدء كان الكلمة";

interface Options {
  text?: string;
  dialect?: string;
  label?: string;
  activeDialect?: string;
}

function render({ text = VERSE, dialect, label, activeDialect = "Gulf" }: Options = {}) {
  localStorage.setItem("ingleezy_dialect_module", activeDialect);
  const harness = renderWithProviders(
    <VerseAudioButton text={text} dialect={dialect} label={label} />,
  );
  cleanup = harness.cleanup;
  return harness;
}

const button = () => screen.getByRole("button");
const tap = async () => {
  await act(async () => {
    fireEvent.click(button());
  });
};
/** The options the hook was handed on the most recent render. */
const lastAsk = () => tts.asked.at(-1)!;

describe("VerseAudioButton — before the first tap", () => {
  it("offers to listen", () => {
    render();
    expect(button()).toHaveTextContent("Listen");
  });

  it("takes a caller's label", () => {
    render({ label: "Hear it in Egyptian" });
    expect(button()).toHaveTextContent("Hear it in Egyptian");
  });

  it("asks for nothing until it is tapped", () => {
    // A chapter is dozens of verses; synthesising on render would be a TTS call
    // per row for audio nobody asked for.
    render();
    expect(lastAsk().skip).toBe(true);
    expect(audios).toEqual([]);
  });

  it("stays silent for a verse with no text", () => {
    render({ text: "   " });
    expect(lastAsk().skip).toBe(true);
  });

  it("is pressable, since nothing is loading yet", () => {
    render();
    expect(button()).toBeEnabled();
  });
});

describe("VerseAudioButton — choosing a dialect", () => {
  it("follows the dialect the learner is studying", () => {
    render({ activeDialect: "Egyptian" });
    expect(lastAsk().dialect).toBe("Egyptian");
  });

  it("lets a caller pin one verse to a specific dialect", () => {
    // The comparison view shows the same verse in several dialects at once, so
    // each row has to override the global choice.
    render({ dialect: "Yemeni", activeDialect: "Gulf" });
    expect(lastAsk().dialect).toBe("Yemeni");
  });

  it("names the pinned dialect for a screen reader", () => {
    render({ dialect: "Yemeni" });
    expect(button()).toHaveAccessibleName("Play verse (Yemeni)");
  });

  it("says only 'Play verse' when it is following the global dialect", () => {
    render({ activeDialect: "Egyptian" });
    expect(button()).toHaveAccessibleName("Play verse");
  });
});

describe("VerseAudioButton — the first tap", () => {
  it("turns the request on", async () => {
    tts.url = null;
    render();
    await tap();
    expect(lastAsk().skip).toBe(false);
  });

  it("shows a spinner while the clip is being made", async () => {
    tts.url = null;
    tts.loading = true;
    const { container } = render();
    await tap();

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("cannot be tapped again while the clip is being made", async () => {
    tts.url = null;
    tts.loading = true;
    render();
    await tap();

    expect(button()).toBeDisabled();
  });

  it("plays as soon as the clip arrives", async () => {
    render();
    await tap();

    expect(audios).toHaveLength(1);
    expect(audios[0].src).toBe("blob:verse-audio");
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("switches to a pause control while it plays", async () => {
    render();
    await tap();

    expect(button()).toHaveAccessibleName("Pause verse");
  });

  it("keeps the caller's label visible while playing", async () => {
    // The icon changes; the word does not, so the row does not reflow under the
    // reader's finger.
    render({ label: "Listen" });
    await tap();
    expect(button()).toHaveTextContent("Listen");
  });

  it("goes back to offering a play when the verse finishes", async () => {
    render();
    await tap();
    await act(async () => audios[0].onended?.());

    expect(button()).toHaveAccessibleName("Play verse");
  });

  it("stays a play control when the browser refuses to start", async () => {
    playRejects = true;
    render();
    await tap();

    expect(button()).toHaveAccessibleName("Play verse");
  });
});

describe("VerseAudioButton — tapping again", () => {
  it("pauses a verse that is playing", async () => {
    render();
    await tap();
    await tap();

    expect(audios).toHaveLength(1);
    expect(audios[0].pause).toHaveBeenCalledTimes(1);
    expect(button()).toHaveAccessibleName("Play verse");
  });

  it("replays the same clip rather than synthesising it again", async () => {
    // The blob is already in hand. Re-reading a verse is the commonest thing a
    // reader does, and it should not cost a second TTS call.
    render();
    await tap();
    await tap();
    await tap();

    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledTimes(2);
  });

  it("restarts the verse from the beginning", async () => {
    render();
    await tap();
    await act(async () => audios[0].onended?.());
    audios[0].currentTime = 12;
    await tap();

    expect(audios[0].currentTime).toBe(0);
  });

  it("shows the pause control again on the replay", async () => {
    render();
    await tap();
    await tap();
    await tap();

    expect(button()).toHaveAccessibleName("Pause verse");
  });

  it("swallows a refused replay", async () => {
    render();
    await tap();
    await act(async () => audios[0].onended?.());

    playRejects = true;
    await tap();
    expect(audios[0].play).toHaveBeenCalledTimes(2);
  });
});

describe("VerseAudioButton — leaving the verse", () => {
  it("stops the audio when the row unmounts", async () => {
    // A reader who taps a verse and navigates away should not hear it over the
    // next screen.
    const { unmount } = render();
    await tap();

    act(() => unmount());
    expect(audios[0].pause).toHaveBeenCalledTimes(1);
    expect(audios[0].src).toBe("");
  });

  it("waits to be asked again when the verse changes", async () => {
    // `armed` was set once and never cleared, and the autoplay effect fires on
    // every new ttsUrl — so once a reader had listened to one verse, any change
    // to that row's text (switching translation, a dialect toggle, or a
    // virtualised list reusing the row) played the new verse without a tap.
    const { rerender } = render();
    await tap();
    expect(audios).toHaveLength(1);

    tts.url = "blob:next-verse";
    await act(async () => {
      rerender(<VerseAudioButton text="والكلمة كان عند الله" />);
    });

    expect(audios).toHaveLength(1);
  });

  it("stops asking the TTS service once the verse changes", async () => {
    const { rerender } = render();
    await tap();

    await act(async () => {
      rerender(<VerseAudioButton text="والكلمة كان عند الله" />);
    });

    expect(lastAsk().skip).toBe(true);
  });

  it("still plays the new verse when it is asked to", async () => {
    const { rerender } = render();
    await tap();

    tts.url = "blob:next-verse";
    await act(async () => {
      rerender(<VerseAudioButton text="والكلمة كان عند الله" />);
    });
    await tap();

    expect(audios).toHaveLength(2);
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });

  it("disables itself for an untranslated verse", async () => {
    // `skip` stayed true while the text was blank so no clip was ever
    // generated — but `isLoading` was false too, leaving a live-looking button
    // that did nothing when tapped and said nothing about why. Bible rows
    // render from dialect columns that are routinely null while a chapter is
    // still being translated.
    render({ text: "" });

    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("title", "No translation for this verse yet");
    expect(audios).toEqual([]);
    expect(lastAsk().skip).toBe(true);
  });
});
