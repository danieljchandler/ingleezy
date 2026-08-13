import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * The coverage planner — what the curriculum generators are told to avoid,
 * reinforce and introduce.
 *
 * Without it every generation request starts from nothing, and a model asked
 * twice for "an A2 Gulf lesson" produces the same twenty high-frequency words
 * both times. The planner is the only thing in the pipeline that knows what has
 * already been taught, so the difference between a curriculum and a pile of
 * lessons is the three lists it returns.
 *
 * Two windows do the sorting: a concept seen inside 7 days is still fresh
 * (avoid), one seen between 7 and 14 days ago is due for a second exposure
 * (reinforce), and anything else is a candidate. Per-user mastery overrides
 * both when a learner is named.
 */

const CONCEPTS = "/rest/v1/curriculum_concepts";
const LINKS = "/rest/v1/content_concept_links";
const MASTERY = "/rest/v1/user_concept_mastery";

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

interface ConceptLite {
  id: string;
  kind: string;
  key: string;
  display_arabic: string | null;
  display_english: string | null;
  cefr_level: string | null;
}

interface CoveragePlan {
  avoid: ConceptLite[];
  reinforce: ConceptLite[];
  next_up: ConceptLite[];
  promptBlock: string;
}

interface PlannerModule {
  planCoverage: (opts: {
    dialect: string;
    cefr?: string | null;
    stageId?: string | null;
    contentType: string;
    userId?: string | null;
  }) => Promise<CoveragePlan>;
}

const aConcept = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "vocab",
  key: `key-${id}`,
  display_arabic: `عربي-${id}`,
  display_english: `english ${id}`,
  cefr_level: "A2",
  first_introduced_at: null,
  ...over,
});

interface PlannerFixture {
  concepts?: unknown[];
  links?: unknown[];
  mastery?: unknown[];
}

async function withPlanner(
  fixture: PlannerFixture,
  run: (mod: PlannerModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({
    upstreams: {
      [CONCEPTS]: () => json(fixture.concepts ?? []),
      // The real query filters to links created inside the 14-day window, and
      // the stub does not filter — so "taught a month ago" is modelled by
      // leaving the link out, exactly as PostgREST would.
      [LINKS]: () => json(fixture.links ?? []),
      [MASTERY]: () => json(fixture.mastery ?? []),
    },
  });
  try {
    await run(await loadSharedModule<PlannerModule>("coveragePlanner"), up);
  } finally {
    up.restore();
  }
}

const ids = (list: ConceptLite[]) => list.map((concept) => concept.id);

Deno.test("a concept nobody has taught is a candidate to introduce", async () => {
  await withPlanner({ concepts: [aConcept("c1")] }, async (mod) => {
    const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

    assertEquals(ids(plan.next_up), ["c1"]);
    assertEquals(plan.avoid, []);
    assertEquals(plan.reinforce, []);
  });
});

Deno.test("a concept taught this week is held back", async () => {
  await withPlanner(
    {
      concepts: [aConcept("c1")],
      links: [{ concept_id: "c1", created_at: daysAgo(2), role: "introduced" }],
    },
    async (mod) => {
      const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      // Reintroducing a word two days after it was taught reads to the learner
      // as the curriculum having lost its place.
      assertEquals(ids(plan.avoid), ["c1"]);
      assertEquals(plan.next_up, []);
    },
  );
});

Deno.test("a concept taught last week comes back for reinforcement", async () => {
  await withPlanner(
    {
      concepts: [aConcept("c1")],
      links: [{ concept_id: "c1", created_at: daysAgo(10), role: "introduced" }],
    },
    async (mod) => {
      const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      // The gap between the two windows is the whole spacing schedule: seen
      // once, then again a week later in a new context.
      assertEquals(ids(plan.reinforce), ["c1"]);
      assertEquals(plan.avoid, []);
    },
  );
});

Deno.test("a concept taught a month ago is offered as new again", async () => {
  await withPlanner(
    // Its link falls outside the 14-day window the query asks for, so the
    // planner never sees it.
    { concepts: [aConcept("c1")], links: [] },
    async (mod) => {
      const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      // Pinned. There is no third window: a concept last taught outside 14 days
      // is indistinguishable from one never taught, so it lands in `next_up`
      // and the generator is told to *introduce* it. A learner who met the word
      // three weeks ago is taught it again from scratch, and the reinforcement
      // schedule quietly resets rather than lengthening.
      assertEquals(ids(plan.next_up), ["c1"]);
      assertEquals(plan.reinforce, []);
    },
  );
});

Deno.test("a concept the learner is due to review outranks its recency", async () => {
  await withPlanner(
    {
      concepts: [aConcept("c1")],
      links: [{ concept_id: "c1", created_at: daysAgo(1), role: "introduced" }],
      mastery: [{ concept_id: "c1", next_due_at: daysAgo(1), strength: 0.3 }],
    },
    async (mod) => {
      const plan = await mod.planCoverage({
        dialect: "Gulf",
        contentType: "lesson",
        userId: "user-1",
      });

      // The per-learner signal is the better one: this learner is struggling
      // with a word the cohort saw yesterday, and they need it again now.
      assertEquals(ids(plan.reinforce), ["c1"]);
      assertEquals(plan.avoid, []);
    },
  );
});

Deno.test("mastery is only consulted when a learner is named", async () => {
  await withPlanner({ concepts: [aConcept("c1")] }, async (mod, up) => {
    await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

    // Admin-side generation has no learner, and a cohort-wide plan must not
    // silently be one person's review queue.
    assertEquals(up.callsTo(MASTERY).length, 0);
  });
});

Deno.test("only the learner's own due concepts are read", async () => {
  await withPlanner({ concepts: [aConcept("c1")] }, async (mod, up) => {
    await mod.planCoverage({ dialect: "Gulf", contentType: "lesson", userId: "user-1" });

    const url = decodeURIComponent(up.callsTo(MASTERY)[0].url);
    assert(url.includes("user_id=eq.user-1"), url);
    // Due *now*: a concept scheduled for next month is not reinforcement, it is
    // noise in the prompt.
    assert(url.includes("next_due_at=lte."), url);
  });
});

Deno.test("the concept pool is scoped to the dialect", async () => {
  await withPlanner({ concepts: [] }, async (mod, up) => {
    await mod.planCoverage({ dialect: "Egyptian", contentType: "lesson" });

    const url = decodeURIComponent(up.callsTo(CONCEPTS)[0].url);
    // Gulf and Egyptian are separate curricula; crossing them would tell the
    // Egyptian generator to avoid words it has never taught.
    assert(url.includes("dialect=eq.Egyptian"), url);
    assert(!url.includes("cefr_level=eq."), url);
  });
});

Deno.test("the pool narrows to a level when one is given", async () => {
  await withPlanner({ concepts: [] }, async (mod, up) => {
    await mod.planCoverage({ dialect: "Gulf", cefr: "B1", contentType: "lesson" });

    assert(decodeURIComponent(up.callsTo(CONCEPTS)[0].url).includes("cefr_level=eq.B1"));
  });
});

Deno.test("an empty dialect falls back to Gulf rather than querying for nothing", async () => {
  await withPlanner({ concepts: [] }, async (mod, up) => {
    await mod.planCoverage({ dialect: "", contentType: "lesson" });

    assert(decodeURIComponent(up.callsTo(CONCEPTS)[0].url).includes("dialect=eq.Gulf"));
  });
});

Deno.test("each list is capped so the prompt cannot run away", async () => {
  await withPlanner(
    {
      concepts: Array.from({ length: 60 }, (_, index) => aConcept(`c${index}`)),
      links: Array.from({ length: 60 }, (_, index) => ({
        concept_id: `c${index}`,
        created_at: daysAgo(1),
        role: "introduced",
      })),
    },
    async (mod) => {
      const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      // Sixty avoid-items pasted into a system prompt is most of the context
      // window spent on a list the model will stop reading.
      assertEquals(plan.avoid.length, 25);
    },
  );
});

Deno.test("the prompt block names the items to hold back and to reinforce", async () => {
  await withPlanner(
    {
      concepts: [aConcept("c1"), aConcept("c2")],
      links: [
        { concept_id: "c1", created_at: daysAgo(1), role: "introduced" },
        { concept_id: "c2", created_at: daysAgo(10), role: "introduced" },
      ],
    },
    async (mod) => {
      const { promptBlock } = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      assert(promptBlock.includes("DO NOT REINTRODUCE"), promptBlock);
      assert(promptBlock.includes("عربي-c1 (english c1)"), promptBlock);
      assert(promptBlock.includes("REINFORCE"), promptBlock);
      assert(promptBlock.includes("عربي-c2 (english c2)"), promptBlock);
    },
  );
});

Deno.test("the prompt block never lists the candidates themselves", async () => {
  await withPlanner({ concepts: [aConcept("c1")] }, async (mod) => {
    const { promptBlock, next_up } = await mod.planCoverage({
      dialect: "Gulf",
      contentType: "lesson",
    });

    // Pinned. `next_up` is computed, capped and returned, but the prompt only
    // says "prioritise concepts NOT yet in the curriculum" — the specific
    // candidates never reach the model. So the planner can tell a generator
    // precisely what to avoid and only vaguely what to teach, and every caller
    // that passes `promptBlock` straight through (which is all of them) throws
    // the useful half away.
    assertEquals(ids(next_up), ["c1"]);
    assert(!promptBlock.includes("عربي-c1"), promptBlock);
  });
});

Deno.test("a concept with no Arabic display falls back to its key", async () => {
  await withPlanner(
    {
      concepts: [aConcept("c1", { display_arabic: null, display_english: null })],
      links: [{ concept_id: "c1", created_at: daysAgo(1), role: "introduced" }],
    },
    async (mod) => {
      const { promptBlock } = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      // A blank entry in the avoid list is worse than an ugly one: the model
      // cannot avoid a word it was not told.
      assert(promptBlock.includes("key-c1"), promptBlock);
    },
  );
});

Deno.test("an empty curriculum says so rather than listing nothing", async () => {
  await withPlanner({ concepts: [] }, async (mod) => {
    const { promptBlock } = await mod.planCoverage({
      dialect: "Yemeni",
      cefr: "A1",
      contentType: "lesson",
    });

    // The first Yemeni lesson ever generated needs different instructions from
    // the five-hundredth, and silence would read as "avoid nothing, reinforce
    // nothing" instead of "you are setting the foundation".
    assert(promptBlock.includes("No concepts have been taught yet for Yemeni A1"), promptBlock);
    assert(!promptBlock.includes("DO NOT REINTRODUCE"), promptBlock);
  });
});

Deno.test("the block is delimited so it can be spliced into a system prompt", async () => {
  await withPlanner({ concepts: [] }, async (mod) => {
    const { promptBlock } = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

    assert(promptBlock.startsWith("=== COVERAGE PLAN — IMPORTANT ==="), promptBlock);
    assert(promptBlock.trimEnd().endsWith("=== END COVERAGE PLAN ==="), promptBlock);
  });
});

Deno.test("a concept linked twice is judged by the first link returned", async () => {
  await withPlanner(
    {
      concepts: [aConcept("c1")],
      links: [
        { concept_id: "c1", created_at: daysAgo(10), role: "reinforced" },
        { concept_id: "c1", created_at: daysAgo(1), role: "introduced" },
      ],
    },
    async (mod) => {
      const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

      // Pinned. The link query has no `order`, and the first row seen per
      // concept wins — so a word taught ten days ago and again yesterday is
      // filed as "reinforce" purely because PostgREST returned the older row
      // first. The same data in the other order files it as "avoid", and the
      // generator is told the opposite thing about the same word.
      assertEquals(ids(plan.reinforce), ["c1"]);
      assertEquals(plan.avoid, []);
    },
  );
});

Deno.test("a database that answers with nothing still returns a usable plan", async () => {
  const up = stubUpstreams({
    upstreams: {
      [CONCEPTS]: () => json({ message: "boom" }, 500),
      [LINKS]: () => json({ message: "boom" }, 500),
    },
  });
  try {
    const mod = await loadSharedModule<PlannerModule>("coveragePlanner");
    const plan = await mod.planCoverage({ dialect: "Gulf", contentType: "lesson" });

    // Errors are destructured away without a check, so a failed read degrades
    // to "nothing has been taught" rather than throwing. Generation continuing
    // with a weaker prompt beats a lesson request failing outright.
    assertEquals(plan.next_up, []);
    assert(plan.promptBlock.includes("No concepts have been taught yet"), plan.promptBlock);
  } finally {
    up.restore();
  }
});
