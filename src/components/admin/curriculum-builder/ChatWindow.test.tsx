import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/hooks/useCurriculumChat";
import { ChatWindow } from "./ChatWindow";

/**
 * The transcript half of the curriculum builder.
 *
 * An admin talks to a model here and gets back two things at once: prose, and a
 * structured draft of a lesson, vocabulary set or exercise. Only the prose
 * belongs in the bubble — the draft is a form to review in the panel next door,
 * so the JSON is stripped from the text and replaced with a button that opens
 * it. Getting that split wrong in either direction is what these cases are
 * about: raw JSON dumped into the chat, or a generated draft with no way to
 * reach it.
 */

const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoView.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

const aMessage = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  session_id: "sess-1",
  role: "assistant",
  content: "Here is a lesson on greetings.",
  llm_model: null,
  structured_output: null,
  output_type: null,
  created_at: "2026-03-01T10:00:00Z",
  ...over,
});

interface Options {
  messages?: ChatMessage[];
  isGenerating?: boolean;
  sessionId?: string | null;
  selectedMessageId?: string | null;
}

function renderWindow({
  messages = [],
  isGenerating = false,
  sessionId = "sess-1",
  selectedMessageId = null,
}: Options = {}) {
  const onSelectPreview = vi.fn();
  const result = render(
    <ChatWindow
      messages={messages}
      isGenerating={isGenerating}
      sessionId={sessionId}
      selectedMessageId={selectedMessageId}
      onSelectPreview={onSelectPreview}
    />,
  );
  return { ...result, onSelectPreview };
}

describe("ChatWindow — with no session open", () => {
  it("explains what the tool is for", () => {
    renderWindow({ sessionId: null });
    expect(screen.getByRole("heading", { name: "Curriculum Builder" })).toBeInTheDocument();
    expect(screen.getByText(/Create a new session or pick one from the sidebar/)).toBeInTheDocument();
  });

  it("shows no messages even if some are held in memory", () => {
    // The parent keeps the previous session's messages around while switching;
    // showing them under "no session" would look like they belong to nothing.
    renderWindow({ sessionId: null, messages: [aMessage({ content: "stale" })] });
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("shows no spinner even mid-generation", () => {
    const { container } = renderWindow({ sessionId: null, isGenerating: true });
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });
});

describe("ChatWindow — an empty session", () => {
  it("says how to start", () => {
    renderWindow();
    expect(screen.getByText("Tell the AI what to build")).toBeInTheDocument();
    expect(screen.getByText(/button below or just type a request/)).toBeInTheDocument();
  });

  it("drops the prompt once the first request is in flight", () => {
    // Otherwise the screen says "tell the AI what to build" directly above the
    // AI building it.
    renderWindow({ isGenerating: true });
    expect(screen.queryByText("Tell the AI what to build")).not.toBeInTheDocument();
  });
});

describe("ChatWindow — the messages", () => {
  it("shows every message in order", () => {
    renderWindow({
      messages: [
        aMessage({ id: "m1", role: "user", content: "build me a greetings lesson" }),
        aMessage({ id: "m2", content: "Here you go." }),
      ],
    });
    expect(screen.getByText("build me a greetings lesson")).toBeInTheDocument();
    expect(screen.getByText("Here you go.")).toBeInTheDocument();
  });

  it("puts the admin's own messages on the other side", () => {
    const { container } = renderWindow({
      messages: [aMessage({ role: "user", content: "hello" })],
    });
    expect(container.querySelector(".flex-row-reverse")).toBeInTheDocument();
  });

  it("keeps the model's messages on the left", () => {
    const { container } = renderWindow({ messages: [aMessage()] });
    expect(container.querySelector(".flex-row-reverse")).toBeNull();
  });

  it("keeps line breaks in a generated lesson plan", () => {
    // Plans come back as lists. Collapsing the whitespace would make every one
    // of them a wall of text.
    const { container } = renderWindow({ messages: [aMessage({ content: "a\n\nb" })] });
    expect(container.querySelector(".whitespace-pre-wrap")).toHaveTextContent("a b");
  });

  it("names the model that answered", () => {
    // The builder lets an admin switch models mid-session, and comparing two
    // drafts is pointless without knowing which produced which.
    renderWindow({ messages: [aMessage({ llm_model: "anthropic/claude-sonnet-4-5" })] });
    expect(screen.getByText("Claude Sonnet 4.5")).toBeInTheDocument();
  });

  it("falls back to the raw id for a model the picker no longer offers", () => {
    renderWindow({ messages: [aMessage({ llm_model: "some/retired-model" })] });
    expect(screen.getByText("some/retired-model")).toBeInTheDocument();
  });

  it("never labels the admin's own message with a model", () => {
    renderWindow({
      messages: [aMessage({ role: "user", llm_model: "anthropic/claude-sonnet-4-5" })],
    });
    expect(screen.queryByText("Claude Sonnet 4.5")).not.toBeInTheDocument();
  });

  it("leaves the badge off when nothing recorded the model", () => {
    const { container } = renderWindow({ messages: [aMessage({ llm_model: null })] });
    expect(container.querySelector(".text-\\[10px\\]")).toBeNull();
  });
});

describe("ChatWindow — hiding the JSON", () => {
  it("strips the structured block out of the prose", () => {
    renderWindow({
      messages: [
        aMessage({
          content: 'Here is your lesson.\n```json\n{"title":"Greetings"}\n```',
        }),
      ],
    });
    expect(screen.getByText("Here is your lesson.")).toBeInTheDocument();
    expect(screen.queryByText(/"title"/)).not.toBeInTheDocument();
  });

  it("strips more than one block", () => {
    renderWindow({
      messages: [aMessage({ content: "one\n```json\n{}\n```\ntwo\n```json\n[]\n```\nthree" })],
    });
    const bubble = screen.getByText(/one/);
    expect(bubble.textContent).not.toContain("{}");
    expect(bubble.textContent).toContain("three");
  });

  it("leaves a non-JSON code block alone", () => {
    // Only the JSON fence is a machine payload; a snippet of Arabic or a table
    // is content the admin asked for.
    renderWindow({ messages: [aMessage({ content: "```\nمرحبا\n```" })] });
    expect(screen.getByText(/مرحبا/)).toBeInTheDocument();
  });

  it("says so when a reply was all payload and nothing else", () => {
    // The terser models answer with the JSON and no prose routinely, and the
    // prompt does not forbid it — which left an empty grey box the admin could
    // not tell from a broken model.
    renderWindow({
      messages: [aMessage({ content: '```json\n{"title":"Greetings"}\n```' })],
    });
    expect(screen.getByText("The model returned nothing.")).toBeInTheDocument();
  });

  it("distinguishes a silent model from one that returned a draft", () => {
    renderWindow({
      messages: [
        aMessage({
          content: '```json\n{"title":"Greetings"}\n```',
          structured_output: { title: "Greetings" },
        }),
      ],
    });
    expect(screen.getByText("Draft returned with no message.")).toBeInTheDocument();
  });

  it("says nothing extra when there is prose to show", () => {
    renderWindow({ messages: [aMessage({ content: "Here is your lesson." })] });
    expect(screen.getByText("Here is your lesson.")).toBeInTheDocument();
    expect(screen.queryByText(/returned nothing/)).not.toBeInTheDocument();
  });
});

describe("ChatWindow — the preview button", () => {
  const withDraft = (over: Partial<ChatMessage> = {}) =>
    aMessage({
      output_type: "lesson_preview",
      structured_output: { title: "Greetings" },
      ...over,
    });

  it.each([
    ["lesson_preview", "Lesson ready"],
    ["vocab_preview", "Vocabulary ready"],
    ["grammar_preview", "Grammar ready"],
    ["listening_preview", "Listening ready"],
    ["reading_preview", "Reading ready"],
    ["daily_challenge_preview", "Daily Challenge ready"],
    ["conversation_preview", "Conversation ready"],
    ["game_set_preview", "Game Set ready"],
  ])("offers to open a %s", (outputType, label) => {
    renderWindow({ messages: [withDraft({ output_type: outputType })] });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("opens the draft in the panel next door", () => {
    const { onSelectPreview } = renderWindow({ messages: [withDraft({ id: "m7" })] });
    fireEvent.click(screen.getByRole("button"));
    expect(onSelectPreview).toHaveBeenCalledWith("m7");
  });

  it("marks the draft currently on screen", () => {
    // Several messages in a session can carry drafts, and without this the
    // admin cannot tell which of them the panel is showing.
    renderWindow({
      messages: [withDraft({ id: "m1" }), withDraft({ id: "m2" })],
      selectedMessageId: "m2",
    });
    const [first, second] = screen.getAllByRole("button");
    expect(second.className).toContain("bg-primary");
    expect(first.className).not.toContain("bg-primary");
  });

  it("offers nothing for a message with no draft attached", () => {
    renderWindow({ messages: [aMessage({ output_type: "lesson_preview" })] });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers nothing for a draft with no type", () => {
    renderWindow({ messages: [aMessage({ structured_output: { title: "x" } })] });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("still offers a draft whose type it does not recognise", () => {
    // The edge function decides output_type, so adding a generator server-side
    // — the normal way this feature grows — produced messages whose draft was
    // generated, stored and stripped from the prose, and which the admin had no
    // way to open or approve.
    renderWindow({
      messages: [withDraft({ output_type: "pronunciation_drill_preview" })],
    });
    expect(
      screen.getByRole("button", { name: /Pronunciation drill ready/ }),
    ).toBeInTheDocument();
  });

  it("opens an unrecognised draft like any other", () => {
    const { onSelectPreview } = renderWindow({
      messages: [withDraft({ id: "m9", output_type: "pronunciation_drill_preview" })],
    });
    fireEvent.click(screen.getByRole("button", { name: /Pronunciation drill ready/ }));
    expect(onSelectPreview).toHaveBeenCalledWith("m9");
  });

  it("prefers the authored label for a type it does know", () => {
    renderWindow({ messages: [withDraft({ output_type: "lesson_preview" })] });
    expect(screen.getByRole("button", { name: /Lesson ready/ })).toBeInTheDocument();
  });
});

describe("ChatWindow — while the model is working", () => {
  it("shows that something is happening", () => {
    const { container } = renderWindow({ messages: [aMessage()], isGenerating: true });
    expect(screen.getByText("Generating response...")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("keeps the conversation so far visible", () => {
    renderWindow({ messages: [aMessage({ content: "earlier reply" })], isGenerating: true });
    expect(screen.getByText("earlier reply")).toBeInTheDocument();
  });

  it("takes the spinner away when the reply lands", () => {
    const { rerender, container } = renderWindow({ isGenerating: true });
    rerender(
      <ChatWindow
        messages={[aMessage()]}
        isGenerating={false}
        sessionId="sess-1"
        selectedMessageId={null}
        onSelectPreview={vi.fn()}
      />,
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("ChatWindow — staying at the bottom", () => {
  it("scrolls down on first paint", () => {
    renderWindow({ messages: [aMessage()] });
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("scrolls again when a message arrives", () => {
    const { rerender } = renderWindow({ messages: [aMessage({ id: "m1" })] });
    const before = scrollIntoView.mock.calls.length;

    rerender(
      <ChatWindow
        messages={[aMessage({ id: "m1" }), aMessage({ id: "m2" })]}
        isGenerating={false}
        sessionId="sess-1"
        selectedMessageId={null}
        onSelectPreview={vi.fn()}
      />,
    );
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(before);
  });

  it("scrolls when generation starts, so the spinner is visible", () => {
    const { rerender } = renderWindow({ messages: [aMessage()] });
    const before = scrollIntoView.mock.calls.length;

    rerender(
      <ChatWindow
        messages={[aMessage()]}
        isGenerating
        sessionId="sess-1"
        selectedMessageId={null}
        onSelectPreview={vi.fn()}
      />,
    );
    expect(scrollIntoView.mock.calls.length).toBeGreaterThan(before);
  });
});
