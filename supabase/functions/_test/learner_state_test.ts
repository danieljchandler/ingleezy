import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * The two IO halves of the learner model: what the app records about a learner,
 * and what it hands to a generator on their behalf.
 *
 * The pure halves are already covered from Vitest — `conceptMasteryCore` owns
 * the strength ladder, `learnerProfileCore` owns the bucketing and rendering.
 * What neither can see is the layer that talks to Postgres, and that layer is
 * where the interesting failures live: a concept row created with the wrong key
 * measures nothing, and a profile query that silently returns [] produces a
 * confident, unpersonalised prompt that looks exactly like a personalised one.
 *
 * Both modules are best-effort by construction. That is right — a learner
 * waiting on a drill should not see it fail because a mastery row could not be
 * written — and it is precisely why every path here has to be asserted at the
 * request, since none of it is visible in a return value.
 */

const CONCEPTS = "/rest/v1/curriculum_concepts";
const MASTERY = "/rest/v1/user_concept_mastery";
const PROFILES = "/rest/v1/profiles";
const PERSONAL = "/rest/v1/user_vocabulary";
const CURRICULUM = "/rest/v1/word_reviews";
const ERRORS = "/rest/v1/learner_errors";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CONCEPT_ID = "11111111-1111-4111-8111-111111111111";

const bodyOf = (call: { body: string | null }) => JSON.parse(call.body ?? "null");

/**
 * A PostgREST-shaped reply.
 *
 * `maybeSingle()` asks for `application/vnd.pgrst.object+json` and reads a 406
 * as "no row", so a stub that always answered with an array would make every
 * single-row read look like a miss.
 */
const rest = (rows: Record<string, unknown>[] = []) => (request: Request): Response => {
  if (!(request.headers.get("accept") ?? "").includes("pgrst.object")) return json(rows);
  return rows.length ? json(rows[0]) : json({ code: "PGRST116", message: "no rows" }, 406);
};

// ── conceptMastery ──────────────────────────────────────────────────────────

interface ConceptRef {
  kind: "vocab" | "grammar" | "theme" | "scenario" | "phrase";
  key: string;
  label?: string;
  dialect?: string;
  cefrLevel?: string | null;
}

interface ConceptMasteryModule {
  recordConceptOutcomes: (
    userId: string | null | undefined,
    ref: ConceptRef,
    outcomes: boolean[],
  ) => Promise<string | null>;
}

async function withMastery(
  routes: Record<string, (request: Request) => Response>,
  run: (mod: ConceptMasteryModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({ upstreams: routes });
  try {
    await run(await loadSharedModule<ConceptMasteryModule>("conceptMastery"), up);
  } finally {
    up.restore();
  }
}

const aGrammarRef = (over: Partial<ConceptRef> = {}): ConceptRef => ({
  kind: "grammar",
  key: "negation",
  ...over,
});

Deno.test("a drill's answers are folded into the learner's mastery row", async () => {
  await withMastery(
    {
      [CONCEPTS]: rest([{ id: CONCEPT_ID }]),
      [MASTERY]: rest([
        { exposures: 4, correct: 3, incorrect: 1, ease: 2.6, strength: "learning" },
      ]),
    },
    async (mod, up) => {
      const conceptId = await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [
        true,
        true,
        false,
      ]);

      assertEquals(conceptId, CONCEPT_ID);
      const upsert = up.callsTo(MASTERY).filter((call) => call.method === "POST");
      const row = bodyOf(upsert[0]);
      // Folded onto what was there, not replacing it: a drill is five questions
      // and the ladder's gates are counted in dozens.
      assertEquals(row.user_id, USER_ID);
      assertEquals(row.concept_id, CONCEPT_ID);
      assertEquals(row.exposures, 7);
      assertEquals(row.correct, 5);
      assertEquals(row.incorrect, 2);
      assert(typeof row.next_due_at === "string");
      assert(typeof row.last_seen_at === "string");
    },
  );
});

Deno.test("a learner with no history starts from the initial state", async () => {
  await withMastery(
    { [CONCEPTS]: rest([{ id: CONCEPT_ID }]), [MASTERY]: rest([]) },
    async (mod, up) => {
      await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [true, true]);

      const row = bodyOf(up.callsTo(MASTERY).filter((call) => call.method === "POST")[0]);
      assertEquals(row.exposures, 2);
      assertEquals(row.correct, 2);
      // Two right answers is "learning", not "familiar" — the gates need four
      // exposures before they will say anything stronger.
      assertEquals(row.strength, "learning");
    },
  );
});

Deno.test("a corrupt strength value falls back to the bottom of the ladder", async () => {
  await withMastery(
    {
      [CONCEPTS]: rest([{ id: CONCEPT_ID }]),
      [MASTERY]: rest([
        { exposures: 4, correct: 4, incorrect: 0, ease: 2.6, strength: "expert" },
      ]),
    },
    async (mod, up) => {
      await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [true]);

      const row = bodyOf(up.callsTo(MASTERY).filter((call) => call.method === "POST")[0]);
      // A value outside the enum can only come from a hand edit or a future
      // migration; treating it as "new" is recoverable, and trusting it would
      // put a rank into arithmetic that assumes the ladder.
      assert(["new", "learning", "familiar"].includes(row.strength), row.strength);
    },
  );
});

Deno.test("the concept is created the first time anyone is measured against it", async () => {
  await withMastery(
    {
      [CONCEPTS]: (request) =>
        request.method === "POST" ? rest([{ id: CONCEPT_ID }])(request) : rest([])(request),
      [MASTERY]: rest([]),
    },
    async (mod, up) => {
      await mod.recordConceptOutcomes(
        USER_ID,
        aGrammarRef({ key: "  Verb-Conjugation  ", label: "verb conjugation", cefrLevel: "A2" }),
        [true],
      );

      const [insert] = up.callsTo(CONCEPTS).filter((call) => call.method === "POST");
      const row = bodyOf(insert);
      // Lower-cased and trimmed, because the key is the join between a drill's
      // mastery and the content tagged with the same grammar point — two rows
      // differing only in case would measure the same thing twice.
      assertEquals(row.key, "verb-conjugation");
      assertEquals(row.kind, "grammar");
      assertEquals(row.display_english, "verb conjugation");
      assertEquals(row.cefr_level, "A2");
      // Gulf is the app's default dialect, and a null here would sit outside
      // every dialect-scoped query that reads the table.
      assertEquals(row.dialect, "Gulf");
    },
  );
});

Deno.test("an existing concept is never overwritten by a drill", async () => {
  await withMastery(
    { [CONCEPTS]: rest([{ id: CONCEPT_ID }]), [MASTERY]: rest([]) },
    async (mod, up) => {
      await mod.recordConceptOutcomes(USER_ID, aGrammarRef({ label: "whatever the drill said" }), [
        true,
      ]);

      // Curated glosses and CEFR levels come from admins and from
      // extract-concepts; an upsert here would let a drill's incidental label
      // replace them.
      assertEquals(up.callsTo(CONCEPTS).filter((call) => call.method === "POST").length, 0);
    },
  );
});

Deno.test("losing the race to create a concept still records the answers", async () => {
  let reads = 0;
  await withMastery(
    {
      [CONCEPTS]: (request) => {
        if (request.method === "POST") return json({ message: "duplicate key" }, 409);
        // The first read misses, the concurrent request creates the row, the
        // read-back finds it.
        return rest(++reads > 1 ? [{ id: CONCEPT_ID }] : [])(request);
      },
      [MASTERY]: rest([]),
    },
    async (mod, up) => {
      const conceptId = await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [true]);

      // Two learners finishing the same drill at once is not rare, and dropping
      // one of their results would be invisible.
      assertEquals(conceptId, CONCEPT_ID);
      assertEquals(up.callsTo(MASTERY).filter((call) => call.method === "POST").length, 1);
    },
  );
});

Deno.test("a concept that cannot be resolved at all records nothing", async () => {
  await withMastery(
    { [CONCEPTS]: rest([]), [MASTERY]: rest([]) },
    async (mod, up) => {
      assertEquals(await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [true]), null);

      // A mastery row with no concept is unreadable by everything downstream.
      assertEquals(up.callsTo(MASTERY).length, 0);
    },
  );
});

Deno.test("a key that is only whitespace is refused before any query", async () => {
  await withMastery({ [CONCEPTS]: rest([]) }, async (mod, up) => {
    assertEquals(await mod.recordConceptOutcomes(USER_ID, aGrammarRef({ key: "   " }), [true]), null);

    // An empty key would mint one shared concept that every unkeyed drill
    // wrote to.
    assertEquals(up.callsTo(CONCEPTS).length, 0);
  });
});

Deno.test("nothing is recorded without a learner or without answers", async () => {
  await withMastery({ [CONCEPTS]: rest([]) }, async (mod, up) => {
    assertEquals(await mod.recordConceptOutcomes(null, aGrammarRef(), [true]), null);
    assertEquals(await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), []), null);

    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a runaway outcome list is capped", async () => {
  await withMastery(
    { [CONCEPTS]: rest([{ id: CONCEPT_ID }]), [MASTERY]: rest([]) },
    async (mod, up) => {
      await mod.recordConceptOutcomes(
        USER_ID,
        aGrammarRef(),
        Array.from({ length: 200 }, () => true),
      );

      const row = bodyOf(up.callsTo(MASTERY).filter((call) => call.method === "POST")[0]);
      // A drill is five questions. Two hundred is a caller bug or a replayed
      // request, and folding it in would hand out "mastered" in one call.
      assertEquals(row.exposures, 40);
    },
  );
});

Deno.test("the write is an upsert on the learner-and-concept pair", async () => {
  await withMastery(
    { [CONCEPTS]: rest([{ id: CONCEPT_ID }]), [MASTERY]: rest([]) },
    async (mod, up) => {
      await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [true]);

      const [write] = up.callsTo(MASTERY).filter((call) => call.method === "POST");
      // Without the conflict target the second drill on the same concept is a
      // unique-violation, and the learner's second session records nothing.
      assert(decodeURIComponent(write.url).includes("on_conflict=user_id,concept_id"), write.url);
      assert((write.headers.prefer ?? "").includes("resolution=merge-duplicates"), write.headers.prefer);
    },
  );
});

Deno.test("a rejected write is reported as nothing recorded, not as a failure", async () => {
  await withMastery(
    {
      [CONCEPTS]: rest([{ id: CONCEPT_ID }]),
      [MASTERY]: (request) =>
        request.method === "POST" ? json({ message: "denied" }, 403) : rest([])(request),
    },
    async (mod) => {
      // The drill has already been answered and scored on screen; throwing here
      // would turn a lost statistic into a failed request.
      assertEquals(await mod.recordConceptOutcomes(USER_ID, aGrammarRef(), [true]), null);
    },
  );
});

// ── learnerProfile ──────────────────────────────────────────────────────────

interface LearnerProfileModule {
  buildLearnerProfile: (opts: {
    userId: string;
    dialect: string;
    budget?: Record<string, number>;
  }) => Promise<{
    userId: string;
    dialect: string;
    dialectLabel: string;
    level: string | null;
    reason: string | null;
    interests: string[];
    known: Array<{ arabic: string | null }>;
    learning: Array<{ arabic: string | null }>;
    weak: Array<{ arabic: string | null }>;
    knownTotal: number;
    weakGrammar: Array<{ conceptKey: string; label: string; strength: string; ease: number }>;
  }>;
  learnerPromptBlock: (opts: {
    userId: string | null | undefined;
    dialect: string;
    includeWeak?: boolean;
  }) => Promise<string>;
}

interface ProfileFixture {
  personal?: Record<string, unknown>[];
  curriculum?: Record<string, unknown>[];
  profile?: Record<string, unknown>[];
  errors?: Record<string, unknown>[];
  mastery?: Record<string, unknown>[];
}

async function withProfile(
  fixture: ProfileFixture,
  run: (mod: LearnerProfileModule, up: StubbedUpstreams) => Promise<void>,
): Promise<void> {
  const up = stubUpstreams({
    upstreams: {
      [PERSONAL]: rest(fixture.personal ?? []),
      [CURRICULUM]: rest(fixture.curriculum ?? []),
      [PROFILES]: rest(fixture.profile ?? []),
      [ERRORS]: rest(fixture.errors ?? []),
      [MASTERY]: rest(fixture.mastery ?? []),
    },
  });
  try {
    await run(await loadSharedModule<LearnerProfileModule>("learnerProfile"), up);
  } finally {
    up.restore();
  }
}

/** A card at a comfortable interval — one the learner can be assumed to know. */
const aKnownWord = (arabic: string) => ({
  word_arabic: arabic,
  word_english: `${arabic}-en`,
  interval_days: 60,
  repetitions: 9,
  lapses: 0,
  is_leech: false,
});

/** A card that keeps failing. */
const aWeakWord = (arabic: string) => ({
  word_arabic: arabic,
  word_english: `${arabic}-en`,
  interval_days: 1,
  repetitions: 8,
  lapses: 5,
  is_leech: true,
});

Deno.test("the profile is built from both decks at once", async () => {
  await withProfile(
    {
      personal: [aKnownWord("كتاب")],
      curriculum: [{
        interval_days: 60,
        repetitions: 9,
        lapses: 0,
        is_leech: false,
        vocabulary_words: { word_arabic: "قلم", word_english: "pen", dialect_module: "Gulf" },
      }],
    },
    async (mod) => {
      const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

      // A learner's saved words and their curriculum progress are one
      // vocabulary as far as a generator is concerned; splitting them would
      // make half of what they know invisible.
      const known = profile.known.map((word) => word.arabic).sort();
      assertEquals(known, ["قلم", "كتاب"].sort());
      assertEquals(profile.knownTotal, 2);
    },
  );
});

Deno.test("a word the learner keeps getting wrong is marked weak", async () => {
  await withProfile({ personal: [aKnownWord("كتاب"), aWeakWord("مكتب")] }, async (mod) => {
    const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

    assertEquals(profile.weak.map((word) => word.arabic), ["مكتب"]);
    assertEquals(profile.known.map((word) => word.arabic), ["كتاب"]);
  });
});

Deno.test("a word the learner mispronounces is weak even when its schedule looks healthy", async () => {
  await withProfile(
    { personal: [aKnownWord("كتاب")], errors: [{ target_text: " كتاب " }] },
    async (mod) => {
      const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

      // Recognition and production are different skills. A card at a sixty-day
      // interval that the learner cannot say is exactly the gap the error log
      // exists to surface, and the trim is what makes the match land.
      assertEquals(profile.weak.map((word) => word.arabic), ["كتاب"]);
    },
  );
});

Deno.test("the deck reads are scoped to the learner and the dialect", async () => {
  await withProfile({}, async (mod, up) => {
    await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Egyptian" });

    const personal = decodeURIComponent(up.callsTo(PERSONAL)[0].url);
    assert(personal.includes(`user_id=eq.${USER_ID}`), personal);
    assert(personal.includes("dialect=eq.Egyptian"), personal);

    // The curriculum deck has no dialect of its own, so it filters through the
    // joined vocabulary row — without the inner join a Gulf learner's profile
    // would include every dialect they have ever reviewed.
    const curriculum = decodeURIComponent(up.callsTo(CURRICULUM)[0].url);
    assert(curriculum.includes("vocabulary_words.dialect_module=eq.Egyptian"), curriculum);
    assert(curriculum.includes("vocabulary_words!inner"), curriculum);
  });
});

Deno.test("struggling cards are fetched before mature ones", async () => {
  await withProfile({}, async (mod, up) => {
    await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

    const url = decodeURIComponent(up.callsTo(PERSONAL)[0].url);
    // A failed card's interval resets to near zero, so ordering by interval
    // alone would push every struggling word past the fetch limit — and empty
    // the weak set for exactly the learner whose weak set matters most.
    assertEquals(url.split("order=")[1].split("&")[0], "is_leech.desc,lapses.desc,interval_days.desc");
    assert(url.includes("limit=400"), url);
  });
});

Deno.test("only unresolved errors are considered, most recent first", async () => {
  await withProfile({}, async (mod, up) => {
    await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

    const url = decodeURIComponent(up.callsTo(ERRORS)[0].url);
    // A word the learner has since fixed must stop being drilled, or the
    // profile only ever grows more pessimistic.
    assert(url.includes("resolved_at=is.null"), url);
    assert(url.includes("limit=60"), url);
  });
});

Deno.test("grammar weakness is read per dialect and never sampled", async () => {
  await withProfile(
    {
      mastery: [
        {
          exposures: 6,
          correct: 2,
          incorrect: 4,
          ease: "2.1",
          strength: "learning",
          next_due_at: null,
          last_seen_at: null,
          curriculum_concepts: {
            key: "negation",
            display_english: "negation",
            kind: "grammar",
            dialect: "Gulf",
          },
        },
      ],
    },
    async (mod, up) => {
      const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

      assertEquals(profile.weakGrammar[0].conceptKey, "negation");
      // `ease` is numeric in Postgres and PostgREST may hand it back as a
      // string; arithmetic on "2.1" downstream would produce NaN intervals.
      assertEquals(profile.weakGrammar[0].ease, 2.1);
      const url = decodeURIComponent(up.callsTo(MASTERY)[0].url);
      assert(url.includes("curriculum_concepts.kind=eq.grammar"), url);
      assert(url.includes("curriculum_concepts.dialect=eq.Gulf"), url);
    },
  );
});

Deno.test("a mastery row whose concept has no key is dropped", async () => {
  await withProfile(
    {
      mastery: [
        { exposures: 1, correct: 0, incorrect: 1, strength: "new", curriculum_concepts: {} },
      ],
    },
    async (mod) => {
      const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

      // The key is what the generator is told to drill; an entry without one
      // would render as an empty bullet in the prompt.
      assertEquals(profile.weakGrammar, []);
    },
  );
});

Deno.test("the level comes from the placement for this dialect", async () => {
  await withProfile(
    {
      profile: [{
        placement_level_gulf: "B1",
        placement_level_egyptian: "A1",
        placement_level: "C1",
        proficiency_level: "beginner",
      }],
    },
    async (mod) => {
      const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

      assertEquals(profile.level, "B1");
    },
  );
});

Deno.test("the legacy placement covers a learner who placed before the split", async () => {
  await withProfile(
    { profile: [{ placement_level: "B2", proficiency_level: "beginner" }] },
    async (mod) => {
      assertEquals(
        (await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" })).level,
        "B2",
      );
    },
  );
});

Deno.test("the self-reported level is the last resort", async () => {
  await withProfile({ profile: [{ proficiency_level: "intermediate" }] }, async (mod) => {
    // Onboarding's own answer is worth more than nothing, and "nothing" is what
    // makes a generator pitch at its default.
    assertEquals(
      (await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" })).level,
      "intermediate",
    );
  });
});

Deno.test("an unknown dialect still resolves a level", async () => {
  await withProfile(
    { profile: [{ placement_level: "B2", placement_level_gulf: "A1" }] },
    async (mod) => {
      // There is no `placement_level_levantine` column, so the lookup misses and
      // the legacy column has to carry it.
      assertEquals(
        (await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Levantine" })).level,
        "B2",
      );
    },
  );
});

Deno.test("interests survive only as strings", async () => {
  await withProfile(
    { profile: [{ interests: ["football", 42, null, "cooking"] }] },
    async (mod) => {
      const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

      // The array is interpolated into a prompt; a number in it would read as
      // an interest in the number.
      assertEquals(profile.interests, ["football", "cooking"]);
    },
  );
});

Deno.test("a missing profile row yields an empty profile rather than an error", async () => {
  await withProfile({}, async (mod) => {
    const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

    assertEquals(profile.level, null);
    assertEquals(profile.reason, null);
    assertEquals(profile.interests, []);
    assertEquals(profile.dialectLabel.length > 0, true);
  });
});

Deno.test("a failing deck query degrades that deck alone", async () => {
  const up = stubUpstreams({
    upstreams: {
      [PERSONAL]: () => json({ message: "denied" }, 403),
      [CURRICULUM]: rest([{
        interval_days: 60,
        repetitions: 9,
        lapses: 0,
        is_leech: false,
        vocabulary_words: { word_arabic: "قلم", word_english: "pen", dialect_module: "Gulf" },
      }]),
      [PROFILES]: rest([]),
      [ERRORS]: () => json({ message: "no such table" }, 404),
      [MASTERY]: () => json({ message: "denied" }, 403),
    },
  });
  try {
    const mod = await loadSharedModule<LearnerProfileModule>("learnerProfile");
    const profile = await mod.buildLearnerProfile({ userId: USER_ID, dialect: "Gulf" });

    // Each query is independently fault-tolerant on purpose: an environment
    // where `learner_errors` has not been migrated yet should still get the
    // profile the other four queries can produce.
    assertEquals(profile.known.map((word) => word.arabic), ["قلم"]);
    assertEquals(profile.weakGrammar, []);
  } finally {
    up.restore();
  }
});

Deno.test("the sample size can be narrowed by the caller", async () => {
  await withProfile(
    { personal: Array.from({ length: 30 }, (_, index) => aKnownWord(`كلمة${index}`)) },
    async (mod) => {
      const profile = await mod.buildLearnerProfile({
        userId: USER_ID,
        dialect: "Gulf",
        budget: { known: 3 },
      });

      // A caption generator wants a handful of words; a story generator wants
      // dozens. The full count is reported separately so the prompt can still
      // say how much the learner knows.
      assertEquals(profile.known.length, 3);
      assertEquals(profile.knownTotal, 30);
    },
  );
});

Deno.test("the prompt block renders what the profile found", async () => {
  await withProfile(
    { personal: [aKnownWord("كتاب"), aWeakWord("مكتب")], profile: [{ placement_level: "B1" }] },
    async (mod) => {
      const block = await mod.learnerPromptBlock({ userId: USER_ID, dialect: "Gulf" });

      assert(block.includes("كتاب"), block);
      assert(block.includes("B1"), block);
    },
  );
});

Deno.test("an anonymous caller gets an empty block and costs nothing", async () => {
  await withProfile({}, async (mod, up) => {
    assertEquals(await mod.learnerPromptBlock({ userId: null, dialect: "Gulf" }), "");

    // Five queries per generation request is worth paying for a learner and
    // pure waste for a visitor.
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a profile that cannot be built at all appends nothing", async () => {
  const up = stubUpstreams({
    upstreams: {
      [PERSONAL]: () => {
        throw new TypeError("connection reset");
      },
    },
  });
  try {
    const mod = await loadSharedModule<LearnerProfileModule>("learnerProfile");

    // Callers append this unconditionally without a try/catch, so "" is the
    // contract: an unpersonalised lesson beats no lesson.
    assertEquals(await mod.learnerPromptBlock({ userId: USER_ID, dialect: "Gulf" }), "");
  } finally {
    up.restore();
  }
});
