import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aLesson, lessonId } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { VocabPreviewCard } from "./VocabPreviewCard";

/**
 * The gate between a model's vocabulary suggestion and the curriculum.
 *
 * Everything the builder produces lands here first, because the cost of a bad
 * word reaching the deck is high and asymmetric: it is taught, reviewed, and
 * scheduled for months before anyone notices. So the card is a review surface —
 * every word is shown with its transliteration and category, everything arrives
 * ticked so the common case is one click, and nothing can be filed until a
 * destination lesson has been chosen.
 */

const aVocabItem = (over: Record<string, unknown> = {}) => ({
  word_arabic: "مطعم",
  word_english: "restaurant",
  transliteration: "mat'am",
  category: "places",
  ...over,
});

const SUGGESTION = {
  vocabulary: [
    aVocabItem(),
    aVocabItem({ word_arabic: "قائمة", word_english: "menu", transliteration: "qa'ima" }),
    aVocabItem({ word_arabic: "حساب", word_english: "bill", transliteration: "hisaab" }),
  ],
};

let cleanup: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

interface Options {
  data?: Record<string, unknown>;
  lessons?: Array<{ id: string; title: string; icon?: string; title_arabic?: string | null }>;
  seed?: (backend: SupabaseBackend) => void;
}

const DEFAULT_LESSONS = [
  { id: lessonId(1), title: "At the restaurant", icon: "🍽️", title_arabic: "في المطعم" },
  { id: lessonId(2), title: "Getting around", icon: "🚕", title_arabic: null },
];

function render({ data = SUGGESTION, lessons = DEFAULT_LESSONS, seed }: Options = {}) {
  const onApprove = vi.fn();
  const harness = renderWithProviders(
    <VocabPreviewCard data={data} onApprove={onApprove} />,
    {
      persona: "admin",
      seed: (backend) => {
        backend.db.seed(
          "lessons",
          lessons.map((lesson, index) =>
            aLesson({
              id: lesson.id,
              title: lesson.title,
              title_arabic: lesson.title_arabic ?? null,
              icon: lesson.icon ?? "📚",
              display_order: index + 1,
              dialect_module: "Gulf",
            }),
          ),
        );
        seed?.(backend);
      },
    },
  );
  cleanup = harness.cleanup;
  return { ...harness, onApprove };
}

const rows = () => screen.getAllByRole("row").slice(1); // drop the header
const rowFor = (arabic: string) => rows().find((r) => r.textContent?.includes(arabic))!;
const boxIn = (row: HTMLElement) => within(row).getByRole("checkbox");
const selectAll = () => within(screen.getAllByRole("row")[0]).getByRole("checkbox");
const addButton = () => screen.getByRole("button", { name: /Add \d+ Words/ });

/** Opens the lesson dropdown and picks the option whose label contains `text`. */
const chooseLesson = async (text: string) => {
  fireEvent.click(screen.getByRole("combobox"));
  // The lesson list is a query, so the dropdown opens before its options exist.
  const option = await screen.findByRole("option", { name: new RegExp(text) });
  fireEvent.click(option);
};

describe("showing the suggestion", () => {
  it("lists every word with what is needed to judge it", () => {
    render();

    // Arabic alone is not reviewable at speed: the transliteration is what lets
    // a non-native admin catch a wrong vowel, and the category is what catches a
    // word filed under the wrong topic.
    const row = rowFor("مطعم");
    expect(within(row).getByText("restaurant")).toBeInTheDocument();
    expect(within(row).getByText("mat'am")).toBeInTheDocument();
    expect(within(row).getByText("places")).toBeInTheDocument();
  });

  it("marks a word the model gave no transliteration for", () => {
    render({ data: { vocabulary: [aVocabItem({ transliteration: undefined })] } });

    // A blank cell reads as a rendering fault; a dash reads as missing data.
    expect(within(rowFor("مطعم")).getByText("-")).toBeInTheDocument();
  });

  it("leaves the category blank when the model did not give one", () => {
    render({ data: { vocabulary: [aVocabItem({ category: undefined })] } });

    expect(within(rowFor("مطعم")).queryByText("places")).toBeNull();
  });

  it("renders nothing at all when there are no words", () => {
    const { container } = render({ data: { vocabulary: [] } });

    // The card is rendered speculatively against every model reply; an empty
    // shell above the chat would be noise.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the reply had no vocabulary key", () => {
    const { container } = render({ data: { lesson: { title: "Something else" } } });

    expect(container).toBeEmptyDOMElement();
  });

  it("gathers the teaching notes where the model left them", () => {
    render({
      data: {
        vocabulary: [
          aVocabItem({ teaching_note: "Only in the Gulf; Egyptians say مطعم too." }),
          aVocabItem({ word_arabic: "قائمة", word_english: "menu" }),
        ],
      },
    });

    // The notes are the part an admin needs to read before approving, and
    // hunting for them cell by cell means they are not read.
    expect(screen.getByText("Teaching Notes:")).toBeInTheDocument();
    expect(screen.getByText(/Only in the Gulf/)).toBeInTheDocument();
  });

  it("says nothing about teaching notes when there are none", () => {
    render();

    expect(screen.queryByText("Teaching Notes:")).toBeNull();
  });

  it("shows the dialect note that applies to the whole set", () => {
    render({ data: { ...SUGGESTION, dialect_notes: "Gulf forms throughout." } });

    expect(screen.getByText("Dialect Notes:")).toBeInTheDocument();
    expect(screen.getByText(/Gulf forms throughout/)).toBeInTheDocument();
  });
});

describe("choosing what to keep", () => {
  it("arrives with everything ticked", () => {
    render();

    // A model asked for ten words about restaurants usually gets most of them
    // right; the checkboxes are for pruning, not for choosing from scratch.
    expect(screen.getByText("3/3 selected")).toBeInTheDocument();
    expect(addButton()).toHaveTextContent("Add 3 Words");
  });

  it("drops a word when its box is unticked", () => {
    render();

    fireEvent.click(boxIn(rowFor("قائمة")));

    expect(screen.getByText("2/3 selected")).toBeInTheDocument();
    expect(rowFor("قائمة").className).toContain("opacity-50");
  });

  it("can be toggled from anywhere in the row", () => {
    render();

    fireEvent.click(rowFor("قائمة"));

    // The checkbox is a small target in a dense table; the row is the affordance
    // an admin actually aims at.
    expect(screen.getByText("2/3 selected")).toBeInTheDocument();
  });

  it("does not double-toggle when the box itself is clicked", () => {
    render();

    fireEvent.click(boxIn(rowFor("قائمة")));

    // The box sits inside the clickable row. Without stopping the bubble the
    // two handlers cancel out and the checkbox appears dead.
    expect(screen.getByText("2/3 selected")).toBeInTheDocument();
  });

  it("clears everything at once", () => {
    render();

    fireEvent.click(selectAll());

    expect(screen.getByText("0/3 selected")).toBeInTheDocument();
  });

  it("takes everything back at once", () => {
    render();
    fireEvent.click(selectAll());

    fireEvent.click(selectAll());

    // Unticking all then reconsidering is the ordinary way to keep two words out
    // of ten.
    expect(screen.getByText("3/3 selected")).toBeInTheDocument();
  });

  it("takes a word back after unticking it", () => {
    render();
    fireEvent.click(boxIn(rowFor("قائمة")));

    fireEvent.click(boxIn(rowFor("قائمة")));

    expect(screen.getByText("3/3 selected")).toBeInTheDocument();
  });
});

describe("filing the words", () => {
  it("will not file without a destination", () => {
    render();

    // Vocabulary with no lesson is invisible to the curriculum and to the
    // learner — it exists only in the table.
    expect(addButton()).toBeDisabled();
  });

  it("will not file an empty selection", async () => {
    render();
    await chooseLesson("At the restaurant");

    fireEvent.click(selectAll());

    expect(addButton()).toBeDisabled();
  });

  it("offers the lessons of the active dialect", async () => {
    render();

    fireEvent.click(screen.getByRole("combobox"));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /At the restaurant/ })).toBeInTheDocument(),
    );
    // The Arabic title is shown beside the English so an admin working from the
    // Arabic curriculum can find the lesson they mean.
    expect(screen.getByRole("option", { name: /في المطعم/ })).toBeInTheDocument();
  });

  it("copes with a lesson that has no Arabic title", async () => {
    render();

    fireEvent.click(screen.getByRole("combobox"));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Getting around/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: /Getting around/ }).textContent).not.toContain("·");
  });

  it("hands over the lesson and exactly the words that were kept", async () => {
    const { onApprove } = render();
    await chooseLesson("At the restaurant");

    fireEvent.click(boxIn(rowFor("قائمة")));
    fireEvent.click(addButton());

    // Indices rather than words: the caller re-reads them from the same payload,
    // so a word the admin unticked must not be in the list.
    expect(onApprove).toHaveBeenCalledWith(lessonId(1), expect.arrayContaining([0, 2]));
    expect(onApprove.mock.calls[0][1]).toHaveLength(2);
  });

  it("files all of them when nothing was pruned", async () => {
    const { onApprove } = render();
    await chooseLesson("At the restaurant");

    fireEvent.click(addButton());

    expect(onApprove).toHaveBeenCalledWith(lessonId(1), [0, 1, 2]);
  });

  it("counts down on the button as words are dropped", () => {
    render();

    fireEvent.click(boxIn(rowFor("قائمة")));

    // The button is the last thing read before committing, so the count on it
    // has to be the real one.
    expect(addButton()).toHaveTextContent("Add 2 Words");
  });

  it("has nothing to offer when the dialect has no lessons yet", async () => {
    render({ lessons: [] });

    fireEvent.click(screen.getByRole("combobox"));

    // Pinned: with no lessons the dropdown opens empty and the Add button stays
    // disabled, with nothing on screen saying why. An admin drafting the first
    // lesson of a dialect hits this on their first approval and has no way to
    // tell the card from a broken one. (Radix marks the rest of the page
    // aria-hidden while the dropdown is open, hence the `hidden` option.)
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Add \d+ Words/, hidden: true })).toBeDisabled();
  });
});
