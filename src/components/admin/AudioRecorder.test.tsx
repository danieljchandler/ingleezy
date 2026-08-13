import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { AudioRecorder } from "./AudioRecorder";

/**
 * Recording a flashcard's audio from inside the admin word form.
 *
 * Most cards get their audio from a native clip or from speech synthesis. This
 * is the fallback for the rest: somebody with the right accent sits down and
 * says the word. That makes the preview the important part — an admin recording
 * fifty words needs to hear each one back before it is attached to a card,
 * because a card with the wrong audio is worse than a card with none.
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }),
  toast,
}));

const tracks = vi.hoisted(() => ({ stop: vi.fn() }));
const media = vi.hoisted(() => ({ getUserMedia: vi.fn() }));

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state = "inactive";

  constructor(
    public stream: MediaStream,
    public options?: MediaRecorderOptions,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number) {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(16)], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;
const pause = HTMLMediaElement.prototype.pause as ReturnType<typeof vi.fn>;

let audios: HTMLAudioElement[] = [];
let cleanup: (() => void) | undefined;

beforeEach(() => {
  toast.mockReset();
  tracks.stop.mockReset();
  audios = [];
  play.mockClear();
  pause.mockClear();
  FakeMediaRecorder.instances = [];

  media.getUserMedia.mockReset().mockResolvedValue({
    getTracks: () => [tracks],
  } as unknown as MediaStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: media.getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

  const RealAudio = window.Audio;
  vi.stubGlobal(
    "Audio",
    class extends RealAudio {
      constructor(src?: string) {
        super(src);
        audios.push(this as unknown as HTMLAudioElement);
      }
    },
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const harness = renderWithProviders(<AudioRecorder onSave={onSave} onCancel={onCancel} />, {
    persona: "admin",
  });
  cleanup = harness.cleanup;
  return { ...harness, onSave, onCancel };
}

const buttonsIn = (container: HTMLElement) => Array.from(container.querySelectorAll("button"));
const iconButton = (container: HTMLElement, icon: string) =>
  buttonsIn(container).find((b) => b.querySelector(`.lucide-${icon}`))!;

const startRecording = async (container: HTMLElement) => {
  await act(async () => {
    fireEvent.click(iconButton(container, "mic"));
  });
};

const stopRecording = (container: HTMLElement) => {
  fireEvent.click(iconButton(container, "square"));
};

describe("before anything is recorded", () => {
  it("waits at zero with an invitation to start", () => {
    const { container } = render();

    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("Click to start recording")).toBeInTheDocument();
    expect(iconButton(container, "mic")).toBeInTheDocument();
  });

  it("can be abandoned without recording anything", () => {
    const { onCancel } = render();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("recording", () => {
  it("asks for the microphone and starts capturing", async () => {
    const { container } = render();

    await startRecording(container);

    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByText("Recording... Click to stop")).toBeInTheDocument();
    // A timeslice, so that a long recording is not held as one growing chunk.
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");
  });

  it("counts the seconds as they pass", async () => {
    vi.useFakeTimers();
    const { container } = render();
    await startRecording(container);

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    // Whoever is recording needs to know how long they have been talking; the
    // cards are meant to be one word.
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("says so plainly when the microphone is refused", async () => {
    media.getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { container } = render();

    await startRecording(container);

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Microphone access denied" }),
    );
    // And stays on the start button rather than pretending to record.
    expect(screen.getByText("Click to start recording")).toBeInTheDocument();
  });

  it("releases the microphone when the recording stops", async () => {
    const { container } = render();
    await startRecording(container);

    stopRecording(container);

    // A browser tab that keeps showing the recording indicator after the admin
    // has finished is the kind of thing that gets an app uninstalled.
    expect(tracks.stop).toHaveBeenCalled();
  });
});

describe("previewing the take", () => {
  const recordSomething = async () => {
    const harness = render();
    await startRecording(harness.container);
    stopRecording(harness.container);
    return harness;
  };

  it("offers playback rather than saving blind", async () => {
    const { container } = await recordSomething();

    // The whole reason this screen exists: a card with the wrong audio on it is
    // worse than a card with none.
    expect(screen.getByText("Preview your recording before saving")).toBeInTheDocument();
    expect(iconButton(container, "play")).toBeInTheDocument();
  });

  it("plays the take back", async () => {
    const { container } = await recordSomething();

    fireEvent.click(iconButton(container, "play"));

    expect(play).toHaveBeenCalled();
    expect(iconButton(container, "pause")).toBeInTheDocument();
  });

  it("pauses on a second press", async () => {
    const { container } = await recordSomething();
    fireEvent.click(iconButton(container, "play"));
    pause.mockClear();

    fireEvent.click(iconButton(container, "pause"));

    expect(pause).toHaveBeenCalled();
  });

  it("shows how far through the playback is", async () => {
    const { container } = await recordSomething();
    fireEvent.click(iconButton(container, "play"));

    audios[0].currentTime = 3;
    act(() => {
      audios[0].dispatchEvent(new Event("timeupdate"));
    });

    expect(screen.getByText("0:03")).toBeInTheDocument();
  });

  it("goes back to the beginning at the end of the take", async () => {
    const { container } = await recordSomething();
    fireEvent.click(iconButton(container, "play"));

    act(() => {
      audios[0].dispatchEvent(new Event("ended"));
    });

    expect(iconButton(container, "play")).toBeInTheDocument();
  });

  it("throws the take away and starts over", async () => {
    const { container } = await recordSomething();

    fireEvent.click(iconButton(container, "rotate-ccw"));

    // Re-recording is the common case — the first take usually has a door or a
    // breath in it.
    expect(screen.getByText("Click to start recording")).toBeInTheDocument();
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });
});

describe("saving", () => {
  const recordSomething = async () => {
    const harness = render();
    await startRecording(harness.container);
    stopRecording(harness.container);
    return harness;
  };

  it("uploads the take and hands back a URL for the card", async () => {
    const { backend, onSave } = await recordSomething();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save recording/i }));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(backend.uploads().some((key) => key.endsWith(".webm"))).toBe(true);
    expect(onSave.mock.calls[0][0]).toContain(".webm");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Recording saved!" }));
  });

  it("keeps the take when the upload fails", async () => {
    const harness = await recordSomething();
    const supabaseFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const href =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (href.includes("/storage/v1/")) {
          return new Response(JSON.stringify({ message: "bucket full" }), { status: 500 });
        }
        return supabaseFetch(input, init);
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save recording/i }));
    });

    // Losing the recording as well as the upload would mean saying the word
    // again for nothing.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Upload failed" })),
    );
    expect(harness.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save recording/i })).toBeEnabled();
  });

  it("can be abandoned after recording", async () => {
    const { onCancel } = await recordSomething();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("leaving the screen", () => {
  it("releases the microphone if the form closes mid-recording", async () => {
    const { container, unmount } = render();
    await startRecording(container);

    unmount();

    expect(tracks.stop).toHaveBeenCalled();
  });
});
