import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SentenceReader } from "./SentenceReader";

/**
 * A body of Arabic — a Souq News article, Today's Story — one sentence to a
 * card.
 *
 * News and a 200-word story are the hardest things a learner reads, so the body
 * is broken up rather than presented as a block: one line at a time, the
 * English hidden behind a tap so the eye cannot cheat, and every word tappable
 * for a gloss. When the generator returns per-sentence pairs the split is
 * authored; when it does not, the component falls back to splitting the Arabic
 * on punctuation, which gives the same shape with no translations to reveal.
 *
 * The three children are covered by their own files and stood in for here, so
 * what stays visible is the splitting, the reveal state, and — the part that
 * matters most — what English each line claims to mean.
 */

interface TappableProps {
  text: string;
  vocabulary: { word_arabic: string; word_english: string }[];
  source: string;
  sentenceContext: { arabic: string; english: string };
}
interface AskProps {
  arabic: string;
  english: string;
  variant: string;
}
interface PairProps {
  variant: string;
  literal?: string;
  natural: string;
}

const spies = vi.hoisted(() => ({
  tappable: [] as TappableProps[],
  ask: [] as AskProps[],
  pair: [] as PairProps[],
}));

vi.mock("@/components/shared/TappableArabicText", () => ({
  TappableArabicText: (props: TappableProps) => {
    spies.tappable.push(props);
    return <p data-testid="arabic">{props.text}</p>;
  },
}));
vi.mock("@/components/shared/AskAISentence", () => ({
  AskAISentence: (props: AskProps) => {
    spies.ask.push(props);
    return <button data-testid="ask">Ask AI</button>;
  },
}));
vi.mock("@/components/shared/TranslationPair", () => ({
  TranslationPair: (props: PairProps) => {
    spies.pair.push(props);
    return <p data-testid="pair">{props.natural}</p>;
  },
}));

beforeEach(() => {
  spies.tappable = [];
  spies.ask = [];
  spies.pair = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

const BODY = "أعلنت قطر عن خط سكة حديد جديد. بدأ العمل أمس. ينتهي في ٢٠٣٠؟ نعم!";

interface Options {
  body?: string;
  sentences?: {
    arabic: string;
    transliteration?: string;
    english?: string;
    literal?: string;
  }[];
  vocabulary?: { word_arabic: string; word_english: string }[];
  source?: string;
  revealByDefault?: boolean;
}

function renderArticle({
  body = BODY,
  sentences,
  vocabulary,
  source = "souq-news",
  revealByDefault,
}: Options = {}) {
  return render(
    <SentenceReader
      body={body}
      sentences={sentences}
      vocabulary={vocabulary}
      source={source}
      revealByDefault={revealByDefault}
    />,
  );
}

const authored = [
  { arabic: "أعلنت قطر عن خط سكة حديد جديد.", english: "Qatar announced a new rail link." },
  { arabic: "بدأ العمل أمس.", english: "Work began yesterday." },
];

describe("SentenceReader — splitting the article up", () => {
  it("uses the authored sentences when the generator supplied them", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByTestId("arabic").map((el) => el.textContent)).toEqual([
      authored[0].arabic,
      authored[1].arabic,
    ]);
  });

  it("falls back to splitting the body on sentence endings", () => {
    renderArticle();
    expect(screen.getAllByTestId("arabic")).toHaveLength(4);
  });

  it("recognises the Arabic question mark as an ending", () => {
    // ؟ is a different code point from ?, and an Arabic article uses it — a
    // splitter that only knew the Latin one would run two sentences together.
    renderArticle({ body: "سؤال؟ جواب." });
    expect(screen.getAllByTestId("arabic").map((el) => el.textContent)).toEqual([
      "سؤال؟",
      "جواب.",
    ]);
  });

  it("splits on line breaks as well as punctuation", () => {
    renderArticle({ body: "سطر أول\nسطر ثاني" });
    expect(screen.getAllByTestId("arabic")).toHaveLength(2);
  });

  it("keeps a body with no punctuation as one line", () => {
    renderArticle({ body: "جملة بدون علامات" });
    expect(screen.getAllByTestId("arabic")).toHaveLength(1);
  });

  it("drops the empty pieces a trailing full stop leaves behind", () => {
    renderArticle({ body: "جملة." });
    expect(screen.getAllByTestId("arabic")).toHaveLength(1);
  });

  it("renders nothing but the hint for an empty body", () => {
    renderArticle({ body: "" });
    expect(screen.queryAllByTestId("arabic")).toEqual([]);
    expect(screen.getByText(/Tap any word for translation/)).toBeInTheDocument();
  });

  it("prefers even a single authored sentence over the splitter", () => {
    renderArticle({ sentences: [authored[0]] });
    expect(screen.getAllByTestId("arabic")).toHaveLength(1);
  });

  it("falls back when the generator returned an empty list", () => {
    renderArticle({ sentences: [] });
    expect(screen.getAllByTestId("arabic")).toHaveLength(4);
  });
});

describe("SentenceReader — revealing the English", () => {
  it("starts with every translation hidden", () => {
    renderArticle({ sentences: authored });
    expect(screen.getAllByText("Reveal translation")).toHaveLength(2);
  });

  it("reveals one line without revealing the rest", () => {
    // The whole point is reading line by line; revealing all of them would be
    // the article with a translation under it, which is not practice.
    renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[0]);

    expect(screen.getByText("Hide translation")).toBeInTheDocument();
    expect(screen.getAllByText("Reveal translation")).toHaveLength(1);
  });

  it("hides it again on a second tap", () => {
    renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[0]);
    fireEvent.click(screen.getByText("Hide translation"));
    expect(screen.getAllByText("Reveal translation")).toHaveLength(2);
  });

  it("offers no reveal on a line the generator could not translate", () => {
    // The fallback splitter produces lines with no English at all, and a
    // control that reveals nothing is worse than no control.
    renderArticle();
    expect(screen.queryByText("Reveal translation")).not.toBeInTheDocument();
  });

  it("offers the reveal on a line that has only a literal gloss", () => {
    // A gloss without a natural translation is still something to reveal, and
    // gating on the English alone hid it behind a control that never appeared.
    renderArticle({ sentences: [{ arabic: "جملة.", literal: "sentence" }] });
    expect(screen.getByText("Reveal translation")).toBeInTheDocument();
  });

  it("starts every line open when the learner reads with English on", () => {
    // The display preference is "show me the English"; making them tap each
    // line to get back to the setting they already chose is the wrong default.
    renderArticle({ sentences: authored, revealByDefault: true });
    expect(screen.getAllByText("Hide translation")).toHaveLength(2);
  });

  it("still lets a line be closed when English is on by default", () => {
    renderArticle({ sentences: authored, revealByDefault: true });
    fireEvent.click(screen.getAllByText("Hide translation")[0]);
    expect(screen.getByText("Reveal translation")).toBeInTheDocument();
    expect(screen.getAllByText("Hide translation")).toHaveLength(1);
  });

  it("passes the literal gloss to the translation pair", () => {
    renderArticle({
      sentences: [{ ...authored[0], literal: "announced Qatar about line rail iron new" }],
    });
    expect(spies.pair[0]).toMatchObject({
      variant: "compact",
      literal: "announced Qatar about line rail iron new",
      natural: authored[0].english,
    });
  });

  it("closes line two when the article changes underneath it", () => {
    // `revealed` is a set of positions with no tie to the content, so the same
    // positions used to stay open: a reader who revealed line 2 of one story
    // opened the next with line 2 already translated — the exact thing a
    // sentence-by-sentence exercise exists to prevent.
    const { rerender } = renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[1]);
    expect(screen.getByText("Hide translation")).toBeInTheDocument();

    rerender(
      <SentenceReader
        body={BODY}
        source="souq-news"
        sentences={[
          { arabic: "خبر جديد أول.", english: "A different first line." },
          { arabic: "خبر جديد ثاني.", english: "A different second line." },
        ]}
      />,
    );
    expect(screen.queryByText("Hide translation")).not.toBeInTheDocument();
  });

  it("leaves a revealed line alone when the parent merely re-renders", () => {
    // The parent rebuilds the sentence array on every render, so identity is
    // not a usable signal — closing on that would undo the reader's own tap.
    const { rerender } = renderArticle({ sentences: authored });
    fireEvent.click(screen.getAllByText("Reveal translation")[1]);

    rerender(
      <SentenceReader
        body={BODY}
        source="souq-news"
        sentences={authored.map((s) => ({ ...s }))}
      />,
    );
    expect(screen.getByText("Hide translation")).toBeInTheDocument();
  });
});

describe("SentenceReader — the word gloss", () => {
  it("makes every line tappable", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable).toHaveLength(2);
  });

  it("tags the lookups with the surface the reader is on", () => {
    // The source is what lets a saved word be traced back to where it was met,
    // which is most of the value of saving it. Two surfaces share this reader,
    // so it cannot be hardcoded to either.
    renderArticle({ sentences: authored, source: "daily-story" });
    expect(spies.tappable[0].source).toBe("daily-story");
  });

  it("hands the article's own glossary down so known words resolve locally", () => {
    const vocabulary = [{ word_arabic: "قطر", word_english: "Qatar" }];
    renderArticle({ sentences: authored, vocabulary });
    expect(spies.tappable[0].vocabulary).toEqual(vocabulary);
  });

  it("copes with an article that has no glossary", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable[0].vocabulary).toEqual([]);
  });

  it("gives each word its own sentence for context", () => {
    renderArticle({ sentences: authored });
    expect(spies.tappable[1].sentenceContext).toEqual({
      arabic: authored[1].arabic,
      english: authored[1].english,
    });
  });

  it("shows the transliteration when the generator provided one", () => {
    renderArticle({
      sentences: [{ ...authored[0], transliteration: "a'lanat qatar 'an khatt sikka hadid jadid" }],
    });
    expect(screen.getByText("a'lanat qatar 'an khatt sikka hadid jadid")).toBeInTheDocument();
  });

  it("leaves it out when there is none", () => {
    const { container } = renderArticle({ sentences: authored });
    expect(container.querySelector(".italic")).toBeNull();
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
    // Both the AI chip and the word-gloss context fell back to
    // `line.english || summaryEnglish`. On the authored path that never fires;
    // on the split-sentence path every line has an empty English, so each was
    // sent up paired with the article's entire summary — telling the model, and
    // the word lookup that produces the gloss a learner then saves, that a
    // four-word sentence means a paragraph.
    renderArticle();
    expect(spies.ask[0]).toMatchObject({
      arabic: "أعلنت قطر عن خط سكة حديد جديد.",
      english: "",
    });
    expect(spies.tappable[0].sentenceContext.english).toBe("");
  });
});
