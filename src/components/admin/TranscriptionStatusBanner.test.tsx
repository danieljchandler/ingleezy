import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionJob } from "@/contexts/TranscriptionJobContext";
import { TranscriptionStatusBanner } from "./TranscriptionStatusBanner";

/**
 * The floating status card for a background transcription.
 *
 * Transcribing a video takes minutes on a server, so the admin is free to walk
 * away from the form while it runs — which means something has to follow them
 * around and say what is happening. It shows while a job is running, replaces
 * itself with a red card if the job fails, and disappears the moment the job
 * completes, because at that point the form itself has the result.
 */

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

const context = vi.hoisted(() => ({
  job: null as TranscriptionJob | null,
  clearJob: vi.fn(),
}));
vi.mock("@/contexts/TranscriptionJobContext", () => ({
  useTranscriptionJob: () => context,
}));

beforeEach(() => {
  navigate.mockReset();
  context.clearJob.mockReset();
  context.job = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

const aJob = (over: Partial<TranscriptionJob> = {}): TranscriptionJob => ({
  id: "job-1",
  videoId: "video-1",
  status: "running",
  progress: 42,
  progressLabel: "Transcribing audio…",
  startedAt: Date.now(),
  ...over,
});

function renderBanner(job: TranscriptionJob | null) {
  context.job = job;
  return render(
    <MemoryRouter>
      <TranscriptionStatusBanner />
    </MemoryRouter>,
  );
}

describe("TranscriptionStatusBanner — when it stays out of the way", () => {
  it("shows nothing when no job has been started", () => {
    const { container } = renderBanner(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing once the job has finished", () => {
    // The form picks the result up itself, so a "done" card would be one more
    // thing to dismiss for no reason.
    const { container } = renderBanner(aJob({ status: "complete" }));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TranscriptionStatusBanner — while a job is running", () => {
  it("says what is happening", () => {
    renderBanner(aJob());
    expect(screen.getByText("Transcribing in background")).toBeInTheDocument();
  });

  it("shows which stage the pipeline has reached", () => {
    // The stages take very different amounts of time, so the label is what
    // makes a long wait legible.
    renderBanner(aJob({ progressLabel: "Aligning word timings…" }));
    expect(screen.getByText("Aligning word timings…")).toBeInTheDocument();
  });

  it("shows how far along it is", () => {
    const { container } = renderBanner(aJob({ progress: 42 }));
    const indicator = container.querySelector<HTMLElement>("[role='progressbar'] > div")!;
    expect(indicator.style.transform).toBe("translateX(-58%)");
  });

  it("spins while it works", () => {
    const { container } = renderBanner(aJob());
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("offers the way back to the video being transcribed", () => {
    renderBanner(aJob({ videoId: "abc-123" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to form" }));
    expect(navigate).toHaveBeenCalledWith("/admin/videos/abc-123/edit");
  });

  it("goes to the new-video form when the job has no video yet", () => {
    // A transcription can be started before the video row exists; sending the
    // admin to /edit of nothing would 404.
    renderBanner(aJob({ videoId: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "Return to form" }));
    expect(navigate).toHaveBeenCalledWith("/admin/videos/new");
  });

  it("stays out of the page flow", () => {
    // Fixed and bottom-right: the admin keeps working on whatever is behind it.
    const { container } = renderBanner(aJob());
    expect(container.querySelector(".fixed")).toBeInTheDocument();
  });

  it("offers to hide the banner rather than claiming to cancel the job", () => {
    // The button was labelled "Cancel job" and its only action is clearJob(),
    // which drops the local record. The pipeline runs in the
    // process-approved-video edge function and knows nothing about the click:
    // it keeps going, keeps spending, and eventually writes its result to a
    // video the admin believed they had cancelled — and since this banner is
    // the only handle on that job, they had made it invisible instead.
    renderBanner(aJob());
    expect(screen.queryByRole("button", { name: "Cancel job" })).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Hide" });
    expect(button).toHaveAttribute(
      "title",
      "Hide this banner — the transcription keeps running",
    );

    fireEvent.click(button);

    expect(context.clearJob).toHaveBeenCalledTimes(1);
    // Still nothing that stops the work — that needs an endpoint which does not
    // exist yet. The label no longer claims otherwise.
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("TranscriptionStatusBanner — when a job fails", () => {
  const failed = () => aJob({ status: "error", error: "ASR upstream timed out" });

  it("says so", () => {
    renderBanner(failed());
    expect(screen.getByText("Transcription failed")).toBeInTheDocument();
  });

  it("shows what went wrong", () => {
    // The admin's next move depends entirely on this: a timeout means retry, a
    // rejected format means re-encode.
    renderBanner(failed());
    expect(screen.getByText("ASR upstream timed out")).toBeInTheDocument();
  });

  it("copes with a failure that carried no message", () => {
    renderBanner(aJob({ status: "error" }));
    expect(screen.getByText("Transcription failed")).toBeInTheDocument();
  });

  it("uses the destructive colour rather than the neutral card", () => {
    const { container } = renderBanner(failed());
    expect(container.querySelector(".bg-destructive")).toBeInTheDocument();
  });

  it("waits to be dismissed rather than vanishing", () => {
    // A failure the admin never saw is a video that silently never got a
    // transcript.
    renderBanner(failed());
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("clears the job when dismissed", () => {
    renderBanner(failed());
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(context.clearJob).toHaveBeenCalledTimes(1);
  });

  it("offers no progress or return link", () => {
    const { container } = renderBanner(failed());
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(screen.queryByRole("button", { name: "Return to form" })).not.toBeInTheDocument();
  });
});
