import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { LiveVoicePanel } from "./LiveVoicePanel";
import type { LiveStatus } from "@/hooks/useOpenAIRealtime";

/**
 * The voice call in the Conversation Simulator.
 *
 * There is no push-to-talk: once the call is live the mic is hot, which is the
 * only arrangement that produces a conversation rather than a walkie-talkie
 * exchange. That makes two things load-bearing. The status line has to say at
 * all times whether the mic is listening — a learner who thinks they are muted
 * and is not has a real privacy problem — and leaving has to actually tear the
 * connection down, not just navigate away from it.
 *
 * The realtime plumbing is `useOpenAIRealtime`'s job and has its own tests, so
 * it stands in here and this file is about what the panel does with it.
 */

interface Turn {
  role: "user" | "assistant";
  text: string;
  partial?: boolean;
  hasDialectDrift?: boolean;
}

const live = vi.hoisted(() => ({
  status: "live" as LiveStatus,
  error: null as string | null,
  turns: [] as Turn[],
  muted: false,
  setMuted: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onTurnFinalized: undefined as ((turn: Turn) => void) | undefined,
}));

vi.mock("@/hooks/useOpenAIRealtime", () => ({
  useOpenAIRealtime: (opts: { onTurnFinalized?: (turn: Turn) => void } = {}) => {
    live.onTurnFinalized = opts.onTurnFinalized;
    return {
      status: live.status,
      error: live.error,
      turns: live.turns,
      muted: live.muted,
      setMuted: live.setMuted,
      start: live.start,
      stop: live.stop,
    };
  },
}));

let cleanup: (() => void) | undefined;

beforeEach(() => {
  live.status = "live";
  live.error = null;
  live.turns = [];
  live.muted = false;
  live.setMuted.mockReset();
  live.start.mockReset();
  live.stop.mockReset();
  live.onTurnFinalized = undefined;
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  dialect?: string;
  difficulty?: string;
  topicHint?: string;
}

function render({ dialect = "Gulf", difficulty = "beginner", topicHint }: Options = {}) {
  const onExitLive = vi.fn();
  const onTurnFinalized = vi.fn();
  const harness = renderWithProviders(
    <LiveVoicePanel
      dialect={dialect}
      difficulty={difficulty}
      topicHint={topicHint}
      onTurnFinalized={onTurnFinalized}
      onExitLive={onExitLive}
    />,
    { persona: "free" },
  );
  cleanup = harness.cleanup;
  return { ...harness, onExitLive, onTurnFinalized };
}

/**
 * The tutor's turns render through TappableEnglishText, which settles its own
 * display preferences a tick after mounting. Without this the update lands in a
 * tree the test has finished with and React reports it as outside act().
 */
const settleTurns = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const micButton = () => screen.getByRole("button", { name: /^(كتم الميكروفون|إلغاء الكتم)$/ });
const endButton = () => screen.getByRole("button", { name: "إنهاء المكالمة" });

describe("opening the call", () => {
  it("dials out as soon as the panel appears", () => {
    render({ dialect: "Egyptian", difficulty: "advanced", topicHint: "at the pharmacy" });

    // No connect button: the panel *is* the call, so anything else would be a
    // second tap between the learner and the conversation they asked for.
    expect(live.start).toHaveBeenCalledWith({
      dialect: "Egyptian",
      difficulty: "advanced",
      topicHint: "at the pharmacy",
    });
  });

  it("dials out without a topic when none was chosen", () => {
    render();

    expect(live.start).toHaveBeenCalledWith({
      dialect: "Gulf",
      difficulty: "beginner",
      topicHint: undefined,
    });
  });

  it("hangs up when the panel goes away", () => {
    const { unmount } = render();

    unmount();

    // A live microphone surviving the panel that owns it is the worst failure
    // this component has.
    expect(live.stop).toHaveBeenCalled();
  });

  it("passes finalised turns back to the chat log", () => {
    const { onTurnFinalized } = render();

    live.onTurnFinalized?.({ role: "assistant", text: "شلونك؟" });

    // The saved transcript is the record of the lesson; a call whose turns never
    // reach it teaches nothing that can be reviewed later.
    expect(onTurnFinalized).toHaveBeenCalledWith({ role: "assistant", text: "شلونك؟" });
  });

  it("names the dialect being spoken", () => {
    render({ dialect: "Yemeni" });

    expect(screen.getByText("مكالمة مباشرة • Yemeni")).toBeInTheDocument();
  });
});

describe("saying what the mic is doing", () => {
  it.each([
    ["connecting", "جارٍ الاتصال…"],
    ["live", "أستمع إليك"],
    ["ending", "جارٍ الإنهاء…"],
    ["error", "انقطع الاتصال"],
    ["idle", "في الانتظار"],
  ] as const)("reads %s as %s", (status, label) => {
    live.status = status;
    render();

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("says the mic is muted rather than listening once it is off", () => {
    live.muted = true;
    render();

    // The single most important word on the panel: it is the learner's only
    // evidence about whether the room is being heard.
    expect(screen.getByText("الميكروفون مكتوم")).toBeInTheDocument();
    expect(screen.queryByText("أستمع إليك")).toBeNull();
  });

  it("pulses while it is actually listening", () => {
    render();

    expect(document.querySelector(".lucide-radio")!.getAttribute("class")).toContain(
      "animate-pulse",
    );
  });

  it("stops pulsing when muted", () => {
    live.muted = true;
    render();

    // A pulsing indicator over "الميكروفون مكتوم" is worse than no indicator.
    const radio = document.querySelector(".lucide-radio")!.getAttribute("class")!;
    expect(radio).not.toContain("animate-pulse");
    expect(radio).toContain("text-muted-foreground");
  });

  it("spins while connecting and warns when the call dropped", () => {
    live.status = "connecting";
    const { rerender } = render();
    expect(document.querySelector(".lucide-loader-circle")).not.toBeNull();

    live.status = "error";
    rerender(
      <LiveVoicePanel dialect="Gulf" difficulty="beginner" onExitLive={vi.fn()} />,
    );

    expect(document.querySelector(".lucide-circle-alert")).not.toBeNull();
  });

  it("shows what went wrong", () => {
    live.status = "error";
    live.error = "Microphone permission denied";
    render();

    // "انقطع الاتصال" alone leaves the learner retrying a call that will fail the
    // same way every time.
    expect(screen.getByText("Microphone permission denied")).toBeInTheDocument();
  });

  it("says where the call works best", () => {
    render();

    // WebRTC support is uneven and a silent failure on an unsupported browser
    // reads as the feature being broken.
    expect(screen.getByText(/الأفضل على Chrome أو Edge/)).toBeInTheDocument();
  });
});

describe("the empty transcript", () => {
  it("invites the learner to speak once the call is up", () => {
    render();

    expect(screen.getByText("ابدأ الكلام بالإنجليزية…")).toBeInTheDocument();
  });

  it("says it is still dialling", () => {
    live.status = "connecting";
    render();

    expect(screen.getByText("جارٍ تجهيز المكالمة…")).toBeInTheDocument();
  });

  it("offers the way out when the call is not going to happen", () => {
    live.status = "error";
    render();

    // Silence with no instruction is where a learner sits and waits for a call
    // that already failed.
    expect(screen.getByText("اضغط «إنهاء المكالمة» للخروج.")).toBeInTheDocument();
  });
});

describe("the transcript", () => {
  it("attributes each turn", async () => {
    live.turns = [
      { role: "user", text: "مرحبا" },
      { role: "assistant", text: "أهلا وسهلا" },
    ];
    render();

    expect(screen.getByText("أنت")).toBeInTheDocument();
    expect(screen.getByText("المعلّم")).toBeInTheDocument();
    expect(screen.queryByText("ابدأ الكلام بالإنجليزية…")).toBeNull();
    await settleTurns();
  });

  it("fades a turn that is still being transcribed", () => {
    live.turns = [{ role: "user", text: "أنا أريد", partial: true }];
    render();

    // Partial text changes under the learner's eyes; showing it at full weight
    // makes a half-heard sentence look like a finished one.
    expect(screen.getByText("أنا أريد").closest("div.rounded-lg")!.className).toContain(
      "opacity-70",
    );
  });

  it("marks the tutor's turn when it slipped out of English", async () => {
    live.turns = [{ role: "assistant", text: "ماذا تريد", hasDialectDrift: true }];
    render();

    // The whole product is dialect. A tutor answering in MSA without saying so
    // teaches the learner the wrong register and they cannot tell.
    expect(screen.getByText("خرج عن الإنجليزي")).toBeInTheDocument();
    await settleTurns();
  });

  it("does not badge the learner's own turns", () => {
    live.turns = [{ role: "user", text: "ماذا تريد", hasDialectDrift: true }];
    render();

    // Drift is a fault in the tutor's output, not in the learner's speech.
    expect(screen.queryByText("خرج عن الإنجليزي")).toBeNull();
  });

  it("makes the tutor's English tappable but leaves the learner's alone", async () => {
    live.turns = [
      { role: "assistant", text: "hello" },
      { role: "user", text: "hi there" },
    ];
    render();

    // Looking a word up is what turns a call into a lesson — and it is only
    // useful on the English being taught, not on what the learner already said.
    expect(screen.getByRole("button", { name: /hello/ })).toBeInTheDocument();
    expect(screen.getByText("hi there").getAttribute("dir")).toBe("auto");
    await settleTurns();
  });
});

describe("the controls", () => {
  it("mutes and unmutes", () => {
    const { rerender } = render();

    fireEvent.click(micButton());
    expect(live.setMuted).toHaveBeenCalledWith(true);

    live.muted = true;
    rerender(
      <LiveVoicePanel dialect="Gulf" difficulty="beginner" onExitLive={vi.fn()} />,
    );
    fireEvent.click(micButton());
    expect(live.setMuted).toHaveBeenLastCalledWith(false);
  });

  it("shows a crossed-out mic while muted", () => {
    live.muted = true;
    render();

    expect(document.querySelector(".lucide-mic-off")).not.toBeNull();
    expect(micButton()).toHaveAccessibleName("إلغاء الكتم");
  });

  it("will not let the mic be toggled before the call is up", () => {
    live.status = "connecting";
    render();

    // Muting a connection that has not opened yet would leave the panel saying
    // "الميكروفون مكتوم" over a call that then starts unmuted.
    expect(micButton()).toBeDisabled();
  });

  it.each(["connecting", "ending", "error", "idle"] as const)(
    "keeps the mic locked while %s",
    (status) => {
      live.status = status;
      render();

      expect(micButton()).toBeDisabled();
    },
  );

  it("hangs up and leaves", () => {
    const { onExitLive } = render();

    fireEvent.click(endButton());

    // Both, in that order: navigating away without stopping leaves the mic open.
    expect(live.stop).toHaveBeenCalled();
    expect(onExitLive).toHaveBeenCalled();
  });

  it("can still be left when the call already failed", () => {
    live.status = "error";
    const { onExitLive } = render();

    // The one control that must never be disabled.
    expect(endButton()).toBeEnabled();
    fireEvent.click(endButton());
    expect(onExitLive).toHaveBeenCalled();
  });
});
