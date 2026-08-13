import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/support/react/harness";
import {
  aCurriculumConcept,
  aLesson,
  aStage,
  aVocabularyWord,
  conceptId,
  lessonId,
  stageId,
  wordId,
} from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import CoverageHeatmap from "./CoverageHeatmap";

/**
 * Where the curriculum is thin.
 *
 * The app teaches three dialects across a fixed set of stages, and the risk it
 * carries is silent: a learner picks Yemeni, reaches stage 4, and finds nothing
 * there. Nobody notices from the admin lists, because each list is filtered to
 * one dialect at a time. This grid is the one view that puts all of it on one
 * screen, and its whole job is to make an empty cell impossible to miss —
 * hence colour by depth rather than a table of numbers.
 *
 * It is also a shortcut into the work: clicking a thin cell switches to that
 * dialect and opens the builder with a prompt already written.
 */

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => nav.navigate,
}));

const dialect = vi.hoisted(() => ({ setDialect: vi.fn() }));
vi.mock("@/contexts/DialectContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/DialectContext")>();
  return {
    ...actual,
    useDialect: () => ({ activeDialect: "Gulf" as const, setDialect: dialect.setDialect }),
  };
});

/** Three stages: the last has no CEFR level, which is allowed and rendered differently. */
const STAGES = [
  aStage({ id: stageId(1), name: "Foundations", stage_number: 1, cefr_level: "A1" }),
  aStage({ id: stageId(2), name: "Building", stage_number: 2, cefr_level: "A2" }),
  aStage({ id: stageId(3), name: "Fluency", stage_number: 3, cefr_level: null }),
];

/**
 * Word counts chosen to sit exactly on the tier boundaries, because that is
 * where an off-by-one in `densityClass` would hide: 1 is thin, 25 is not, 75
 * is not amber, 200 is the top tier.
 */
const TIERS = [
  { stage: 1, dialect: "Egyptian", words: 1, tier: "bg-amber-500/15" },
  { stage: 1, dialect: "Yemeni", words: 25, tier: "bg-primary/15" },
  { stage: 2, dialect: "Gulf", words: 75, tier: "bg-primary/30" },
  { stage: 2, dialect: "Egyptian", words: 200, tier: "bg-primary/50" },
] as const;

let cleanup: (() => void) | undefined;

beforeEach(() => {
  nav.navigate.mockReset();
  dialect.setDialect.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** Seeds the stages, one lesson per populated cell, and that cell's words. */
function seedGrid(backend: SupabaseBackend) {
  backend.db.seed("curriculum_stages", STAGES);

  const lessons = TIERS.map((cell, index) =>
    aLesson({
      id: lessonId(index + 1),
      stage_id: stageId(cell.stage),
      dialect_module: cell.dialect,
      title: `${cell.dialect} ${cell.stage}`,
    }),
  );
  backend.db.seed("lessons", lessons);

  let n = 0;
  const words = TIERS.flatMap((cell, index) =>
    Array.from({ length: cell.words }, () =>
      aVocabularyWord({
        id: wordId(++n),
        lesson_id: lessonId(index + 1),
        dialect_module: cell.dialect,
      }),
    ),
  );
  backend.db.seed("vocabulary_words", words);
}

function render({ seed = seedGrid }: { seed?: (backend: SupabaseBackend) => void } = {}) {
  const harness = renderWithProviders(<CoverageHeatmap />, {
    persona: "admin",
    route: "/admin",
    seed,
  });
  cleanup = harness.cleanup;
  return harness;
}

/** The button in a given stage row and dialect column. */
const cell = (stageName: string, dialectName: string) => {
  const row = screen.getByText(new RegExp(`\\. ${stageName}$`)).closest("tr")!;
  const column = ["Gulf", "Egyptian", "Yemeni"].indexOf(dialectName);
  return row.querySelectorAll("button")[column] as HTMLButtonElement;
};

const grid = () => screen.findByRole("table");

describe("laying out the grid", () => {
  it("puts every stage against every dialect", async () => {
    render();

    await grid();
    // A dialect missing from the header is a dialect nobody audits.
    for (const name of ["Gulf", "Egyptian", "Yemeni"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("1. Foundations")).toBeInTheDocument();
    expect(screen.getByText("2. Building")).toBeInTheDocument();
    expect(screen.getByText("3. Fluency")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + three stages
  });

  it("shows the CEFR level a stage targets, and nothing when it has none", async () => {
    render();

    await grid();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
    // Stage 3 has no level: the row still renders rather than showing "null".
    expect(screen.getByText("3. Fluency").closest("td")!.textContent).toBe("3. Fluency");
  });

  it("waits rather than drawing an empty grid", () => {
    render();

    // An all-red grid shown while the counts are still in flight reads as a
    // catastrophe, which is exactly the wrong first impression for this screen.
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("says what a cell means", async () => {
    render();

    await grid();
    expect(
      screen.getByText(/Stage × dialect — colored by vocabulary depth/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Red\/amber cells are coverage gaps/)).toBeInTheDocument();
    // The legend is what makes the colours readable without hovering.
    for (const label of ["Empty", "Thin", "OK", "Strong", "Deep"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("colouring by depth", () => {
  it("marks a cell with no words as a gap", async () => {
    render();

    await grid();
    // The one that matters: a learner who picks this dialect at this stage has
    // nothing to do.
    expect(cell("Foundations", "Gulf").className).toContain("bg-destructive/10");
    expect(cell("Foundations", "Gulf").textContent).toContain("0");
  });

  it.each(TIERS)("shades $words words as $tier", async ({ stage, dialect: d, words, tier }) => {
    render();

    await grid();
    const stageName = STAGES[stage - 1].name as string;
    expect(cell(stageName, d).className).toContain(tier);
    expect(cell(stageName, d).querySelector(".text-lg")!.textContent).toBe(String(words));
  });

  it("shows how many lessons sit behind the count", async () => {
    render();

    await grid();
    // Fifty words spread over one lesson and over ten are different problems.
    expect(cell("Building", "Gulf").textContent).toContain("1L");
    expect(cell("Fluency", "Yemeni").textContent).toContain("0L");
  });

  it("spells the numbers out on hover", async () => {
    render();

    await grid();
    expect(cell("Building", "Egyptian").title).toBe("200 words · 1 lessons · click to draft");
    expect(cell("Fluency", "Gulf").title).toBe("0 words · 0 lessons · click to draft");
  });

  it("offers to fill a thin cell", async () => {
    render();

    await grid();
    // The sparkle is the affordance saying this cell is the one to act on. It
    // appears on the gap tiers only.
    expect(cell("Foundations", "Gulf").querySelector(".lucide-sparkles")).not.toBeNull();
    expect(cell("Foundations", "Egyptian").querySelector(".lucide-sparkles")).not.toBeNull();
    expect(cell("Foundations", "Yemeni").querySelector(".lucide-sparkles")).toBeNull();
  });
});

describe("counting the words", () => {
  it("ignores a word that belongs to no lesson", async () => {
    render({
      seed: (backend) => {
        seedGrid(backend);
        backend.db.add(
          "vocabulary_words",
          aVocabularyWord({ id: wordId(900), lesson_id: null, dialect_module: "Gulf" }),
        );
      },
    });

    await grid();
    // Coverage is per stage, and a word with no lesson has no stage — counting
    // it somewhere would put it in a stage it does not belong to.
    expect(cell("Foundations", "Gulf").querySelector(".text-lg")!.textContent).toBe("0");
  });

  it("counts a word under its own dialect, not its lesson's", async () => {
    render({
      seed: (backend) => {
        seedGrid(backend);
        // Attached to the Egyptian stage-1 lesson, but tagged Gulf.
        backend.db.add(
          "vocabulary_words",
          aVocabularyWord({ id: wordId(901), lesson_id: lessonId(1), dialect_module: "Gulf" }),
        );
      },
    });

    await grid();
    // The lesson only supplies the stage. Which dialect a word teaches is the
    // word's own property, and a mismatched pair is a data error this makes
    // visible rather than hides.
    expect(cell("Foundations", "Gulf").querySelector(".text-lg")!.textContent).toBe("1");
    expect(cell("Foundations", "Egyptian").querySelector(".text-lg")!.textContent).toBe("1");
  });

  it("leaves the grid empty when there are no stages", async () => {
    render({ seed: (backend) => backend.db.seed("curriculum_stages", []) });

    await grid();
    expect(screen.queryAllByRole("row")).toHaveLength(1); // just the header
  });
});

describe("drafting into a gap", () => {
  it("switches to the cell's dialect before opening the builder", async () => {
    render();
    await grid();

    fireEvent.click(cell("Foundations", "Yemeni"));

    // Without this the builder opens against whatever dialect was already
    // selected and drafts the lesson into the wrong module.
    expect(dialect.setDialect).toHaveBeenCalledWith("Yemeni");
  });

  it("opens the builder with the prompt already written", async () => {
    render();
    await grid();

    fireEvent.click(cell("Building", "Egyptian"));

    expect(nav.navigate).toHaveBeenCalledWith("/admin/curriculum-builder", {
      state: {
        seedPrompt: expect.stringContaining("Draft a lesson for the Building stage in Egyptian Arabic"),
      },
    });
    const { state } = nav.navigate.mock.calls[0][1] as { state: { seedPrompt: string } };
    // Telling the model to avoid what exists is the difference between filling
    // a gap and duplicating the curriculum.
    expect(state.seedPrompt).toContain("coverage gaps");
  });

  it("can be clicked on a full cell too", async () => {
    render();
    await grid();

    fireEvent.click(cell("Building", "Gulf"));

    // Deep cells are still worth adding to, so the shortcut is not restricted
    // to the red ones.
    expect(nav.navigate).toHaveBeenCalled();
  });
});

describe("when a query fails", () => {
  it("keeps waiting rather than showing a grid built from nothing", async () => {
    render({
      seed: (backend) => {
        seedGrid(backend);
        backend.db.failAlways("vocabulary_words");
      },
    });

    // A zeroed grid would read as "the curriculum is empty" — the most alarming
    // thing this screen can say, and here it would be untrue.
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("draws the grid anyway when only the concept counts failed", async () => {
    render({
      seed: (backend) => {
        seedGrid(backend);
        backend.db.failAlways("curriculum_concepts");
      },
    });

    // Pinned: `curriculum_concepts` is the one result whose error is never
    // checked. It is also the one whose count — `sentences` — is computed for
    // every cell and then never rendered, so the query can fail outright and
    // nothing on the screen changes. Either the column was dropped from the
    // design and the query should go, or it is missing and nobody can tell.
    await grid();
    expect(cell("Building", "Egyptian").title).toBe("200 words · 1 lessons · click to draft");
  });

  it("reads the phrase and scenario concepts it never shows", async () => {
    const { backend } = render({
      seed: (backend) => {
        seedGrid(backend);
        backend.db.add(
          "curriculum_concepts",
          aCurriculumConcept({ id: conceptId(1), kind: "phrase", stage_id: stageId(1), dialect: "Gulf" }),
          aCurriculumConcept({ id: conceptId(2), kind: "scenario", stage_id: stageId(1), dialect: "Gulf" }),
        );
      },
    });

    await grid();
    // Recorded so the dead column is visible as a cost: three tables are
    // fetched on every render of this card and only two of them reach the page.
    expect(backend.db.readsOf("curriculum_concepts").length).toBeGreaterThan(0);
    expect(cell("Foundations", "Gulf").textContent).not.toContain("2");
  });
});
