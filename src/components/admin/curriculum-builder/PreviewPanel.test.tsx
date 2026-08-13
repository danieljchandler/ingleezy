import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { PreviewPanel } from "./PreviewPanel";
import type { ChatMessage } from "@/hooks/useCurriculumChat";

/**
 * The right-hand pane of the curriculum builder: what the model just proposed,
 * shown as the thing it would become.
 *
 * The builder is a chat with a model that answers in JSON — a lesson, a set of
 * vocabulary, a listening exercise. Nothing it produces reaches learners until
 * an admin approves it here, and the two tabs are the two ways of checking it:
 * the rendered preview for whether the content is any good, and the raw JSON
 * for the fields the preview does not show.
 *
 * This component's own job is narrow — pick the right card for the output type,
 * carry the approval back with whatever the card collected, and guard the JSON
 * editor. The cards themselves are covered by their own tests and stubbed here
 * so that the routing is what is being checked.
 */

const stub = vi.hoisted(
  () => (name: string) => ({
    [name]: ({
      data,
      onApprove,
    }: {
      data: Record<string, unknown>;
      onApprove: (...args: unknown[]) => void;
    }) => (
      <div data-testid={name}>
        <span data-testid={`${name}-data`}>{JSON.stringify(data)}</span>
        <button onClick={() => onApprove("stage-9", [0, 2])}>approve via {name}</button>
      </div>
    ),
  }),
);

vi.mock("./LessonPreviewCard", () => stub("LessonPreviewCard"));
vi.mock("./VocabPreviewCard", () => stub("VocabPreviewCard"));
vi.mock("./ContentPreviewCard", () => ({
  ...stub("GrammarPreviewCard"),
  ...stub("ListeningPreviewCard"),
  ...stub("ReadingPreviewCard"),
  ...stub("DailyChallengePreviewCard"),
  ...stub("ConversationPreviewCard"),
  ...stub("GameSetPreviewCard"),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toasts.success(...a),
    error: (...a: unknown[]) => toasts.error(...a),
  },
}));

const aMessage = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "msg-1",
  session_id: "sess-1",
  role: "assistant",
  content: "Here is the lesson.",
  llm_model: "google/gemini-2.5-pro",
  structured_output: { title: "At the market", stage: 2 },
  output_type: "lesson_preview",
  created_at: new Date().toISOString(),
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  toasts.success.mockReset();
  toasts.error.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(message: ChatMessage | null = aMessage()) {
  const handlers = {
    onClose: vi.fn(),
    onApproveLesson: vi.fn(),
    onApproveVocab: vi.fn(),
    onApproveContent: vi.fn(),
    onSaveEdits: vi.fn(),
  };
  const harness = renderWithProviders(<PreviewPanel message={message} {...handlers} />, {
    persona: "admin",
  });
  cleanup = harness.cleanup;
  return { ...harness, ...handlers };
}

// Radix tabs select on pointer-down, not on click.
const editorTab = () => fireEvent.mouseDown(screen.getByRole("tab", { name: /edit json/i }));
const editor = () => screen.getByRole("textbox");

describe("showing a proposal", () => {
  it("renders nothing when nothing has been proposed", () => {
    const { container } = render(null);

    // The pane shares the layout with the chat; an empty frame would take space
    // from the conversation for no reason.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a message that carried no structured output", () => {
    const { container } = render(aMessage({ structured_output: null }));

    // Most messages in the session are prose.
    expect(container).toBeEmptyDOMElement();
  });

  it("names what kind of thing is being previewed", () => {
    render();

    expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument();
  });

  it("falls back to a neutral label for an output type it does not know", () => {
    render(aMessage({ output_type: "quiz_preview" }));

    // The model gains output types faster than this map does; an unlabelled
    // pane is better than a crash.
    expect(screen.getByRole("heading", { name: "Preview" })).toBeInTheDocument();
  });

  it("closes on request", () => {
    const { onClose, container } = render();

    fireEvent.click(container.querySelector("button")!);

    expect(onClose).toHaveBeenCalled();
  });
});

describe("routing to the right card", () => {
  it("shows a lesson through the lesson card", () => {
    render();

    expect(screen.getByTestId("LessonPreviewCard")).toBeInTheDocument();
  });

  it.each([
    ["grammar_preview", "GrammarPreviewCard"],
    ["listening_preview", "ListeningPreviewCard"],
    ["reading_preview", "ReadingPreviewCard"],
    ["daily_challenge_preview", "DailyChallengePreviewCard"],
    ["conversation_preview", "ConversationPreviewCard"],
    ["game_set_preview", "GameSetPreviewCard"],
  ])("shows %s through its own card", (type, card) => {
    render(aMessage({ output_type: type }));

    expect(screen.getByTestId(card)).toBeInTheDocument();
  });

  it("hands the card exactly what the model produced", () => {
    render();

    // The preview is only worth anything if it is rendering the same object
    // that approval will store.
    expect(screen.getByTestId("LessonPreviewCard-data")).toHaveTextContent(
      '{"title":"At the market","stage":2}',
    );
  });

  it("shows nothing at all for an unknown type", () => {
    render(aMessage({ output_type: "quiz_preview" }));

    // Pinned: the panel opens, labels itself "Preview" and renders an empty
    // pane — there is no card for the type and nothing says so, so a new model
    // output type reads as a broken screen rather than an unsupported one.
    expect(screen.queryByTestId(/PreviewCard/)).toBeNull();
    expect(screen.getByRole("tab", { name: /edit json/i })).toBeInTheDocument();
  });
});

describe("approving", () => {
  it("carries the stage the admin chose back with the lesson", () => {
    const { onApproveLesson } = render();

    fireEvent.click(screen.getByRole("button", { name: /approve via LessonPreviewCard/ }));

    // Which stage a lesson lands in decides where it appears in the curriculum,
    // and only the card knows what the admin picked.
    expect(onApproveLesson).toHaveBeenCalledWith(
      "msg-1",
      { title: "At the market", stage: 2 },
      "stage-9",
    );
  });

  it("carries the lesson and the chosen words back with the vocabulary", () => {
    const { onApproveVocab } = render(aMessage({ output_type: "vocab_preview" }));

    fireEvent.click(screen.getByRole("button", { name: /approve via VocabPreviewCard/ }));

    // An admin routinely takes eight of the twelve words a model offers.
    expect(onApproveVocab).toHaveBeenCalledWith(
      "msg-1",
      { title: "At the market", stage: 2 },
      "stage-9",
      [0, 2],
    );
  });

  it("names the type when approving anything else", () => {
    const { onApproveContent } = render(aMessage({ output_type: "listening_preview" }));

    fireEvent.click(screen.getByRole("button", { name: /approve via ListeningPreviewCard/ }));

    expect(onApproveContent).toHaveBeenCalledWith("msg-1", "listening_preview", {
      title: "At the market",
      stage: 2,
    });
  });
});

describe("editing the raw output", () => {
  it("shows the output formatted rather than as one line", () => {
    render();

    editorTab();

    // An admin is looking for one field in a nested object; a single line of
    // JSON is unreadable.
    expect(editor()).toHaveValue('{\n  "title": "At the market",\n  "stage": 2\n}');
  });

  it("offers nothing to save until something changes", () => {
    render();
    editorTab();

    expect(screen.getByRole("button", { name: /save edits/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
  });

  it("saves the parsed object rather than the text", () => {
    const { onSaveEdits } = render();
    editorTab();

    fireEvent.change(editor(), { target: { value: '{"title":"At the souq"}' } });
    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));

    expect(onSaveEdits).toHaveBeenCalledWith("msg-1", { title: "At the souq" });
    expect(toasts.success).toHaveBeenCalledWith("Edits saved — preview updated");
  });

  it("refuses to save JSON it cannot parse", () => {
    const { onSaveEdits } = render();
    editorTab();

    fireEvent.change(editor(), { target: { value: '{"title": ' } });
    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));

    // Storing a half-typed object would put a lesson in the curriculum with
    // fields the app expects and cannot find.
    expect(onSaveEdits).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Invalid JSON"));
  });

  it("says where the JSON went wrong, next to the editor", () => {
    const { container } = render();
    editorTab();

    fireEvent.change(editor(), { target: { value: "{oops}" } });
    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));

    // A toast is gone by the time the admin looks back at the text, and the
    // parser's own message names the position.
    expect(container.querySelector(".text-destructive")?.textContent).toMatch(/position/);
  });

  it("clears the complaint as soon as the admin types again", () => {
    render();
    editorTab();
    fireEvent.change(editor(), { target: { value: "{oops}" } });
    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));

    fireEvent.change(editor(), { target: { value: '{"title":"fixed"}' } });

    expect(screen.queryByText(/is not valid JSON|Unexpected token/)).toBeNull();
  });

  it("puts the model's version back on Reset", () => {
    render();
    editorTab();
    fireEvent.change(editor(), { target: { value: '{"title":"wrong"}' } });

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));

    expect(editor()).toHaveValue('{\n  "title": "At the market",\n  "stage": 2\n}');
    expect(screen.getByRole("button", { name: /save edits/i })).toBeDisabled();
  });

  it("starts over when the admin opens a different proposal", () => {
    const { rerender } = render();
    editorTab();
    fireEvent.change(editor(), { target: { value: '{"title":"half-typed' } });

    rerender(
      <PreviewPanel
        message={aMessage({ id: "msg-2", structured_output: { title: "At the airport" } })}
        onClose={vi.fn()}
        onApproveLesson={vi.fn()}
        onApproveVocab={vi.fn()}
        onApproveContent={vi.fn()}
        onSaveEdits={vi.fn()}
      />,
    );

    // Edits left over from the previous proposal would be saved onto this one.
    editorTab();
    expect(editor()).toHaveValue('{\n  "title": "At the airport"\n}');
  });
});
