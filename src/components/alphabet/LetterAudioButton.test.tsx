import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { LetterAudioButton } from "./LetterAudioButton";

/**
 * The round speaker on every letter card in the alphabet trainer.
 *
 * A learner meeting ح for the first time needs to hear it more than they need
 * to read about it, so this button appears everywhere a letter does — often
 * several to a screen — and in two flavours. `forceMsa` is the Fusha
 * pronunciation, pinned to one formal voice regardless of which dialect the
 * learner is studying, because the point of that button is the reference sound.
 * Everything else follows the active dialect, which is what the hook routes on.
 */

const tts = vi.hoisted(() => ({
  asked: [] as Array<{ text: string; dialect?: string; voice?: string; skip?: boolean }>,
  url: null as string | null,
  loading: false,
}));

vi.mock("@/hooks/useAzureTTS", () => ({
  useAzureTTS: (options: { text: string; dialect?: string; voice?: string; skip?: boolean }) => {
    tts.asked.push(options);
    return { ttsUrl: tts.url, isLoading: tts.loading, regenerate: vi.fn() };
  },
}));

interface FakeAudio {
  src: string;
  onended: (() => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}
let audios: FakeAudio[] = [];
/** Whether `play()` resolves — a browser that blocks autoplay rejects it. */
let playRejects = false;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  tts.asked = [];
  tts.url = "blob:letter-audio";
  tts.loading = false;
  audios = [];
  playRejects = false;

  vi.stubGlobal(
    "Audio",
    class {
      onended: (() => void) | null = null;
      play = vi.fn(() =>
        playRejects ? Promise.reject(new Error("blocked")) : Promise.resolve(),
      );
      pause = vi.fn();
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

interface Options {
  text?: string;
  forceMsa?: boolean;
  size?: "sm" | "md" | "lg";
  autoplay?: boolean;
  label?: string;
}

function render({ text = "ح", forceMsa, size, autoplay, label }: Options = {}) {
  const harness = renderWithProviders(
    <LetterAudioButton
      text={text}
      forceMsa={forceMsa}
      size={size}
      autoplay={autoplay}
      label={label}
    />,
  );
  cleanup = harness.cleanup;
  return harness;
}

const button = () => screen.getByRole("button");
/** Let the play promise settle, since both branches only act in a `.catch`. */
const settle = () => act(async () => {});

describe("LetterAudioButton — the control itself", () => {
  it("names the letter it will play", () => {
    render({ text: "ص" });
    expect(button()).toHaveAccessibleName("Play ص");
  });

  it("takes a caller's label when the letter alone would not explain it", () => {
    // "Play ح" is right on a letter card and wrong next to a whole word, which
    // is why the Fusha comparison rows pass their own.
    render({ text: "ح", label: "Hear the Fusha pronunciation" });
    expect(button()).toHaveAccessibleName("Hear the Fusha pronunciation");
  });

  it("cannot be pressed while the clip is still being made", () => {
    tts.loading = true;
    tts.url = null;
    render();
    expect(button()).toBeDisabled();
  });

  it("can be pressed before a clip exists, since pressing is what asks for one", () => {
    // Gating on `!ttsUrl` would leave a lazily-armed button permanently
    // disabled: there is no clip until the first tap requests it.
    tts.url = null;
    render();
    expect(button()).toBeEnabled();
  });

  it("cannot be pressed for a letter with no text", () => {
    render({ text: "  " });
    expect(button()).toBeDisabled();
  });

  it("becomes pressable once the clip arrives", () => {
    render();
    expect(button()).toBeEnabled();
  });

  it.each([
    ["sm", "h-9 w-9", "h-4 w-4"],
    ["md", "h-11 w-11", "h-5 w-5"],
    ["lg", "h-14 w-14", "h-6 w-6"],
  ] as const)("sizes itself and its icon for %s", (size, buttonCls, iconCls) => {
    const { container } = render({ size });
    expect(button().className).toContain(buttonCls);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain(iconCls);
  });

  it("defaults to the medium size", () => {
    render();
    expect(button().className).toContain("h-11 w-11");
  });
});

describe("LetterAudioButton — choosing a voice", () => {
  it("pins the Fusha button to the formal MSA voice", () => {
    // Whatever dialect the learner is studying, the Fusha button has to say the
    // letter the way the reference does — otherwise the comparison it exists to
    // support is between two dialects rather than dialect and standard.
    render({ text: "ق", forceMsa: true });
    expect(tts.asked[0]).toMatchObject({
      text: "ق",
      dialect: "MSA",
      voice: "ar-SA-HamedNeural",
    });
  });

  it("leaves the routing to the hook for a dialect button", () => {
    render({ text: "ق" });
    expect(tts.asked[0]).toMatchObject({ text: "ق", dialect: undefined, voice: undefined });
  });

  it("asks for nothing until it is tapped", () => {
    // Called with no `skip`, every one of these synthesised the moment it
    // appeared. The alphabet grid puts twenty-eight on one screen and the
    // letter detail view adds a Fusha button beside each dialect one, so
    // opening a page fired a TTS request per button whether or not the learner
    // ever tapped one — and held every response as a blob for the life of the
    // page.
    render();
    expect(tts.asked[0].skip).toBe(true);
    expect(audios).toEqual([]);
  });

  it("asks once it is tapped", () => {
    render();
    fireEvent.click(button());
    expect(tts.asked.at(-1)).toMatchObject({ skip: false });
  });

  it("goes back to waiting when the button is reused for another letter", () => {
    // The grid and the letter tour both reuse these, so a bare armed flag would
    // make the next letter speak unasked.
    const { rerender } = render({ text: "ب" });
    fireEvent.click(button());
    expect(tts.asked.at(-1)?.skip).toBe(false);

    rerender(<LetterAudioButton text="ت" />);
    expect(tts.asked.at(-1)).toMatchObject({ text: "ت", skip: true });
  });

  it("still autoplays without waiting for a tap", () => {
    // Autoplay is an explicit request from the caller, so it arms on mount.
    render({ autoplay: true });
    expect(tts.asked[0].skip).toBe(false);
  });
});

describe("LetterAudioButton — playing on demand", () => {
  it("plays the clip when tapped", async () => {
    render();
    fireEvent.click(button());
    await settle();

    expect(audios).toHaveLength(1);
    expect(audios[0].src).toBe("blob:letter-audio");
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("marks itself as playing while the clip runs", async () => {
    render();
    fireEvent.click(button());
    await settle();

    expect(button().className).toContain("ring-2");
  });

  it("stops looking active when the clip ends", async () => {
    render();
    fireEvent.click(button());
    await settle();

    await act(async () => audios[0].onended?.());
    expect(button().className).not.toContain("ring-2");
  });

  it("stops looking active when the browser refuses to play", async () => {
    playRejects = true;
    render();
    fireEvent.click(button());
    await settle();

    expect(button().className).not.toContain("ring-2");
  });

  it("cuts the previous clip off when tapped again", async () => {
    // Two clips overlapping is worse than a clipped one: the learner is
    // comparing sounds, and hearing both at once tells them nothing.
    render();
    fireEvent.click(button());
    await settle();
    fireEvent.click(button());
    await settle();

    expect(audios).toHaveLength(2);
    expect(audios[0].pause).toHaveBeenCalledTimes(1);
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });

  it("stays active across a re-tap rather than flickering off", async () => {
    render();
    fireEvent.click(button());
    await settle();
    fireEvent.click(button());
    await settle();

    expect(button().className).toContain("ring-2");
  });
});

describe("LetterAudioButton — playing on arrival", () => {
  it("plays by itself when asked to autoplay", async () => {
    render({ autoplay: true });
    await settle();

    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("stays silent when not asked to", async () => {
    render({ autoplay: false });
    await settle();
    expect(audios).toEqual([]);
  });

  it("autoplays a letter only once", async () => {
    // The effect reruns on every ttsUrl identity change, and a stepper that
    // re-renders would otherwise replay the same letter under the learner.
    const { rerender } = render({ autoplay: true });
    await settle();
    rerender(<LetterAudioButton text="ح" autoplay />);
    await settle();

    expect(audios).toHaveLength(1);
  });

  it("autoplays again when the letter changes", async () => {
    // The guard is reset on `text`, which is what makes a letter-by-letter tour
    // speak each new letter instead of falling silent after the first.
    const { rerender } = render({ autoplay: true });
    await settle();

    tts.url = "blob:next-letter";
    rerender(<LetterAudioButton text="خ" autoplay />);
    await settle();

    expect(audios).toHaveLength(2);
    expect(audios[1].src).toBe("blob:next-letter");
  });

  it("swallows a browser that blocks unprompted audio", async () => {
    // Autoplay without a gesture is refused on iOS and on desktop Chrome until
    // the user has interacted. Tapping still works, so this must not throw.
    playRejects = true;
    render({ autoplay: true });
    await settle();

    expect(audios[0].play).toHaveBeenCalled();
  });

  it("lights up while it is autoplaying", async () => {
    // The autoplay branch built its own Audio and touched neither `playing` nor
    // `onended`, so the ring that says "this is the sound you are hearing"
    // appeared only for a tapped clip — leaving the button looking idle for the
    // whole clip on the letter tour, where autoplay is the entire point.
    render({ autoplay: true });
    await settle();

    expect(audios[0].play).toHaveBeenCalled();
    expect(button().className).toContain("ring-2");
  });

  it("stops looking active when an autoplayed clip ends", async () => {
    render({ autoplay: true });
    await settle();

    act(() => audios[0].onended?.());
    expect(button().className).not.toContain("ring-2");
  });
});

describe("LetterAudioButton — leaving the page", () => {
  it("stops playing once the button is gone", async () => {
    // There was no cleanup on either effect and no unmount handler, so the
    // Audio outlived the component: tapping a letter and going straight back
    // left it being pronounced over the next screen, and on the letter tour
    // every skipped letter kept playing.
    const { unmount } = render();
    fireEvent.click(button());
    await settle();

    act(() => unmount());

    expect(audios[0].pause).toHaveBeenCalledTimes(1);
    expect(audios[0].src).toBe("");
  });

  it("stops an autoplayed clip too", async () => {
    const { unmount } = render({ autoplay: true });
    await settle();

    act(() => unmount());

    expect(audios[0].pause).toHaveBeenCalledTimes(1);
  });
});
