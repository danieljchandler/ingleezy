import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import { aStage, stageId } from "@/test/support/factories";
import { LessonPreviewCard } from "./LessonPreviewCard";

/**
 * The gate between a model's whole-lesson draft and the curriculum.
 *
 * Its sibling, VocabPreviewCard, files loose words into an existing lesson.
 * This one files a lesson into a stage, which is the bigger commitment: stage
 * placement is what decides when a learner meets the material, and a lesson
 * dropped two stages too early is a wall rather than a step. So the card leads
 * with the things that determine placement — the CEFR target, the length, the
 * word count — and refuses to file until a stage has been chosen.
 */

const aVocabItem = (over: Record<string, unknown> = {}) => ({
  word_arabic: "مطعم",
  word_english: "restaurant",
  transliteration: "mat'am",
  category: "places",
  ...over,
});

const DRAFT = {
  lesson: {
    title: "At the restaurant",
    title_arabic: "في المطعم",
    description: "Ordering, asking for the bill, and the words in between.",
    duration_minutes: 15,
    cefr_target: "A2",
    approach: "Dialogue first, vocabulary drawn out of it.",
    icon: "🍽️",
    vocabulary: [
      aVocabItem(),
      aVocabItem({ word_arabic: "قائمة", word_english: "menu", transliteration: "qa'ima" }),
    ],
  },
};

/** Stage 0 is the placement/onboarding stage — never a destination for a lesson. */
const STAGES = [
  aStage({ id: stageId(0), name: "Placement", stage_number: 0, cefr_level: null }),
  aStage({ id: stageId(1), name: "Foundations", stage_number: 1, cefr_level: "A1" }),
  aStage({ id: stageId(2), name: "Building", stage_number: 2, cefr_level: null }),
];

let cleanup: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup?.();
  cleanup = undefined;
});

function render({
  data = DRAFT,
  stages = STAGES,
}: { data?: Record<string, unknown>; stages?: ReturnType<typeof aStage>[] } = {}) {
  const onApprove = vi.fn();
  const harness = renderWithProviders(
    <LessonPreviewCard data={data} onApprove={onApprove} />,
    { persona: "admin", seed: (backend) => backend.db.seed("curriculum_stages", stages) },
  );
  cleanup = harness.cleanup;
  return { ...harness, onApprove };
}

const approve = () => screen.getByRole("button", { name: /Approve & Add/ });

const chooseStage = async (text: string) => {
  fireEvent.click(screen.getByRole("combobox"));
  // The stage list is a query, so the dropdown opens before its options exist.
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(text) }));
};

describe("showing the draft", () => {
  it("leads with the lesson's own title, in both languages", () => {
    render();

    expect(screen.getByText("At the restaurant")).toBeInTheDocument();
    expect(screen.getByText("في المطعم")).toBeInTheDocument();
    expect(screen.getByText("🍽️")).toBeInTheDocument();
    expect(screen.getByText("Lesson Preview")).toBeInTheDocument();
  });

  it("falls back to a generic icon", () => {
    render({ data: { lesson: { ...DRAFT.lesson, icon: undefined } } });

    // The icon is the lesson's identity on the curriculum path; a missing one
    // would leave a gap in the row rather than a placeholder.
    expect(screen.getByText("📚")).toBeInTheDocument();
  });

  it("omits the Arabic title when the model did not write one", () => {
    render({ data: { lesson: { ...DRAFT.lesson, title_arabic: undefined } } });

    expect(screen.queryByText("في المطعم")).toBeNull();
    expect(screen.getByText("At the restaurant")).toBeInTheDocument();
  });

  it("shows what decides where the lesson belongs", () => {
    render();

    // Length, level and size are the three things an admin weighs when picking
    // a stage, so they sit above everything else.
    expect(screen.getByText("15 min")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getByText("2 words")).toBeInTheDocument();
  });

  it("leaves out the meta a draft did not specify", () => {
    render({
      data: {
        lesson: {
          title: "Sketch",
          duration_minutes: undefined,
          cefr_target: undefined,
          vocabulary: [],
        },
      },
    });

    // Early drafts are sketches. Showing "undefined min" would be worse than
    // showing nothing.
    expect(screen.queryByText(/min$/)).toBeNull();
    expect(screen.queryByText(/words$/)).toBeNull();
  });

  it("explains the lesson and how it teaches", () => {
    render();

    expect(screen.getByText(/Ordering, asking for the bill/)).toBeInTheDocument();
    // The approach is what an admin checks against the rest of the stage — five
    // dialogue lessons in a row is a curriculum problem.
    expect(screen.getByText("Approach:")).toBeInTheDocument();
    expect(screen.getByText(/Dialogue first/)).toBeInTheDocument();
  });

  it("lists the vocabulary the lesson will teach", () => {
    render();

    const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("مطعم"))!;
    expect(within(row).getByText("restaurant")).toBeInTheDocument();
    expect(within(row).getByText("mat'am")).toBeInTheDocument();
    expect(within(row).getByText("places")).toBeInTheDocument();
  });

  it("marks a word with no transliteration", () => {
    render({
      data: { lesson: { ...DRAFT.lesson, vocabulary: [aVocabItem({ transliteration: undefined })] } },
    });

    const row = screen.getAllByRole("row").find((r) => r.textContent?.includes("مطعم"))!;
    expect(within(row).getByText("-")).toBeInTheDocument();
  });

  it("drops the table for a lesson with no vocabulary yet", () => {
    render({ data: { lesson: { ...DRAFT.lesson, vocabulary: [] } } });

    // A structure-only draft is a legitimate intermediate step; an empty table
    // with headers would read as a load that failed.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the cultural and dialect notes", () => {
    render({
      data: {
        lesson: {
          ...DRAFT.lesson,
          cultural_notes: "Splitting the bill is unusual in the Gulf.",
          dialect_notes: "Gulf forms throughout.",
        },
      },
    });

    // These are the parts a non-native admin cannot check for themselves, so
    // they are surfaced rather than buried in the payload.
    expect(screen.getByText(/Splitting the bill/)).toBeInTheDocument();
    expect(screen.getByText(/Gulf forms throughout/)).toBeInTheDocument();
  });

  it("renders nothing when the reply held no lesson", () => {
    const { container } = render({ data: { vocabulary: [aVocabItem()] } });

    // The card is rendered speculatively against every model reply — a
    // vocabulary-only answer belongs to its sibling card, not this one.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("filing the lesson", () => {
  it("will not file without a stage", () => {
    render();

    // A lesson with no stage never appears on the curriculum path; it would be
    // drafted, approved, and invisible.
    expect(approve()).toBeDisabled();
  });

  it("offers the stages in order, with their levels", async () => {
    render();

    fireEvent.click(screen.getByRole("combobox"));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Stage 1: Foundations \(A1\)/ })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: /Stage 2: Building/ })).toBeInTheDocument();
  });

  it("keeps the placement stage out of the list", async () => {
    render();

    fireEvent.click(screen.getByRole("combobox"));

    // Stage 0 is the placement test, not a place to teach from. Offering it
    // would let a lesson be filed somewhere no learner works through.
    await screen.findByRole("option", { name: /Stage 1: Foundations/ });
    expect(screen.queryByRole("option", { name: /Placement/ })).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("copes with a stage that has no CEFR level", async () => {
    render();

    fireEvent.click(screen.getByRole("combobox"));

    const option = await screen.findByRole("option", { name: /Stage 2: Building/ });
    expect(option.textContent).not.toContain("(");
  });

  it("hands the chosen stage back", async () => {
    const { onApprove } = render();

    await chooseStage("Stage 1: Foundations");
    fireEvent.click(approve());

    expect(onApprove).toHaveBeenCalledWith(stageId(1));
  });

  it("becomes available as soon as a stage is picked", async () => {
    render();
    expect(approve()).toBeDisabled();

    await chooseStage("Stage 1: Foundations");

    expect(approve()).toBeEnabled();
  });

  it("has nothing to offer when no stages exist", async () => {
    render({ stages: [] });

    fireEvent.click(screen.getByRole("combobox"));

    // Pinned, as on the sibling card: the dropdown opens empty and the approve
    // button stays disabled with nothing on screen saying why. (Radix marks the
    // rest of the page aria-hidden while the dropdown is open, hence `hidden`.)
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Approve & Add/, hidden: true })).toBeDisabled();
  });
});
