import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { SoundAudioButton } from "./SoundAudioButton";

/**
 * The round speaker on every sound card in the English Sounds journey.
 *
 * A learner meeting /p/ for the first time needs to hear it more than they
 * need to read about it, so this button appears everywhere a sound does —
 * often several to a screen. Unlike Hakiya's LetterAudioButton it never
 * routes to Munsit: the whole point of this button is the TARGET-language
 * clip, so it forces the Azure English voice regardless of which Arabic
 * dialect module the learner has active for the rest of the app.
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
  tts.url = "blob:sound-audio";
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
  size?: "sm" | "md" | "lg";
  autoplay?: boolean;
  label?: string;
}

function render({ text = "pen", size, autoplay, label }: Options = {}) {
  const harness = renderWithProviders(
    <SoundAudioButton text={text} size={size} autoplay={autoplay} label={label} />,
  );
  cleanup = harness.cleanup;
  return harness;
}

const button = () => screen.getByRole("button");
/** Let the play promise settle, since both branches only act in a `.catch`. */
const settle = () => act(async () => {});

describe("SoundAudioButton — the control itself", () => {
  it("names the word it will play", () => {
    render({ text: "park" });
    expect(button()).toHaveAccessibleName("Play park");
  });

  it("takes a caller's label when the word alone would not explain it", () => {
    render({ text: "pen", label: "Play the target word" });
    expect(button()).toHaveAccessibleName("Play the target word");
  });

  it("cannot be pressed while the clip is still being made", () => {
    tts.loading = true;
    tts.url = null;
    render();
    expect(button()).toBeDisabled();
  });

  it("can be pressed before a clip exists, since pressing is what asks for one", () => {
    tts.url = null;
    render();
    expect(button()).toBeEnabled();
  });

  it("cannot be pressed for a word with no text", () => {
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

describe("SoundAudioButton — always the English voice", () => {
  it("forces the Azure path with the pinned English voice, whatever dialect module is active", () => {
    render({ text: "park" });
    expect(tts.asked[0]).toMatchObject({
      text: "park",
      dialect: "English",
      voice: "en-US-JennyNeural",
    });
  });

  it("asks for nothing until it is tapped", () => {
    render();
    expect(tts.asked[0].skip).toBe(true);
    expect(audios).toEqual([]);
  });

  it("asks once it is tapped", () => {
    render();
    fireEvent.click(button());
    expect(tts.asked.at(-1)).toMatchObject({ skip: false });
  });

  it("goes back to waiting when the button is reused for another word", () => {
    const { rerender } = render({ text: "pin" });
    fireEvent.click(button());
    expect(tts.asked.at(-1)?.skip).toBe(false);

    rerender(<SoundAudioButton text="bin" />);
    expect(tts.asked.at(-1)).toMatchObject({ text: "bin", skip: true });
  });

  it("still autoplays without waiting for a tap", () => {
    render({ autoplay: true });
    expect(tts.asked[0].skip).toBe(false);
  });
});

describe("SoundAudioButton — playing on demand", () => {
  it("plays the clip when tapped", async () => {
    render();
    fireEvent.click(button());
    await settle();

    expect(audios).toHaveLength(1);
    expect(audios[0].src).toBe("blob:sound-audio");
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

  it("cuts the previous clip off when tapped again", async () => {
    render();
    fireEvent.click(button());
    await settle();
    fireEvent.click(button());
    await settle();

    expect(audios).toHaveLength(2);
    expect(audios[0].pause).toHaveBeenCalledTimes(1);
    expect(audios[1].play).toHaveBeenCalledTimes(1);
  });
});

describe("SoundAudioButton — playing on arrival", () => {
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

  it("autoplays a word only once", async () => {
    const { rerender } = render({ autoplay: true, text: "pen" });
    await settle();
    rerender(<SoundAudioButton text="pen" autoplay />);
    await settle();

    expect(audios).toHaveLength(1);
  });

  it("autoplays again when the word changes", async () => {
    const { rerender } = render({ autoplay: true, text: "pen" });
    await settle();

    tts.url = "blob:next-word";
    rerender(<SoundAudioButton text="park" autoplay />);
    await settle();

    expect(audios).toHaveLength(2);
    expect(audios[1].src).toBe("blob:next-word");
  });

  it("swallows a browser that blocks unprompted audio", async () => {
    playRejects = true;
    render({ autoplay: true });
    await settle();

    expect(audios[0].play).toHaveBeenCalled();
  });
});

describe("SoundAudioButton — leaving the page", () => {
  it("stops playing once the button is gone", async () => {
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
