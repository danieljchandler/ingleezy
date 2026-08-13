import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aCurriculumChatMessage,
  aCurriculumChatSession,
  chatMessageId,
  chatSessionId,
  daysAgo,
  TEST_USER_ID,
} from "@/test/support/factories";
import { useCurriculumChat } from "./useCurriculumChat";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The curriculum builder's chat — where new lessons actually get written.
 *
 * An admin describes what they want in prose, a model drafts it as structured
 * output, and the admin edits that draft before it is approved into the
 * syllabus. The conversation is persisted rather than kept in memory because a
 * lesson takes several exchanges to get right and nobody should lose that to a
 * refresh.
 *
 * Two properties matter more than the rest. The model is told the session's
 * dialect and level on every turn — a Gulf A2 lesson drafted against generic
 * Arabic is exactly the content this whole pipeline exists to prevent. And the
 * draft the admin edits is the one that gets approved, so edits are written
 * back to the message rather than held on screen.
 */

const SESSION = chatSessionId(0);

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

function render(seed: (backend: SupabaseBackend) => void = () => {}) {
  const harness = renderHookWithProviders(() => useCurriculumChat(), {
    persona: "admin",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

const aSession = (over: Record<string, unknown> = {}) =>
  aCurriculumChatSession({
    id: SESSION,
    admin_id: TEST_USER_ID,
    target_dialect: "Gulf",
    target_cefr: "A2",
    llm_model: "google/gemini-2.5-pro",
    status: "active",
    ...over,
  });

const aMessage = (index: number, over: Record<string, unknown> = {}) =>
  aCurriculumChatMessage({
    id: chatMessageId(index),
    session_id: SESSION,
    role: "user",
    content: `message ${index}`,
    created_at: daysAgo(1),
    ...over,
  });

const withReply = (body: Record<string, unknown>) => (backend: SupabaseBackend) => {
  backend.db.seed("curriculum_chat_sessions", [aSession()]);
  backend.stubFunction("curriculum-chat", body);
};

/** Open the seeded session and wait for its messages to load. */
async function openSession(
  harness: ReturnType<typeof render>,
  sessionId = SESSION,
) {
  await waitFor(() => expect(harness.result.current.sessionsLoading).toBe(false));
  act(() => {
    harness.result.current.setActiveSessionId(sessionId);
  });
  await waitFor(() => expect(harness.result.current.messagesLoading).toBe(false));
}

describe("the session list", () => {
  it("shows the active sessions, most recently touched first", async () => {
    const { result } = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [
        aSession({ id: chatSessionId(0), title: "Older", updated_at: daysAgo(10) }),
        aSession({ id: chatSessionId(1), title: "Newer", updated_at: daysAgo(1) }),
      ]),
    );

    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    // The one you were last working on is the one you came back for.
    expect(result.current.sessions.map((session) => session.title)).toEqual(["Newer", "Older"]);
  });

  it("leaves out archived sessions", async () => {
    const { result } = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [
        aSession({ id: chatSessionId(0), title: "Live" }),
        aSession({ id: chatSessionId(1), title: "Done", status: "archived" }),
      ]),
    );

    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0].title).toBe("Live");
  });

  it("starts with nothing open", async () => {
    const { result } = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [aSession()]),
    );

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));
    expect(result.current.activeSessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });
});

describe("opening a session", () => {
  it("loads its messages in the order they were written", async () => {
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.seed("curriculum_chat_messages", [
        aMessage(1, { content: "second", created_at: daysAgo(1) }),
        aMessage(0, { content: "first", created_at: daysAgo(2) }),
      ]);
    });
    await openSession(harness);

    // A conversation read out of order is not a conversation.
    expect(harness.result.current.messages.map((message) => message.content)).toEqual([
      "first",
      "second",
    ]);
  });

  it("leaves out another session's messages", async () => {
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.seed("curriculum_chat_messages", [
        aMessage(0, { content: "mine" }),
        aMessage(1, { session_id: chatSessionId(9), content: "theirs" }),
      ]);
    });
    await openSession(harness);

    expect(harness.result.current.messages.map((message) => message.content)).toEqual(["mine"]);
  });

  it("does not query for messages before a session is open", async () => {
    const { result, backend } = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [aSession()]),
    );

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));
    expect(
      backend.db.reads.filter((read) => read.table === "curriculum_chat_messages"),
    ).toEqual([]);
  });
});

describe("starting a session", () => {
  it("records the dialect, level and model it was opened with", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));

    await act(async () => {
      await result.current.createSession.mutateAsync({
        dialect: "Gulf",
        model: "google/gemini-2.5-pro",
        stageId: "stage-1",
        cefr: "A2",
      });
    });

    // These three travel with every subsequent turn; a session that did not
    // record them would draft generic Arabic at an unspecified level.
    expect(backend.db.lastWriteTo("curriculum_chat_sessions")?.payload[0]).toMatchObject({
      admin_id: TEST_USER_ID,
      target_dialect: "Gulf",
      llm_model: "google/gemini-2.5-pro",
      target_stage_id: "stage-1",
      target_cefr: "A2",
    });
  });

  it("stores an unspecified stage or level as nothing", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));

    await act(async () => {
      await result.current.createSession.mutateAsync({
        dialect: "Gulf",
        model: "google/gemini-2.5-pro",
      });
    });

    expect(backend.db.lastWriteTo("curriculum_chat_sessions")?.payload[0]).toMatchObject({
      target_stage_id: null,
      target_cefr: null,
    });
  });

  it("opens the new session straight away", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));

    await act(async () => {
      await result.current.createSession.mutateAsync({
        dialect: "Gulf",
        model: "google/gemini-2.5-pro",
      });
    });

    // Creating one is always followed by typing into it.
    await waitFor(() => expect(result.current.activeSessionId).toBeTruthy());
  });
});

describe("sending a turn", () => {
  it("saves what the admin typed before calling the model", async () => {
    const harness = render(withReply({ content: "Here is a lesson." }));
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft an A2 lesson about the souq");
    });

    const written = harness.backend.db
      .writesTo("curriculum_chat_messages")
      .flatMap((write) => write.payload as Record<string, unknown>[]);
    // Persisted first, so a model call that times out still leaves the admin's
    // prompt in the conversation rather than losing what they typed.
    expect(written[0]).toMatchObject({
      session_id: SESSION,
      role: "user",
      content: "Draft an A2 lesson about the souq",
    });
  });

  it("tells the model the session's dialect, level and model", async () => {
    const harness = render(withReply({ content: "Here is a lesson." }));
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson", "lesson");
    });

    // The whole reason a session carries these: a Gulf A2 lesson drafted
    // against generic Arabic at an unstated level is the content problem the
    // curriculum pipeline exists to prevent.
    expect(harness.backend.lastCallTo("curriculum-chat")?.body).toMatchObject({
      model: "google/gemini-2.5-pro",
      dialect: "Gulf",
      stage_context: { cefr: "A2" },
      mode: "lesson",
    });
  });

  it("sends the conversation so far, not just the new line", async () => {
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.seed("curriculum_chat_messages", [
        aMessage(0, { role: "user", content: "Draft a lesson", created_at: daysAgo(2) }),
        aMessage(1, { role: "assistant", content: "Here it is", created_at: daysAgo(1) }),
      ]);
      backend.stubFunction("curriculum-chat", { content: "Revised." });
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Make it harder");
    });

    // "Make it harder" means nothing without the draft it refers to.
    expect(harness.backend.lastCallTo("curriculum-chat")?.body).toMatchObject({
      messages: [
        { role: "user", content: "Draft a lesson" },
        { role: "assistant", content: "Here it is" },
        { role: "user", content: "Make it harder" },
      ],
    });
  });

  it("leaves system messages out of the history", async () => {
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.seed("curriculum_chat_messages", [
        aMessage(0, { role: "system", content: "internal note", created_at: daysAgo(2) }),
      ]);
      backend.stubFunction("curriculum-chat", { content: "Drafted." });
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson");
    });

    // The function builds its own system prompt; sending a stored one as well
    // would give the model two sets of instructions.
    const body = harness.backend.lastCallTo("curriculum-chat")?.body as {
      messages: Array<{ role: string }>;
    };
    expect(body.messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("saves the draft with the structure the admin will edit", async () => {
    const structured = { title: "At the souq", words: [{ arabic: "سوق", english: "market" }] };
    const harness = render(
      withReply({
        content: "Here is a lesson.",
        model: "google/gemini-2.5-pro",
        structured_output: structured,
        output_type: "lesson",
      }),
    );
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson");
    });

    const written = harness.backend.db
      .writesTo("curriculum_chat_messages")
      .flatMap((write) => write.payload as Record<string, unknown>[]);
    // The prose is for the admin to read; the structured output is what gets
    // approved into the syllabus, so it has to be stored alongside it.
    expect(written.at(-1)).toMatchObject({
      role: "assistant",
      content: "Here is a lesson.",
      structured_output: structured,
      output_type: "lesson",
    });
  });

  it("titles the session from the opening request", async () => {
    const harness = render(withReply({ content: "Here is a lesson." }));
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft an A2 lesson about the souq");
    });

    // A sidebar of sessions all called "New session" is unusable, and the first
    // thing the admin typed is what the session is about.
    await waitFor(() =>
      expect(harness.backend.db.lastWriteTo("curriculum_chat_sessions")?.payload[0]).toMatchObject({
        title: "Draft an A2 lesson about the souq",
      }),
    );
  });

  it("truncates a long opening request into a readable title", async () => {
    const harness = render(withReply({ content: "Here is a lesson." }));
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("a".repeat(200));
    });

    await waitFor(() => {
      const title = (
        harness.backend.db.lastWriteTo("curriculum_chat_sessions")?.payload[0] as Record<
          string,
          string
        >
      ).title;
      expect(title).toHaveLength(63);
      expect(title.endsWith("...")).toBe(true);
    });
  });

  it("does not rename a session that already has a conversation", async () => {
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession({ title: "Souq lesson" })]);
      backend.db.seed("curriculum_chat_messages", [aMessage(0, { content: "Draft a lesson" })]);
      backend.stubFunction("curriculum-chat", { content: "Revised." });
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Make it harder");
    });

    // Otherwise every follow-up would rename the session after the last thing
    // said in it.
    expect(harness.backend.db.writesTo("curriculum_chat_sessions")).toEqual([]);
  });

  it("reports that it is working and then stops", async () => {
    const harness = render(withReply({ content: "Here is a lesson." }));
    await openSession(harness);

    expect(harness.result.current.isGenerating).toBe(false);
    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson");
    });
    expect(harness.result.current.isGenerating).toBe(false);
  });
});

describe("when a turn fails", () => {
  it("tells the admin rather than failing silently", async () => {
    const error = vi.spyOn(await import("sonner").then((m) => m.toast), "error");
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.stubFunctionFailure("curriculum-chat", 500, { error: "gateway down" });
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson");
    });

    // The admin is waiting on a draft; a spinner that stops with nothing new on
    // screen reads as the app having lost their request.
    expect(error).toHaveBeenCalled();
    expect(harness.result.current.isGenerating).toBe(false);
  });

  it("treats an empty reply as a failure", async () => {
    const error = vi.spyOn(await import("sonner").then((m) => m.toast), "error");
    const harness = render(withReply({ model: "google/gemini-2.5-pro" }));
    await openSession(harness);

    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson");
    });

    // A 200 with no content would otherwise be saved as a blank assistant
    // message the admin has to work out how to interpret.
    expect(error).toHaveBeenCalled();
    const written = harness.backend.db
      .writesTo("curriculum_chat_messages")
      .flatMap((write) => write.payload as Record<string, unknown>[]);
    expect(written.some((row) => row.role === "assistant")).toBe(false);
  });

  it("refuses to send with no session open", async () => {
    const error = vi.spyOn(await import("sonner").then((m) => m.toast), "error");
    const { result, backend } = render();
    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));

    await act(async () => {
      await result.current.sendMessage("Draft a lesson");
    });

    expect(error).toHaveBeenCalledWith("No active session");
    expect(backend.callsTo("curriculum-chat")).toEqual([]);
  });

  it("can be told which session to send to", async () => {
    const harness = render(withReply({ content: "Here is a lesson." }));
    await waitFor(() => expect(harness.result.current.sessionsLoading).toBe(false));

    await act(async () => {
      await harness.result.current.sendMessage("Draft a lesson", "chat", harness.result.current.sessions[0]);
    });

    // Creating a session and sending the first message happen in one gesture,
    // and the state update has not landed yet at that point.
    expect(harness.backend.callsTo("curriculum-chat")).toHaveLength(1);
  });
});

describe("managing a session", () => {
  it("archives it and closes it", async () => {
    const harness = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [aSession()]),
    );
    await openSession(harness);

    await act(async () => {
      await harness.result.current.archiveSession.mutateAsync(SESSION);
    });

    // Archived rather than deleted: the conversation is the record of how a
    // published lesson came to say what it says.
    expect(harness.backend.db.rows("curriculum_chat_sessions")[0]).toMatchObject({
      status: "archived",
    });
    await waitFor(() => expect(harness.result.current.activeSessionId).toBeNull());
  });

  it("leaves the open session alone when archiving another", async () => {
    const harness = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [
        aSession({ id: chatSessionId(0) }),
        aSession({ id: chatSessionId(1) }),
      ]),
    );
    await openSession(harness, chatSessionId(0));

    await act(async () => {
      await harness.result.current.archiveSession.mutateAsync(chatSessionId(1));
    });

    expect(harness.result.current.activeSessionId).toBe(chatSessionId(0));
  });

  it("switches the model for the rest of the conversation", async () => {
    const harness = render((backend) =>
      backend.db.seed("curriculum_chat_sessions", [aSession()]),
    );
    await openSession(harness);

    await act(async () => {
      await harness.result.current.updateModel("anthropic/claude-sonnet-4-5");
    });

    // Persisted on the session rather than held in component state, so the
    // change survives a refresh and applies to the next turn.
    expect(harness.backend.db.rows("curriculum_chat_sessions")[0]).toMatchObject({
      llm_model: "anthropic/claude-sonnet-4-5",
    });
  });

  it("does nothing when no session is open", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.sessionsLoading).toBe(false));

    await act(async () => {
      await result.current.updateModel("anthropic/claude-sonnet-4-5");
    });

    expect(backend.db.writesTo("curriculum_chat_sessions")).toEqual([]);
  });

  it("says so when the model cannot be switched", async () => {
    const error = vi.spyOn(await import("sonner").then((m) => m.toast), "error");
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.failWrites("curriculum_chat_sessions", 403, { message: "denied" });
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.updateModel("anthropic/claude-sonnet-4-5");
    });

    // The picker would otherwise show a model the next turn will not use.
    expect(error).toHaveBeenCalledWith("Failed to switch model");
  });
});

describe("editing a draft before approval", () => {
  it("writes the admin's edits back to the message", async () => {
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.seed("curriculum_chat_messages", [
        aMessage(0, { role: "assistant", structured_output: { title: "Draft" } }),
      ]);
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.updateMessageStructured(chatMessageId(0), {
        title: "At the souq",
      });
    });

    // The message is what the approval step reads, so an edit held only on
    // screen would publish the model's original draft.
    expect(harness.backend.db.rows("curriculum_chat_messages")[0]).toMatchObject({
      structured_output: { title: "At the souq" },
    });
  });

  it("says so when the edits cannot be saved", async () => {
    const error = vi.spyOn(await import("sonner").then((m) => m.toast), "error");
    const harness = render((backend) => {
      backend.db.seed("curriculum_chat_sessions", [aSession()]);
      backend.db.seed("curriculum_chat_messages", [aMessage(0, { role: "assistant" })]);
      backend.db.failWrites("curriculum_chat_messages", 403, { message: "denied" });
    });
    await openSession(harness);

    await act(async () => {
      await harness.result.current.updateMessageStructured(chatMessageId(0), { title: "Edited" });
    });

    // Silently losing the edits and then approving the original is the worst
    // available outcome.
    expect(error).toHaveBeenCalled();
  });
});
