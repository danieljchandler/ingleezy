import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SentenceReader } from "./SentenceReader";

/**
 * A body of English — a Souq News article — one sentence to a card.
 *
 * A news article is among the hardest things a learner reads, so the body is
 * broken up rather than presented as a block: one line at a time, the Arabic
 * scaffold hidden behind a tap so the eye cannot cheat, and every English word
 * tappable for a dialect gloss. When the generator returns per-sentence pairs
 * the split is authored; when it does not, the component falls back to
 * splitting the English on punctuation, which gives the same shape with no
 * translations to reveal.
 *
 * The two children are covered by their own files and stood in for here, so
 * what stays visible is the splitting, the reveal state, and — the part that
 * matters most — what Arabic each line claims to mean.
 */

interface TappableProps {
  text: string;
  sentenceArabic?: string;
  source: string;
  onSaveWord?: (word: unknown) => void;
}
interface AskProps {
  arabic: string;
  english: string;
  variant: string;
}

const spies = vi.hoisted(() => ({
  tappable: [] as TappableProps[],
  ask: [] as AskProps[],
}));

vi.mock("@/components/shared/TappableEnglishText", () => ({
  TappableEnglishText: (props: TappableProps) => {
    spies.tappable.push(props);
    return <span data-testid="english">{props.text}</span>;
  },
}));
vi.mock("@/components/shared/AskAISentence", () => ({
  AskAISentence: (props: AskProps) => {
    spies.ask.push(props);
    return <button data-testid="ask">Ask AI</button>;
  },
}));

beforeEach(() => {
  spies.tappable = [];
  spies.ask = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

const BODY = "Qatar announced a new rail link. Work began yesterday. Done by 2030? Yes!";

interface Options {
  body?: string;
  sentences?: { english: string; arabic?: string; literal?: string }[];
  source?: string;
  revealByDefault?: boolean;
  onSaveWord?: (word: unknown) => void;
}

function renderArticle({
  body = BODY,
  sentences,
  source = "souq-news",
  revealByDefault,
  onSaveWord,
}: Options = {}) {
  return render(
    <SentenceReader
      body={body}
      sentences={sentences}
      source={source}
      revealByDefault={revealByDefault}
      onSaveWord={onSaveWord}
    />,
  );
}

const authored = [
  { english: "Qatar announced a new rail link.", arabic: "قطر أعلنت عن خط قطار جديد." },
  { english: "Work began yesterday.", arabic: "الشغل بدأ أمس." },
];

describe("SentenceReader — splitting the article up", () => {
  it("uses the authored sentences when the generator supplied them", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByTestId("english").map((el) => el.textContent)).toEqual([
      authored[0].english,
      authored[1].english,
    ]);
  });

  it("falls back to splitting the body on sentence endings", () => {
    renderArticle();
    expect(screen.getAllByTestId("english")).toHaveLength(4);
  });

  it("splits on line breaks as well as punctuation", () => {
    renderArticle({ body: "First line\nSecond line" });
    expect(screen.getAllByTestId("english")).toHaveLength(2);
  });

  it("keeps a body with no punctuation as one line", () => {
    renderArticle({ body: "a sentence without any endings" });
    expect(screen.getAllByTestId("english")).toHaveLength(1);
  });

  it("drops the empty pieces a trailing full stop leaves behind", () => {
    renderArticle({ body: "One sentence." });
    expect(screen.getAllByTestId("english")).toHaveLength(1);
  });

  it("renders nothing but the hint for an empty body", () => {
    renderArticle({ body: "" });
    expect(screen.queryAllByTestId("english")).toEqual([]);
    expect(screen.getByText(/Tap any word for translation/)).toBeInTheDocument();
  });

  it("prefers even a single authored sentence over the splitter", () => {
    renderArticle({ sentences: [authored[0]] });
    expect(screen.getAllByTestId("english")).toHaveLength(1);
  });

  it("falls back when the generator returned an empty list", () => {
    renderArticle({ sentences: [] });
    expect(screen.getAllByTestId("english")).toHaveLength(4);
  });

  it("drops an authored line the generator left without English", () => {
    // The English is the card; a card with only Arabic on it belongs to the
    // app this one was forked from.
    renderArticle({
      sentences: [authored[0], { english: "  ", arabic: "سطر بلا إنجليزي" }],
    });
    expect(screen.getAllByTestId("english")).toHaveLength(1);
  });
});

describe("SentenceReader — revealing the Arabic", () => {
  it("starts with every translation hidden", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByText("ورّني الترجمة")).toHaveLength(2);
  });

  it("reveals one line without revealing the rest", () => {
    // The whole point is reading line by line; revealing all of them would be
    // the article with a translation under it, which is not practice.
    renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("ورّني الترجمة")[0]);

    expect(screen.getByText("أخفِ الترجمة")).toBeInTheDocument();
    expect(screen.getAllByText("ورّني الترجمة")).toHaveLength(1);
  });

  it("hides it again on a second tap", () => {
    renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("ورّني الترجمة")[0]);
    fireEvent.click(screen.getByText("أخفِ الترجمة"));
    expect(screen.getAllByText("ورّني الترجمة")).toHaveLength(2);
  });

  it("offers no reveal on a line the generator could not translate", () => {
    // The fallback splitter produces lines with no Arabic at all, and a
    // control that reveals nothing is worse than no control.
    renderArticle();
    expect(screen.queryByText("ورّني الترجمة")).not.toBeInTheDocument();
  });

  it("offers the reveal on a line that has only a literal gloss", () => {
    // A gloss without a natural translation is still something to reveal, and
    // gating on the Arabic alone would hide it behind a control that never
    // appeared.
    renderArticle({ sentences: [{ english: "A sentence.", literal: "جملة" }] });
    expect(screen.getByText("ورّني الترجمة")).toBeInTheDocument();
  });

  it("shows the line's Arabic and its literal gloss when revealed", () => {
    renderArticle({
      sentences: [{ ...authored[0], literal: "قطر أعلنت a خط قطار جديد" }],
    });
    expect(screen.getByText(authored[0].arabic!)).toBeInTheDocument();
    expect(screen.getByText("قطر أعلنت a خط قطار جديد")).toBeInTheDocument();
  });

  it("starts every line open when the learner reads with the scaffold on", () => {
    // The display preference is "show me the Arabic"; making them tap each
    // line to get back to the setting they already chose is the wrong default.
    renderArticle({ sentences: authored, revealByDefault: true });
    expect(screen.getAllByText("أخفِ الترجمة")).toHaveLength(2);
  });

  it("still lets a line be closed when the scaffold is on by default", () => {
    renderArticle({ sentences: authored, revealByDefault: true });
    fireEvent.click(screen.getAllByText("أخفِ الترجمة")[0]);
    expect(screen.getByText("ورّني الترجمة")).toBeInTheDocument();
    expect(screen.getAllByText("أخفِ الترجمة")).toHaveLength(1);
  });

  it("closes line two when the article changes underneath it", () => {
    // `revealed` is a set of positions with no tie to the content, so the same
    // positions used to stay open: a reader who revealed line 2 of one story
    // opened the next with line 2 already translated — the exact thing a
    // sentence-by-sentence exercise exists to prevent.
    const { rerender } = renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("ورّني الترجمة")[1]);
    expect(screen.getByText("أخفِ الترجمة")).toBeInTheDocument();

    rerender(
      <SentenceReader
        body={BODY}
        source="souq-news"
        sentences={[
          { english: "A different first line.", arabic: "خبر جديد أول." },
          { english: "A different second line.", arabic: "خبر جديد ثاني." },
        ]}
      />,
    );
    expect(screen.queryByText("أخفِ الترجمة")).not.toBeInTheDocument();
  });

  it("leaves a revealed line alone when the parent merely re-renders", () => {
    // The parent rebuilds the sentence array on every render, so identity is
    // not a usable signal — closing on that would undo the reader's own tap.
    const { rerender } = renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("ورّني الترجمة")[1]);

    rerender(
      <SentenceReader
        body={BODY}
        source="souq-news"
        sentences={authored.map((s) => ({ ...s }))}
      />,
    );
    expect(screen.getByText("أخفِ الترجمة")).toBeInTheDocument();
  });
});

describe("SentenceReader — the word gloss", () => {
  it("makes every line tappable", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable).toHaveLength(2);
  });

  it("tags the lookups with the surface the reader is on", () => {
    // The source is what lets a saved word be traced back to where it was met,
    // which is most of the value of saving it.
    renderArticle({ sentences: authored, source: "daily-story" });
    expect(spies.tappable[0].source).toBe("daily-story");
  });

  it("gives each word its own sentence's Arabic for context", () => {
    // The line's scaffold rides along so a one-word lookup translates in
    // context rather than in the abstract.
    renderArticle({ sentences: authored });
    expect(spies.tappable[1].sentenceArabic).toBe(authored[1].arabic);
  });

  it("hands the save callback down to every line", () => {
    const onSaveWord = vi.fn();
    renderArticle({ sentences: authored, onSaveWord });
    expect(spies.tappable[0].onSaveWord).toBe(onSaveWord);
  });

  it("leaves saving out when the parent offered no way to save", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable[0].onSaveWord).toBeUndefined();
  });
});

describe("SentenceReader — asking the AI about a line", () => {
  it("puts the chip on every line", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByTestId("ask")).toHaveLength(2);
  });

  it("asks about the line, in its compact form", () => {
    renderArticle({ sentences: authored });
    expect(spies.ask[0]).toMatchObject({
      arabic: authored[0].arabic,
      english: authored[0].english,
      variant: "chip",
    });
  });

  it("does not pair a split line with the whole article summary", () => {
    // An absent scaffold is better described as absent: labelling a split
    // line with the article's summary would tell the assistant, and the word
    // lookup whose gloss a learner then saves, that a four-word sentence
    // means a paragraph.
    renderArticle();
    expect(spies.ask[0]).toMatchObject({
      arabic: "",
      english: "Qatar announced a new rail link.",
    });
    expect(spies.tappable[0].sentenceArabic).toBeUndefined();
  });
});
