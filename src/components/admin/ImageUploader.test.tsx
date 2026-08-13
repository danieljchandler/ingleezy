import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { ImageUploader } from "./ImageUploader";

/**
 * The image field on an admin flashcard form.
 *
 * Every picture that reaches a learner goes through here, and it is resized on
 * the way rather than on the way out: the cards are a fixed 4:3, so an
 * unresized upload would either be cropped by CSS at display time or ship a
 * multi-megabyte original to a phone. The resize letterboxes instead of
 * cropping — an admin who chose a picture should get the picture they chose,
 * not the middle of it — and fills the bars with the app's sand colour so the
 * letterboxing reads as a mat rather than a mistake.
 *
 * jsdom has neither an image decoder nor a canvas, so both are stood in for
 * here. The stubs record what they were asked to draw, which is what the resize
 * arithmetic is asserted against.
 */

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }),
  toast,
}));

/** Images the component created, newest last, with their load callbacks exposed. */
interface FakeImage {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  width: number;
  height: number;
  src: string;
}
let images: FakeImage[] = [];

/** Canvases the component asked for a context on, so their size is assertable. */
let canvases: HTMLCanvasElement[];
let ctx: {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
} | null;
let toBlobCalls: Array<[BlobCallback, string | undefined, number | undefined]>;
/** What toBlob hands back — null models a canvas that could not encode. */
let encoded: Blob | null;
let objectUrls: string[];
let revoked: string[];

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toast.mockReset();
  images = [];
  toBlobCalls = [];
  canvases = [];
  objectUrls = [];
  revoked = [];
  encoded = new Blob([new Uint8Array(64)], { type: "image/jpeg" });

  ctx = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };

  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      // A 16:9 source by default: wider than 4:3, so the common case is the
      // letterbox-top-and-bottom branch.
      width = 1600;
      height = 900;
      src = "";
      constructor() {
        images.push(this as unknown as FakeImage);
      }
    },
  );

  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:fake/${objectUrls.length}`;
    objectUrls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvases.push(this);
    return ctx as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback: BlobCallback, type?: string, quality?: number) => {
      toBlobCalls.push([callback, type, quality]);
      callback(encoded);
    },
  );
});

afterEach(async () => {
  // supabase-js resolves the session on a macrotask before it uploads. Left
  // pending, that request lands after the harness has restored the real fetch
  // and goes out to the network for real — which the hermeticity guard would be
  // right to fail on.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Before `cleanup`, so unwinding the fetch stub hands control back to the
  // harness backend rather than the other way round.
  vi.unstubAllGlobals();
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

interface Options {
  currentUrl?: string | null;
  /** Make the storage bucket reject the upload. */
  failStorage?: boolean;
}

/**
 * Flipped rather than re-stubbed, so a test can fail one upload and then let
 * the retry through. `vi.unstubAllGlobals` would take the Image stub with it.
 */
let storageFails = false;

function render({ currentUrl = null, failStorage = false }: Options = {}) {
  const onUpload = vi.fn();
  const onRemove = vi.fn();
  const harness = renderWithProviders(
    <ImageUploader currentUrl={currentUrl} onUpload={onUpload} onRemove={onRemove} />,
    { persona: "admin" },
  );
  cleanup = harness.cleanup;

  storageFails = failStorage;
  // Captured after the render, or this wraps the real fetch rather than the
  // harness backend.
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input.toString();
      if (storageFails && href.includes("/storage/v1/object/flashcard-images")) {
        return new Response(JSON.stringify({ message: "bucket is full" }), { status: 500 });
      }
      return inner(input, init);
    }),
  );

  return { ...harness, onUpload, onRemove };
}

const fileInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="file"]')!;

const anImage = (name = "card.png", type = "image/png", size = 1024) => {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

/** Select a file. Leaves the decode pending so the busy state is observable. */
const choose = async (container: HTMLElement, file: File) => {
  await act(async () => {
    fireEvent.change(fileInput(container), { target: { files: [file] } });
  });
};

/** Let the pending decode finish (or fail), then drain the upload that follows. */
const decode = async (outcome: "load" | "error" = "load", size?: { w: number; h: number }) => {
  await act(async () => {
    const img = images.at(-1);
    if (!img) throw new Error("no image was decoded");
    if (size) {
      img.width = size.w;
      img.height = size.h;
    }
    if (outcome === "load") img.onload?.();
    else img.onerror?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const upload = async (container: HTMLElement, file = anImage(), size?: { w: number; h: number }) => {
  await choose(container, file);
  await decode("load", size);
};

describe("ImageUploader — the empty field", () => {
  it("invites an upload", () => {
    render();
    expect(screen.getByText("Click to upload image")).toBeInTheDocument();
  });

  it("says up front what will happen to the file", () => {
    // Admins have complained about "cropping" that was really letterboxing;
    // saying the target size on the empty field is cheaper than explaining it
    // afterwards.
    render();
    expect(screen.getByText("Auto-resized to 800×600 (4:3)")).toBeInTheDocument();
  });

  it("accepts only images at the picker", () => {
    const { container } = render();
    expect(fileInput(container).accept).toBe("image/*");
  });

  it("shows no preview and no remove button", () => {
    render();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ImageUploader — a field that already has a picture", () => {
  it("shows the existing image", () => {
    render({ currentUrl: "https://cdn.example/old.jpg" });
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/old.jpg");
  });

  it("replaces the upload invitation with the preview", () => {
    render({ currentUrl: "https://cdn.example/old.jpg" });
    expect(screen.queryByText("Click to upload image")).not.toBeInTheDocument();
  });

  it("offers a way to take it off", () => {
    render({ currentUrl: "https://cdn.example/old.jpg" });
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("tells the form when the picture is removed", () => {
    const { onRemove } = render({ currentUrl: "https://cdn.example/old.jpg" });
    fireEvent.click(screen.getByRole("button"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("returns to the upload invitation after a removal", () => {
    render({ currentUrl: "https://cdn.example/old.jpg" });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Click to upload image")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("clears the picker so the same file can be chosen again", () => {
    // Without this the input still holds the removed file, and re-choosing it
    // fires no change event — the field would look permanently stuck empty.
    const { container } = render({ currentUrl: "https://cdn.example/old.jpg" });
    fireEvent.click(screen.getByRole("button"));
    expect(fileInput(container).value).toBe("");
  });

  it("shows a picture that arrives after mount", () => {
    // Admin forms fetch the record they are editing, so this mounts with
    // currentUrl undefined and is handed the real URL a moment later. Reading
    // the prop only in useState left the field offering "Click to upload image"
    // over a record that already had one — so the admin uploaded a second copy
    // and orphaned the first in the bucket.
    const { rerender, onUpload, onRemove } = render({ currentUrl: null });
    rerender(
      <ImageUploader
        currentUrl="https://cdn.example/loaded-late.jpg"
        onUpload={onUpload}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.example/loaded-late.jpg",
    );
  });

  it("follows the prop when the record's picture is replaced elsewhere", () => {
    const { rerender, onUpload, onRemove } = render({
      currentUrl: "https://cdn.example/first.jpg",
    });
    rerender(
      <ImageUploader
        currentUrl="https://cdn.example/second.jpg"
        onUpload={onUpload}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/second.jpg");
  });

  it("clears the preview when the record's picture goes away", () => {
    const { rerender, onUpload, onRemove } = render({
      currentUrl: "https://cdn.example/first.jpg",
    });
    rerender(<ImageUploader currentUrl={null} onUpload={onUpload} onRemove={onRemove} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Click to upload image")).toBeInTheDocument();
  });
});

describe("ImageUploader — refusing a file", () => {
  it("refuses something that is not an image", async () => {
    const { container, backend, onUpload } = render();
    await choose(container, anImage("notes.pdf", "application/pdf"));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Invalid file", variant: "destructive" }),
    );
    expect(backend.uploads()).toEqual([]);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("refuses a file with no type at all", async () => {
    const { container, backend } = render();
    await choose(container, anImage("mystery", ""));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid file" }));
    expect(backend.uploads()).toEqual([]);
  });

  it("refuses anything over ten megabytes", async () => {
    const { container, backend } = render();
    await choose(container, anImage("huge.png", "image/png", 10 * 1024 * 1024 + 1));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "File too large", variant: "destructive" }),
    );
    expect(backend.uploads()).toEqual([]);
  });

  it("accepts a file exactly on the limit", async () => {
    const { container, backend } = render();
    await upload(container, anImage("big.png", "image/png", 10 * 1024 * 1024));

    await waitFor(() => expect(backend.uploads()).toHaveLength(1));
  });

  it("does nothing when the picker is dismissed without a file", async () => {
    const { container, backend } = render();
    await act(async () => {
      fireEvent.change(fileInput(container), { target: { files: [] } });
    });

    expect(toast).not.toHaveBeenCalled();
    expect(backend.uploads()).toEqual([]);
  });

  it("never decodes a file it refused", async () => {
    const { container } = render();
    await choose(container, anImage("notes.pdf", "application/pdf"));
    expect(images).toEqual([]);
  });
});

describe("ImageUploader — the resize", () => {
  it("always produces an 800×600 canvas", async () => {
    const { container } = render();
    await upload(container, anImage(), { w: 4000, h: 250 });

    expect(canvases[0]).toMatchObject({ width: 800, height: 600 });
    expect(ctx!.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
  });

  it("mats the canvas in the app's sand colour before drawing", async () => {
    const { container } = render();
    await upload(container);
    expect(ctx!.fillStyle).toBe("#F5F0E8");
  });

  it("fits a wide picture to the width and centres it vertically", async () => {
    // 1600×900 is 16:9. Fitted to 800 wide it is 450 tall, leaving 75px of mat
    // above and below.
    const { container } = render();
    await upload(container, anImage(), { w: 1600, h: 900 });

    expect(ctx!.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1600,
      900,
      0,
      75,
      800,
      450,
    );
  });

  it("fits a tall picture to the height and centres it horizontally", async () => {
    // 600×1200 is 1:2. Fitted to 600 tall it is 300 wide, leaving 250px of mat
    // either side.
    const { container } = render();
    await upload(container, anImage(), { w: 600, h: 1200 });

    expect(ctx!.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      600,
      1200,
      250,
      0,
      300,
      600,
    );
  });

  it("fills the frame exactly when the picture is already 4:3", async () => {
    const { container } = render();
    await upload(container, anImage(), { w: 1200, h: 900 });

    expect(ctx!.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1200,
      900,
      0,
      0,
      800,
      600,
    );
  });

  it("never crops — the whole source rectangle is drawn", async () => {
    const { container } = render();
    await upload(container, anImage(), { w: 3000, h: 100 });

    const [, sx, sy, sw, sh] = ctx!.drawImage.mock.calls[0];
    expect([sx, sy, sw, sh]).toEqual([0, 0, 3000, 100]);
  });

  it("encodes as JPEG at 90% quality", async () => {
    const { container } = render();
    await upload(container);

    expect(toBlobCalls[0][1]).toBe("image/jpeg");
    expect(toBlobCalls[0][2]).toBe(0.9);
  });
});

describe("ImageUploader — storing the result", () => {
  it("puts the resized file in the flashcard bucket", async () => {
    const { container, backend } = render();
    await upload(container);

    await waitFor(() => expect(backend.uploads()).toHaveLength(1));
    expect(backend.uploads()[0]).toMatch(/^flashcard-images\/[0-9a-f-]{36}\.jpg$/);
  });

  it("names the object after a fresh id rather than the original file", async () => {
    // Admin filenames collide constantly ("image.png"), and the original name
    // can carry a learner's or a source's identity. A UUID sidesteps both.
    const { container, backend } = render();
    await upload(container, anImage("family photo.png"));

    await waitFor(() => expect(backend.uploads()).toHaveLength(1));
    expect(backend.uploads()[0]).not.toContain("family photo");
  });

  it("hands the form the public url", async () => {
    const { container, onUpload } = render();
    await upload(container);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload.mock.calls[0][0]).toMatch(
      /\/storage\/v1\/object\/public\/flashcard-images\/[0-9a-f-]{36}\.jpg$/,
    );
  });

  it("shows the newly uploaded image straight away", async () => {
    const { container, onUpload } = render();
    await upload(container);

    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    expect(screen.getByRole("img")).toHaveAttribute("src", onUpload.mock.calls[0][0]);
  });

  it("narrates the resize and then confirms the result", async () => {
    const { container } = render();
    await upload(container);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Image uploaded and resized to 800×600!" }),
      ),
    );
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "Resizing image..." });
  });

  it("shows a spinner while the work is in flight", async () => {
    const { container } = render();
    await choose(container, anImage());

    // The decode has not been let through yet, so this is the busy state.
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("Click to upload image")).not.toBeInTheDocument();

    await decode();
  });

  it("clears the spinner once the upload lands", async () => {
    const { container, onUpload } = render();
    await upload(container);

    await waitFor(() => expect(onUpload).toHaveBeenCalled());
    expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
  });
});

describe("ImageUploader — when it goes wrong", () => {
  it("reports a bucket that refused the object", async () => {
    const { container, onUpload } = render({ failStorage: true });
    await upload(container);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Upload failed", variant: "destructive" }),
      ),
    );
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("leaves the field empty after a failed upload", async () => {
    const { container } = render({ failStorage: true });
    await upload(container);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Upload failed" })),
    );
    expect(screen.getByText("Click to upload image")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("reports a file the browser could not decode", async () => {
    const { container, backend, onUpload } = render();
    await choose(container, anImage("truncated.png"));
    await decode("error");

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Upload failed", description: "Failed to load image" }),
      ),
    );
    expect(backend.uploads()).toEqual([]);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("reports a canvas that could not encode the result", async () => {
    encoded = null;
    const { container, backend } = render();
    await upload(container);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Upload failed", description: "Failed to create blob" }),
      ),
    );
    expect(backend.uploads()).toEqual([]);
  });

  it("reports a browser with no 2D canvas at all", async () => {
    ctx = null;
    const { container } = render();
    await upload(container);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Could not get canvas context" }),
      ),
    );
  });

  it("recovers enough to accept a second attempt", async () => {
    const { container, onUpload } = render({ failStorage: true });
    await upload(container);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Upload failed" })),
    );

    storageFails = false;
    await upload(container, anImage("second.png"));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
  });

  it("releases the source blob once the resize is done", async () => {
    // Nothing revoked these before, so every original an admin touched stayed
    // pinned in memory at full size for the life of the document, on top of the
    // resized copies.
    const { container } = render();
    await upload(container);
    await upload(container, anImage("second.png"));

    expect(objectUrls).toHaveLength(2);
    expect(revoked).toEqual(objectUrls);
  });

  it("releases it even when the image cannot be decoded", async () => {
    // The failure path is the one that matters most: an admin retrying a file
    // their browser dislikes would otherwise pin a copy per attempt.
    const { container } = render();
    await choose(container, anImage("broken.png"));
    await decode("error");

    expect(objectUrls).toHaveLength(1);
    expect(revoked).toEqual(objectUrls);
  });
});
