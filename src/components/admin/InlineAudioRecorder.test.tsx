import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { InlineAudioRecorder } from "./InlineAudioRecorder";

/**
 * Recording a word's audio without leaving the row you are editing.
 *
 * The standalone recorder is a screen; this is a strip that replaces one field
 * while an admin is part-way through a form. That difference drives everything:
 * it starts recording the moment it appears, because an admin who clicked the
 * microphone has already decided, and a second "start" click would be one more
 * thing between them and the fifty words still to do.
 *
 * It also means giving up has to be free. The cross is on both faces of it, and
 * a refused microphone dismisses the strip rather than leaving a dead control
 * sitting in the form.
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

async function render() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  let harness!: ReturnType<typeof renderWithProviders>;
  // It starts recording on mount, so the mount itself is async.
  await act(async () => {
    harness = renderWithProviders(<InlineAudioRecorder onSave={onSave} onCancel={onCancel} />, {
      persona: "admin",
    });
  });
  cleanup = harness.cleanup;
  return { ...harness, onSave, onCancel };
}

const stop = () => fireEvent.click(screen.getByRole("button", { name: /stop/i }));
const crossButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.querySelector(".lucide-x") !== null,
  )!;

describe("appearing", () => {
  it("starts recording without waiting to be told twice", async () => {
    await render();

    // The admin already pressed the microphone in the row above. Asking again
    // is a step, and there are fifty words to get through.
    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("counts the seconds while it listens", async () => {
    vi.useFakeTimers();
    await render();

    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("gives up the row when the microphone is refused", async () => {
    media.getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    const { onCancel } = await render();

    // A strip that cannot record is worse than no strip: it sits in the middle
    // of the form with nothing it can do.
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Microphone access denied" }),
    );
    expect(onCancel).toHaveBeenCalled();
  });

  it("can be abandoned mid-recording", async () => {
    const { container, onCancel } = await render();

    fireEvent.click(crossButton(container));

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("after stopping", () => {
  const recorded = async () => {
    const harness = await render();
    stop();
    return harness;
  };

  it("releases the microphone", async () => {
    await recorded();

    expect(tracks.stop).toHaveBeenCalled();
  });

  it("offers playback, a redo and a save", async () => {
    await recorded();

    expect(screen.getByRole("button", { name: /redo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop/i })).toBeNull();
  });

  it("keeps the length of what was recorded on screen", async () => {
    vi.useFakeTimers();
    const harness = await render();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    stop();
    cleanup = harness.cleanup;

    // The admin is deciding whether this take is worth keeping, and a
    // half-second recording is usually a misfire.
    expect(screen.getByText("0:03")).toBeInTheDocument();
  });

  it("plays the take back", async () => {
    const { container } = await recorded();

    fireEvent.click(container.querySelector<HTMLElement>("button:has(.lucide-play)")!);

    expect(play).toHaveBeenCalled();
  });

  it("pauses on a second press without ever saying it was playing", async () => {
    const { container } = await recorded();
    const playButton = container.querySelector<HTMLElement>("button:has(.lucide-play)")!;
    fireEvent.click(playButton);
    pause.mockClear();

    fireEvent.click(playButton);

    // Pinned: the icon is hard-coded to a play triangle, so the button looks
    // identical whether or not audio is running. The second press does pause
    // it — the admin just has no way to know that is what it will do.
    expect(pause).toHaveBeenCalled();
    expect(container.querySelector(".lucide-pause")).toBeNull();
  });

  it("throws the take away and records again", async () => {
    await recorded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /redo/i }));
    });

    // The first take usually has a door or a breath in it.
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("can be abandoned after recording", async () => {
    const { container, onCancel } = await recorded();

    fireEvent.click(crossButton(container));

    expect(onCancel).toHaveBeenCalled();
  });
});

describe("saving", () => {
  const recorded = async () => {
    const harness = await render();
    stop();
    return harness;
  };

  it("uploads the take and hands the field a URL", async () => {
    const { backend, onSave } = await recorded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(backend.uploads().some((key) => key.endsWith(".webm"))).toBe(true);
    expect(onSave.mock.calls[0][0]).toContain(".webm");
  });

  it("keeps the take when the upload fails", async () => {
    const harness = await recorded();
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
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });

    // Saying the word again for nothing is the one outcome worth avoiding here.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Upload failed" })),
    );
    expect(harness.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });
});

describe("leaving the form", () => {
  it("releases the microphone if the row closes mid-recording", async () => {
    const { unmount } = await render();

    unmount();

    expect(tracks.stop).toHaveBeenCalled();
  });
});
