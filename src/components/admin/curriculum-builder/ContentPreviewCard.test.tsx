import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import {
  ContentPreviewCard,
  ConversationPreviewCard,
  DailyChallengePreviewCard,
  GameSetPreviewCard,
  GrammarPreviewCard,
  ListeningPreviewCard,
  ReadingPreviewCard,
} from "./ContentPreviewCard";

/**
 * The last thing an admin looks at before content goes live.
 *
 * Approving is irreversible from this screen — the next learner to open the
 * curriculum sees whatever was published — so the preview is the only chance to
 * notice that the model drafted MSA, or answered in the wrong dialect, or
 * produced two exercises where the button says twelve. That makes the counts on
 * the button and the sample it shows load-bearing rather than decorative: an
 * admin who trusts a wrong number approves content they have not read.
 *
 * Six content types share one shell. Reaching all six through the builder
 * end-to-end would mean coaxing a model into six different structured outputs,
 * which is why they are rendered directly here.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(ui: React.ReactElement) {
  const harness = renderWithProviders(ui, { persona: "admin" });
  cleanup = harness.cleanup;
  return harness;
}

const anExercise = (index: number) => ({
  question_arabic: `سؤال${index}`,
  question_english: `question ${index}`,
  grammar_point: "negation with ما",
  choices: ["ما", "لا"],
  correct_index: 0,
});

describe("the shell every preview shares", () => {
  it("shows the draft and the button that publishes it", () => {
    render(
      <ContentPreviewCard title="A lesson" icon="📚" onApprove={() => {}}>
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    expect(screen.getByText("the draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish/i })).toBeInTheDocument();
  });

  it("starts open", () => {
    render(
      <ContentPreviewCard title="A lesson" icon="📚" onApprove={() => {}}>
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    // Collapsed by default would mean an admin could approve without the draft
    // ever having been on screen.
    expect(screen.getByText("the draft")).toBeVisible();
  });

  it("hides the draft and the button together when collapsed", () => {
    render(
      <ContentPreviewCard title="A lesson" icon="📚" onApprove={() => {}}>
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    fireEvent.click(screen.getAllByRole("button")[0]);

    // The publish button lives inside the collapsible body on purpose: a
    // collapsed card cannot be approved from, so nothing is published unseen.
    expect(screen.queryByText("the draft")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });

  it("publishes when asked", () => {
    const onApprove = vi.fn();
    render(
      <ContentPreviewCard title="A lesson" icon="📚" onApprove={onApprove}>
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));

    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("refuses a second click while it is publishing", () => {
    const onApprove = vi.fn();
    render(
      <ContentPreviewCard title="A lesson" icon="📚" onApprove={onApprove} isApproving>
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    const button = screen.getByRole("button", { name: /publishing/i });
    fireEvent.click(button);

    // Publishing is an insert with no idempotency key; a double click would put
    // the same lesson into the curriculum twice.
    expect(button).toBeDisabled();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("shows the labels the admin needs to judge the draft by", () => {
    render(
      <ContentPreviewCard
        title="A lesson"
        subtitle="في السوق"
        icon="📚"
        badges={["Gulf", "A2"]}
        onApprove={() => {}}
      >
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    // The dialect and level are the two things most likely to be wrong and
    // least likely to be noticed from the Arabic alone.
    expect(screen.getByText("Gulf")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getByText("في السوق")).toBeInTheDocument();
  });

  it("leaves out a subtitle there is none of", () => {
    render(
      <ContentPreviewCard title="A lesson" icon="📚" onApprove={() => {}}>
        <p>the draft</p>
      </ContentPreviewCard>,
    );

    expect(screen.getByText("A lesson")).toBeInTheDocument();
  });
});

describe("grammar exercises", () => {
  it("counts them on the heading and the button", () => {
    render(
      <GrammarPreviewCard
        data={{ exercises: [anExercise(1), anExercise(2)], category: "negation" }}
        onApprove={() => {}}
      />,
    );

    expect(screen.getByText("Grammar Exercises (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish 2 exercises" })).toBeInTheDocument();
  });

  it("samples the first three and says how many are left", () => {
    render(
      <GrammarPreviewCard
        data={{ exercises: Array.from({ length: 12 }, (_, i) => anExercise(i)) }}
        onApprove={() => {}}
      />,
    );

    // The admin reads three and infers the rest. Saying how many were withheld
    // is what stops that inference being a guess.
    expect(screen.getByText("سؤال0")).toBeInTheDocument();
    expect(screen.getByText("سؤال2")).toBeInTheDocument();
    expect(screen.queryByText("سؤال3")).not.toBeInTheDocument();
    expect(screen.getByText("+9 more exercises")).toBeInTheDocument();
  });

  it("says nothing about extras when there are none", () => {
    render(<GrammarPreviewCard data={{ exercises: [anExercise(1)] }} onApprove={() => {}} />);

    expect(screen.queryByText(/more exercises/)).not.toBeInTheDocument();
  });

  it("shows the grammar point each exercise claims to teach", () => {
    render(<GrammarPreviewCard data={{ exercises: [anExercise(1)] }} onApprove={() => {}} />);

    // The point is what the drill is filed under; an exercise mislabelled here
    // is served to learners practising something else.
    expect(screen.getByText("Point: negation with ما")).toBeInTheDocument();
  });

  it("renders the Arabic right to left", () => {
    render(<GrammarPreviewCard data={{ exercises: [anExercise(1)] }} onApprove={() => {}} />);

    // Arabic laid out left to right is unreadable to a native speaker checking
    // it, which is exactly who this preview is for.
    expect(screen.getByText("سؤال1")).toHaveAttribute("dir", "rtl");
  });

  it("survives a draft with no exercises in it", () => {
    render(<GrammarPreviewCard data={{}} onApprove={() => {}} />);

    // A model that answered with the wrong shape must not blank the builder.
    expect(screen.getByText("Grammar Exercises (0)")).toBeInTheDocument();
  });
});

describe("listening exercises", () => {
  it("shows every clip's text, not a sample", () => {
    render(
      <ListeningPreviewCard
        data={{
          mode: "dictation",
          exercises: [
            { audio_text: "رحت السوق", audio_text_english: "I went to the market" },
            { audio_text: "زين", audio_text_english: "good" },
          ],
        }}
        onApprove={() => {}}
      />,
    );

    // These become spoken audio a learner transcribes; a typo in one is only
    // catchable by reading all of them.
    expect(screen.getByText("رحت السوق")).toBeInTheDocument();
    expect(screen.getByText("زين")).toBeInTheDocument();
    expect(screen.getByText("Listening Exercises (2)")).toBeInTheDocument();
  });

  it("labels the mode the exercises were drafted for", () => {
    render(
      <ListeningPreviewCard
        data={{ mode: "comprehension", difficulty: "advanced", exercises: [] }}
        onApprove={() => {}}
      />,
    );

    // Dictation and comprehension are different exercises entirely; publishing
    // one as the other gives the learner questions about audio they were meant
    // to transcribe.
    expect(screen.getByText("comprehension")).toBeInTheDocument();
    expect(screen.getByText("advanced")).toBeInTheDocument();
  });
});

describe("a reading passage", () => {
  const passage = {
    title: "في السوق",
    title_english: "At the market",
    passage: "ا".repeat(500),
    questions: [{ q: "1" }, { q: "2" }],
    vocabulary: [{ word: "سوق" }],
  };

  it("leads with the English title and keeps the Arabic beneath it", () => {
    render(<ReadingPreviewCard data={{ passage }} onApprove={() => {}} />);

    expect(screen.getByText("At the market")).toBeInTheDocument();
    expect(screen.getByText("في السوق")).toBeInTheDocument();
  });

  it("shows the opening of the passage rather than all of it", () => {
    render(<ReadingPreviewCard data={{ passage }} onApprove={() => {}} />);

    // A whole passage would push the publish button off the screen; the first
    // two hundred characters are enough to hear the dialect.
    expect(screen.getByText(`${"ا".repeat(200)}...`)).toBeInTheDocument();
  });

  it("counts the questions and the glossary", () => {
    render(<ReadingPreviewCard data={{ passage }} onApprove={() => {}} />);

    // A passage published with no questions is a reading exercise with nothing
    // to do, and the count is the only place that shows.
    expect(screen.getByText("2 questions · 1 vocab items")).toBeInTheDocument();
  });

  it("falls back to a generic heading for an untitled draft", () => {
    render(<ReadingPreviewCard data={{}} onApprove={() => {}} />);

    expect(screen.getByText("Reading Passage")).toBeInTheDocument();
    expect(screen.getByText("0 questions · 0 vocab items")).toBeInTheDocument();
  });
});

describe("a daily challenge", () => {
  it("counts the questions on the button", () => {
    render(
      <DailyChallengePreviewCard
        data={{
          title: "Souq words",
          title_arabic: "كلمات السوق",
          challenge_type: "vocabulary",
          questions: [{ q: 1 }, { q: 2 }, { q: 3 }],
        }}
        onApprove={() => {}}
      />,
    );

    // A daily challenge is one day's work for every learner at once, so the
    // length is the thing to check before it goes out.
    expect(
      screen.getByRole("button", { name: "Publish challenge (3 questions)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 questions ready")).toBeInTheDocument();
    expect(screen.getByText("كلمات السوق")).toBeInTheDocument();
  });

  it("falls back to a generic heading", () => {
    render(<DailyChallengePreviewCard data={{}} onApprove={() => {}} />);

    expect(screen.getByText("Daily Challenge")).toBeInTheDocument();
    expect(screen.getByText("0 questions ready")).toBeInTheDocument();
  });
});

describe("a conversation scenario", () => {
  it("shows the prompt that will drive the conversation", () => {
    render(
      <ConversationPreviewCard
        data={{
          scenario: {
            title: "Ordering coffee",
            description: "Order at a café",
            difficulty: "Beginner",
            system_prompt: "You are a barista in Kuwait. Speak Gulf Arabic only.",
          },
        }}
        onApprove={() => {}}
      />,
    );

    // The system prompt *is* the scenario. Everything else is a label on it, and
    // a prompt that forgot to name the dialect produces a fusha barista.
    expect(
      screen.getByText("You are a barista in Kuwait. Speak Gulf Arabic only."),
    ).toBeInTheDocument();
    expect(screen.getByText("Ordering coffee")).toBeInTheDocument();
    expect(screen.getByText("Beginner")).toBeInTheDocument();
  });

  it("falls back to a generic heading", () => {
    render(<ConversationPreviewCard data={{}} onApprove={() => {}} />);

    expect(screen.getByText("Conversation Scenario")).toBeInTheDocument();
  });
});

describe("a vocabulary game set", () => {
  const pairs = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      word_arabic: `كلمة${index}`,
      word_english: `word ${index}`,
    }));

  it("shows the pairs the game will match", () => {
    render(
      <GameSetPreviewCard
        data={{ title: "Souq matching", game_type: "matching", word_pairs: pairs(2) }}
        onApprove={() => {}}
      />,
    );

    // Both halves together: a matching game is only checkable by reading the
    // pairing, not either side of it.
    expect(screen.getByText("كلمة0 = word 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish game set (2 words)" })).toBeInTheDocument();
  });

  it("shows the first eight and counts the rest", () => {
    render(<GameSetPreviewCard data={{ word_pairs: pairs(12) }} onApprove={() => {}} />);

    expect(screen.getByText("كلمة7 = word 7")).toBeInTheDocument();
    expect(screen.queryByText("كلمة8 = word 8")).not.toBeInTheDocument();
    expect(screen.getByText("+4 more")).toBeInTheDocument();
  });

  it("says nothing about extras when they all fit", () => {
    render(<GameSetPreviewCard data={{ word_pairs: pairs(3) }} onApprove={() => {}} />);

    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });

  it("falls back to a generic heading", () => {
    render(<GameSetPreviewCard data={{}} onApprove={() => {}} />);

    expect(screen.getByText("Game Set")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish game set (0 words)" })).toBeInTheDocument();
  });
});
