import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { AudioUploader } from "./AudioUploader";

/**
 * The audio field on an admin word form: record it, or upload a file you
 * already have.
 *
 * Both routes exist because both happen. A word being added from a native
 * speaker's session already has a file; a word being added at a desk needs the
 * microphone. Whichever it is, the field's job is to end up holding one URL and
 * to make it easy to throw away a bad take and try the other way.
 *
 * The validation is the interesting part. Nothing stops an admin picking a PDF
 * or a fifty-megabyte WAV, and either would fail somewhere far away from the
 * form — so both are refused here, where the person who chose the file is still
 * looking at it.
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }),
  toast,
}));

// The recorder is a screen of its own with its own tests. Standing in for it
// keeps this file about the field that owns it.
const recorder = vi.hoisted(() => ({ onSave: null as null | ((url: string) => void) }));
vi.mock("./AudioRecorder", () => ({
  AudioRecorder: ({ onSave, onCancel }: { onSave: (url: string) => void; onCancel: () => void }) => {
    recorder.onSave = onSave;
    return (
      <div data-testid="recorder">
        <button onClick={onCancel}>cancel recording</button>
      </div>
    );
  },
}));

const play = HTMLMediaElement.prototype.play as ReturnType<typeof vi.fn>;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toast.mockReset();
  play.mockClear();
  recorder.onSave = null;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(currentUrl: string | null = null) {
  const onUpload = vi.fn();
  const onRemove = vi.fn();
  const harness = renderWithProviders(
    <AudioUploader currentUrl={currentUrl} onUpload={onUpload} onRemove={onRemove} />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onUpload, onRemove };
}

const fileInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="file"]')!;

const aFile = (name: string, type: string, size = 1024) => {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const choose = async (container: HTMLElement, file: File) => {
  await act(async () => {
    fireEvent.change(fileInput(container), { target: { files: [file] } });
  });
};

describe("with nothing on the field yet", () => {
  it("offers both ways of getting audio", () => {
    render();

    // A native speaker's session arrives as files; a word added at a desk needs
    // the microphone. Neither is the odd one out.
    expect(screen.getByText("Record Audio")).toBeInTheDocument();
    expect(screen.getByText("Upload audio file")).toBeInTheDocument();
  });

  it("says what it will take", () => {
    render();

    expect(screen.getByText("MP3, WAV up to 10MB")).toBeInTheDocument();
  });
});

describe("uploading a file", () => {
  it("stores it and hands the form a URL", async () => {
    const { container, backend, onUpload } = render();

    await choose(container, aFile("souq.mp3", "audio/mpeg"));

    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    expect(backend.uploads().some((key) => key.endsWith(".mp3"))).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Audio uploaded!" }));
  });

  it("keeps the file's own extension", async () => {
    const { container, backend } = render();

    await choose(container, aFile("souq.wav", "audio/wav"));

    // The stored name is a UUID, so the extension is the only thing left saying
    // what the file actually is.
    await waitFor(() => expect(backend.uploads()).toHaveLength(1));
    expect(backend.uploads()[0]).toMatch(/\.wav$/);
  });

  it("refuses something that is not audio", async () => {
    const { container, backend, onUpload } = render();

    await choose(container, aFile("lesson.pdf", "application/pdf"));

    // Caught here, where the person who picked the file is still looking at it,
    // rather than as a broken player weeks later.
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid file" }));
    expect(backend.uploads()).toEqual([]);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("refuses a file too big to be one word", async () => {
    const { container, backend } = render();

    await choose(container, aFile("album.wav", "audio/wav", 11 * 1024 * 1024));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "File too large" }));
    expect(backend.uploads()).toEqual([]);
  });

  it("takes a file's whole name as its extension when it has none", async () => {
    const { container, backend } = render();

    await choose(container, aFile("recording", "audio/wav"));

    // Pinned: the extension is `name.split(".").pop()`, which on a name with no
    // dot returns the name. The object is stored as "<uuid>.recording", so
    // nothing downstream can tell what format it is.
    await waitFor(() => expect(backend.uploads()).toHaveLength(1));
    expect(backend.uploads()[0]).toMatch(/\.recording$/);
  });

  it("says so and keeps the field empty when the upload fails", async () => {
    const { container, onUpload } = render();
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

    await choose(container, aFile("souq.mp3", "audio/mpeg"));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Upload failed" })),
    );
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText("Upload audio file")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("once there is audio", () => {
  it("shows the existing file the form arrived with", () => {
    render("https://audio.test/existing.mp3");

    // Editing a word that already has audio must not look like a word that has
    // none, or an admin re-records what was already there.
    expect(screen.getByText("Audio file uploaded")).toBeInTheDocument();
    expect(screen.queryByText("Record Audio")).toBeNull();
  });

  it("previews it", () => {
    const { container } = render("https://audio.test/existing.mp3");

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.querySelector(".lucide-volume2") !== null,
      )!,
    );

    // Checking the audio is right before saving the word is the only reason to
    // keep a preview on a field at all.
    expect(play).toHaveBeenCalled();
  });

  it("throws it away", () => {
    const { container, onRemove } = render("https://audio.test/existing.mp3");

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.querySelector(".lucide-x") !== null,
      )!,
    );

    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByText("Record Audio")).toBeInTheDocument();
  });

  it("lets the same file be chosen again after removing it", async () => {
    const { container, backend } = render();
    await choose(container, aFile("souq.mp3", "audio/mpeg"));
    await waitFor(() => expect(backend.uploads()).toHaveLength(1));

    fireEvent.click(
      Array.from(container.querySelectorAll("button")).find(
        (b) => b.querySelector(".lucide-x") !== null,
      )!,
    );

    // The input is cleared on removal. Without that, re-picking the file the
    // admin just deleted fires no change event and nothing happens.
    expect(fileInput(container).value).toBe("");
  });
});

describe("recording instead", () => {
  it("opens the recorder", () => {
    render();

    fireEvent.click(screen.getByText("Record Audio"));

    expect(screen.getByTestId("recorder")).toBeInTheDocument();
  });

  it("comes back with both options when the recording is abandoned", () => {
    render();
    fireEvent.click(screen.getByText("Record Audio"));

    fireEvent.click(screen.getByRole("button", { name: /cancel recording/i }));

    expect(screen.queryByTestId("recorder")).toBeNull();
    expect(screen.getByText("Record Audio")).toBeInTheDocument();
  });

  it("adopts a finished recording as the field's audio", () => {
    const { onUpload } = render();
    fireEvent.click(screen.getByText("Record Audio"));

    act(() => {
      recorder.onSave?.("https://audio.test/recorded.webm");
    });

    // The two routes converge: whichever produced it, the field ends up holding
    // one URL and looking the same.
    expect(onUpload).toHaveBeenCalledWith("https://audio.test/recorded.webm");
    expect(screen.getByText("Audio file uploaded")).toBeInTheDocument();
    expect(screen.queryByTestId("recorder")).toBeNull();
  });
});
