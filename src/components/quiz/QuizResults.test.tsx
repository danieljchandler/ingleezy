import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TopicWithWords, VocabularyWord } from "@/hooks/useTopic";
import { renderWithProviders } from "@/test/support/react/harness";
import { QuizResults } from "./QuizResults";

/**
 * The screen at the end of a topic quiz.
 *
 * Two jobs, and the second is the one that matters. The score is the reward;
 * the answer review is the actual teaching, because the only moment a learner
 * is guaranteed to care what a word means is right after getting it wrong. So
 * every question comes back with the word, what the learner said, and what it
 * actually was — struck through and corrected in place rather than listed
 * separately, so the correction sits where the mistake was.
 */

/**
 * The page chrome, stood in for.
 *
 * AppShell mounts the onboarding tour and the feedback widget, both of which
 * resolve a session on a macrotask. Left real, every test in this file leaves
 * an auth request in flight that lands after teardown — 75 act() warnings and
 * an unstubbed request to the fake host. All three have their own test files.
 */
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const anWord = (over: Partial<VocabularyWord> = {}): VocabularyWord => ({
  id: "w1",
  topic_id: "t1",
  word_arabic: "خبز",
  word_english: "bread",
  image_url: null,
  audio_url: null,
  image_position: null,
  display_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const aTopic = (over: Partial<TopicWithWords> = {}): TopicWithWords => ({
  id: "t1",
  name: "Food",
  name_arabic: "طعام",
  icon: "🍽",
  gradient: "from-a to-b",
  display_order: 0,
  words: [],
  soundSpotlight: [],
  realWorldPrompts: [],
  lessonSequence: [],
  ...over,
});

type Answer = { word: VocabularyWord; correct: boolean; userAnswer?: string };

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function render(answers: Answer[], score = answers.filter((a) => a.correct).length) {
  const onRestart = vi.fn();
  const onHome = vi.fn();
  const harness = renderWithProviders(
    <QuizResults
      topic={aTopic()}
      quizState={{ score, answers }}
      onRestart={onRestart}
      onHome={onHome}
    />,
  );
  cleanup = harness.cleanup;
  return { ...harness, onRestart, onHome };
}

/** `n` answers, the first `correctCount` of them right. */
const answers = (n: number, correctCount: number): Answer[] =>
  Array.from({ length: n }, (_, i) => ({
    word: anWord({ id: `w${i}`, word_arabic: `كلمة${i}`, word_english: `word ${i}` }),
    correct: i < correctCount,
    userAnswer: i < correctCount ? undefined : `wrong ${i}`,
  }));

describe("QuizResults — the score", () => {
  it("shows the raw tally as well as the percentage", () => {
    // Three out of five reads differently from 60%, and a learner who has just
    // done five questions thinks in questions.
    render(answers(5, 3));
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.getByText("60% correct")).toBeInTheDocument();
  });

  it("rounds to a whole percent", () => {
    render(answers(3, 2));
    expect(screen.getByText("67% correct")).toBeInTheDocument();
  });

  it("names the topic in Arabic", () => {
    render(answers(2, 2));
    expect(screen.getByText("طعام")).toBeInTheDocument();
  });

  it.each([
    [4, 4, "ممتاز! كامل الدرجة"],
    [5, 4, "أحسنت! شغل حلو"],
    [5, 3, "جيد! مجهود طيب"],
    [5, 2, "واصل التمرين!"],
    [5, 1, "حاول مرة ثانية!"],
    [5, 0, "حاول مرة ثانية!"],
  ])("praises %i of %i as expected", (total, correct, message) => {
    render(answers(total, correct));
    expect(screen.getByRole("heading", { name: message })).toBeInTheDocument();
  });

  it("counts exactly 80% as the higher band", () => {
    render(answers(5, 4));
    expect(screen.getByRole("heading", { name: "أحسنت! شغل حلو" })).toBeInTheDocument();
  });

  it("counts exactly 60% as the higher band", () => {
    render(answers(5, 3));
    expect(screen.getByRole("heading", { name: "جيد! مجهود طيب" })).toBeInTheDocument();
  });

  it("gives the trophy its colour only from 80% up", () => {
    const { container, unmount } = render(answers(5, 4));
    expect(container.querySelector(".text-primary")).toBeInTheDocument();
    unmount();

    const low = render(answers(5, 3));
    expect(low.container.querySelector(".lucide-trophy")?.getAttribute("class")).toContain(
      "text-muted-foreground",
    );
  });

  it("scores a quiz with no answers as neither passed nor failed", () => {
    // 0/0 is NaN, and every band comparison against NaN is false, so the chain
    // used to fall through to the worst one: "Try again!" over "NaN% correct".
    // A topic whose words were all deleted, or a quiz abandoned before the
    // first answer, told the learner they failed a quiz they never took.
    render([], 0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ما فيه أسئلة تُحتسب" })).toBeInTheDocument();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("leaves the percentage off a quiz with no answers", () => {
    // There is no percentage to report, and "0% correct" would be the same lie
    // in a politer font.
    render([], 0);
    expect(screen.queryByText(/% correct/)).not.toBeInTheDocument();
  });

  it("still calls a genuine zero a failure", () => {
    render(answers(4, 0));
    expect(screen.getByRole("heading", { name: "حاول مرة ثانية!" })).toBeInTheDocument();
    expect(screen.getByText("0% correct")).toBeInTheDocument();
  });
});

describe("QuizResults — the answer review", () => {
  it("lists every question, in the order they were asked", () => {
    render(answers(3, 1));
    const arabic = screen.getAllByText(/^كلمة/).map((el) => el.textContent);
    expect(arabic).toEqual(["كلمة0", "كلمة1", "كلمة2"]);
  });

  it("shows just the meaning for a word the learner got right", () => {
    render([{ word: anWord(), correct: true }]);
    expect(screen.getByText("bread")).toBeInTheDocument();
  });

  it("shows the wrong answer struck through beside the right one", () => {
    // Side by side rather than in separate lines: the correction has to be
    // readable as one thought or it is just two facts.
    const { container } = render([{ word: anWord(), correct: false, userAnswer: "meat" }]);
    expect(container.querySelector(".line-through")).toHaveTextContent("meat");
    expect(screen.getByText("bread")).toBeInTheDocument();
    expect(container.textContent).toContain("→");
  });

  it("shows only the right answer when there was nothing to compare", () => {
    // A timed-out or skipped question has no user answer, and an empty strike
    // through would read as "you said nothing" rather than "you ran out".
    const { container } = render([{ word: anWord(), correct: false }]);
    expect(container.querySelector(".line-through")).toBeNull();
    expect(container.textContent).not.toContain("→");
    expect(screen.getByText("bread")).toBeInTheDocument();
  });

  it("marks each row right or wrong at a glance", () => {
    const { container } = render(answers(2, 1));
    expect(container.querySelector("svg.text-success")).toBeInTheDocument();
    expect(container.querySelector("svg.text-destructive")).toBeInTheDocument();
  });

  it("tints the row by outcome", () => {
    const { container } = render(answers(2, 1));
    expect(container.querySelector(".bg-success\\/5")).toBeInTheDocument();
    expect(container.querySelector(".bg-destructive\\/5")).toBeInTheDocument();
  });

  it("renders the Arabic right-to-left", () => {
    render([{ word: anWord(), correct: true }]);
    expect(screen.getByText("خبز")).toHaveAttribute("dir", "rtl");
  });

  it("keeps both rows when the same word was asked twice", () => {
    // The quiz can repeat a word across rounds, and collapsing the duplicates
    // would hide the fact that it was got right once and wrong once.
    render([
      { word: anWord(), correct: true },
      { word: anWord(), correct: false, userAnswer: "meat" },
    ]);
    expect(screen.getAllByText("خبز")).toHaveLength(2);
  });

  it("still shows the review heading for an empty quiz", () => {
    render([], 0);
    expect(screen.getByText("راجع إجاباتك")).toBeInTheDocument();
  });
});

describe("QuizResults — what happens next", () => {
  it("offers another go at the same topic", () => {
    const { onRestart } = render(answers(3, 1));
    fireEvent.click(screen.getByRole("button", { name: /جرّب مرة ثانية/ }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("offers the way back to the topic list", () => {
    const { onHome } = render(answers(3, 1));
    fireEvent.click(screen.getByRole("button", { name: /رجوع للمواضيع/ }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it("puts the retry above the exit", () => {
    // Retrying is the thing a learner who just scored badly should find first.
    const { onRestart, onHome, ...rest } = render(answers(5, 1));
    const buttons = rest.container.querySelectorAll(".space-y-3 > button");
    expect(buttons[0]).toHaveTextContent("جرّب مرة ثانية");
    expect(buttons[1]).toHaveTextContent("رجوع للمواضيع");
  });

  it("offers both even on a perfect score", () => {
    render(answers(4, 4));
    expect(screen.getByRole("button", { name: /جرّب مرة ثانية/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /رجوع للمواضيع/ })).toBeInTheDocument();
  });
});
