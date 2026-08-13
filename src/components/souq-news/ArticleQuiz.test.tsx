import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aProfile, TEST_USER_ID } from "@/test/support/factories";
import { ArticleQuiz } from "./ArticleQuiz";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The comprehension check under a Souq News article.
 *
 * Reading a news article in English is the closest thing in the app to real
 * input, and it is also the easiest place to fool yourself: a learner who
 * recognises half the words comes away believing they followed it. The quiz is
 * the check on that, and it is generated from the article rather than authored,
 * so it exists for whatever the crawler brought in that morning.
 *
 * It is deliberately optional and hidden behind a button. Making everyone take
 * a test after every article would make reading feel like homework, which is
 * the thing this section exists to avoid.
 */

const AN_ARTICLE = {
  title_english: "Market news",
  body_english: "Prices rose in the market today.",
  title_arabic: "أخبار السوق",
  summary_arabic: "ارتفعت الأسعار في السوق اليوم",
};

const aQuestion = (over: Record<string, unknown> = {}) => ({
  question_english: "What happened at the market?",
  question_arabic: "شنو صار في السوق؟",
  choices: [
    { english: "Prices rose", arabic: "ارتفعت الأسعار", correct: true },
    { english: "Prices fell", arabic: "انخفضت الأسعار", correct: false },
  ],
  explanation: "المقال يقول إن الأسعار ارتفعت — prices rose.",
  ...over,
});

let cleanup: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  localStorage.clear();
});

function render(questions: Array<Record<string, unknown>> = [aQuestion()], dialect = "Gulf") {
  localStorage.setItem("ingleezy_dialect_module", dialect);
  const harness = renderWithProviders(<ArticleQuiz article={AN_ARTICLE} />, {
    persona: "free",
    seed: (backend: SupabaseBackend) => {
      backend.db.seed("profiles", [
        aProfile({ user_id: TEST_USER_ID, preferred_dialect: dialect }),
      ]);
      backend.stubFunction("souq-news-quiz", { questions });
    },
  });
  cleanup = harness.cleanup;
  return harness;
}

const startQuiz = async () => {
  fireEvent.click(screen.getByRole("button", { name: /test comprehension/i }));
  await waitFor(() => expect(screen.getByText(/^Question 1\//)).toBeInTheDocument());
};

const answer = (english: string) =>
  fireEvent.click(screen.getByText(english).closest("button")!);

describe("offering the quiz", () => {
  it("stays out of the way until it is asked for", () => {
    render();

    // Reading is the exercise. A test that appeared under every article would
    // make the section feel like homework, which is what it is not.
    expect(screen.getByRole("button", { name: /test comprehension/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Question/)).not.toBeInTheDocument();
  });

  it("generates the questions from the article itself", async () => {
    const { backend } = render();

    await startQuiz();

    // Both the English body and the Arabic summary: the questions have to be
    // answerable from what was actually written, not from general knowledge
    // about markets.
    expect(backend.lastCallTo("souq-news-quiz")?.body).toMatchObject({
      dialect: "Gulf",
      title_english: AN_ARTICLE.title_english,
      body_english: AN_ARTICLE.body_english,
      summary_arabic: AN_ARTICLE.summary_arabic,
    });
  });

  it("asks in the dialect the learner reads in", async () => {
    const { backend } = render([aQuestion()], "Egyptian");

    await startQuiz();

    expect(backend.lastCallTo("souq-news-quiz")?.body).toMatchObject({ dialect: "Egyptian" });
  });

  it("stays on the button when the quiz cannot be generated", async () => {
    const harness = renderWithProviders(<ArticleQuiz article={AN_ARTICLE} />, {
      persona: "free",
      seed: (backend) => backend.stubFunctionFailure("souq-news-quiz", 500),
    });
    cleanup = harness.cleanup;

    fireEvent.click(screen.getByRole("button", { name: /test comprehension/i }));

    // The article is still readable; a failed optional extra must not replace
    // it with an error.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /test comprehension/i })).toBeInTheDocument(),
    );
  });

  it("ignores a reply with no questions in it", async () => {
    const harness = renderWithProviders(<ArticleQuiz article={AN_ARTICLE} />, {
      persona: "free",
      seed: (backend) => backend.stubFunction("souq-news-quiz", { questions: "none" }),
    });
    cleanup = harness.cleanup;

    fireEvent.click(screen.getByRole("button", { name: /test comprehension/i }));

    // A model answering in prose would otherwise be mapped over character by
    // character.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /test comprehension/i })).toBeInTheDocument(),
    );
  });
});

describe("answering a question", () => {
  it("shows the question in English with the Arabic beneath", async () => {
    render();

    await startQuiz();

    // The English is the exercise; the dialect gloss is there so a learner who
    // cannot parse the question still gets to attempt the comprehension.
    expect(screen.getByText("What happened at the market?")).toBeInTheDocument();
    expect(screen.getByText("شنو صار في السوق؟")).toHaveAttribute("dir", "rtl");
  });

  it("counts a right answer", async () => {
    render();
    await startQuiz();

    answer("Prices rose");

    expect(screen.getByText("1 correct")).toBeInTheDocument();
  });

  it("does not count a wrong one", async () => {
    render();
    await startQuiz();

    answer("Prices fell");

    expect(screen.getByText("0 correct")).toBeInTheDocument();
  });

  it("explains the answer either way", async () => {
    render();
    await startQuiz();

    answer("Prices fell");

    // Pointing at the sentence in the article is the whole teaching moment —
    // being told you were wrong without being shown where is not. The why
    // arrives in the learner's own dialect.
    expect(
      screen.getByText(/المقال يقول إن الأسعار ارتفعت/),
    ).toBeInTheDocument();
  });

  it("stops accepting answers once one is given", async () => {
    render();
    await startQuiz();

    answer("Prices fell");
    answer("Prices rose");

    // Otherwise the learner clicks until the green one appears and the score
    // measures nothing.
    expect(screen.getByText("0 correct")).toBeInTheDocument();
    for (const choice of ["Prices rose", "Prices fell"]) {
      expect(screen.getByText(choice).closest("button")).toBeDisabled();
    }
  });

  it("offers no way forward until something is chosen", async () => {
    render();
    await startQuiz();

    // Skipping past a question would let a learner reach a perfect-looking
    // score without answering anything.
    expect(screen.queryByRole("button", { name: /next question|see results/i })).toBeNull();
  });
});

describe("working through the quiz", () => {
  const TWO = [
    aQuestion(),
    aQuestion({
      question_arabic: "متى؟",
      question_english: "When?",
      choices: [
        { arabic: "اليوم", english: "Today", correct: true },
        { arabic: "أمس", english: "Yesterday", correct: false },
      ],
      explanation: "It says اليوم.",
    }),
  ];

  it("moves on to the next question", async () => {
    render(TWO);
    await startQuiz();
    answer("Prices rose");

    fireEvent.click(screen.getByRole("button", { name: /next question/i }));

    expect(screen.getByText("Question 2/2")).toBeInTheDocument();
    expect(screen.getByText("When?")).toBeInTheDocument();
  });

  it("clears the previous answer on the way", async () => {
    render(TWO);
    await startQuiz();
    answer("Prices rose");
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));

    // An explanation carried over would be an explanation of the wrong
    // question, and the choices would arrive already locked.
    expect(screen.queryByText(/المقال يقول/)).not.toBeInTheDocument();
    expect(screen.getByText("Today").closest("button")).not.toBeDisabled();
  });

  it("offers the results rather than a next question at the end", async () => {
    render(TWO);
    await startQuiz();
    answer("Prices rose");
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));

    answer("Today");

    expect(screen.getByRole("button", { name: /see results/i })).toBeInTheDocument();
  });
});

describe("the result", () => {
  const finishWith = async (choice: string) => {
    render();
    await startQuiz();
    answer(choice);
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));
  };

  it("congratulates a clean sweep", async () => {
    await finishWith("Prices rose");

    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(screen.getByText(/Perfect! You understood everything/)).toBeInTheDocument();
  });

  it("sends a learner who missed most of it back to the article", async () => {
    await finishWith("Prices fell");

    // The useful outcome of failing a comprehension check is rereading, not a
    // score — and saying so is the difference between a test and a lesson.
    expect(screen.getByText("0/1")).toBeInTheDocument();
    expect(screen.getByText(/Try re-reading the article/)).toBeInTheDocument();
  });

  it("encourages a middling score", async () => {
    render([
      aQuestion(),
      aQuestion({
        question_english: "When?",
        choices: [
          { arabic: "اليوم", english: "Today", correct: true },
          { arabic: "أمس", english: "Yesterday", correct: false },
        ],
      }),
    ]);
    await startQuiz();
    answer("Prices rose");
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    answer("Yesterday");
    fireEvent.click(screen.getByRole("button", { name: /see results/i }));

    // Half is a pass here on purpose: following half a native news article is
    // real progress, and calling it a failure is how people stop reading.
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText(/Good job! Keep reading/)).toBeInTheDocument();
  });

  it("goes back to the article when closed", async () => {
    await finishWith("Prices rose");

    fireEvent.click(screen.getByRole("button", { name: /close quiz/i }));

    expect(screen.getByRole("button", { name: /test comprehension/i })).toBeInTheDocument();
  });
});
