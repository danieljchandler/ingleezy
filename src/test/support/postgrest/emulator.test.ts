import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { installSupabaseFetch } from "../transports/vitest";
import { SUPABASE_URL } from "../server/handler";
import type { SupabaseBackend } from "../server/handler";

/**
 * The emulator's own test suite.
 *
 * Everything else in the test tree is built on this module, so a bug here is
 * inherited by every suite above it — and would show up as a mysterious failure
 * in an unrelated feature test. These cases drive the **real** supabase-js
 * client, not the emulator's internals, so they pin the actual wire format
 * rather than this file's idea of it.
 */

let backend: SupabaseBackend;
let restore: () => void;
let db: SupabaseClient;
let clientCount = 0;

beforeEach(() => {
  const installed = installSupabaseFetch();
  backend = installed.backend;
  restore = installed.restore;
  db = createClient(SUPABASE_URL, "e2e-anon-key-not-a-real-secret", {
    // A distinct storage key per test. Without it GoTrue warns about multiple
    // clients sharing one key on every single test, which at this suite's
    // eventual size would bury real output.
    auth: { storageKey: `sb-emulator-test-${++clientCount}` },
  });
});

afterEach(() => restore());

const words = [
  { id: "w1", word_arabic: "بيت", word_english: "house", dialect_module: "Gulf", display_order: 2 },
  { id: "w2", word_arabic: "سيارة", word_english: "car", dialect_module: "Gulf", display_order: 1 },
  { id: "w3", word_arabic: "مدرسة", word_english: "school", dialect_module: "Egyptian", display_order: 3 },
];

describe("select", () => {
  beforeEach(() => backend.db.seed("vocabulary_words", words));

  it("returns every row when unfiltered", async () => {
    const { data, error } = await db.from("vocabulary_words").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  });

  it("projects only the requested columns", async () => {
    const { data } = await db.from("vocabulary_words").select("id, word_arabic");
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(["id", "word_arabic"]);
  });

  it("honours an alias", async () => {
    const { data } = await db.from("vocabulary_words").select("arabic:word_arabic");
    expect(data?.[0]).toHaveProperty("arabic", "بيت");
  });

  it("rejects a column that does not exist, the way PostgREST does", async () => {
    // The failure this catches: a column renamed in a migration leaves the app
    // querying the old name, PostgREST 400s, react-query surfaces an empty
    // list, and the page renders a plausible empty state instead of an error.
    const { data, error } = await db.from("vocabulary_words").select("id, word_arabik");
    expect(data).toBeNull();
    expect(error?.code).toBe("42703");
    expect(error?.message).toContain("word_arabik");
  });
});

describe("filters", () => {
  beforeEach(() => backend.db.seed("vocabulary_words", words));

  it("eq", async () => {
    const { data } = await db.from("vocabulary_words").select("*").eq("dialect_module", "Gulf");
    expect(data).toHaveLength(2);
  });

  it("neq", async () => {
    const { data } = await db.from("vocabulary_words").select("*").neq("dialect_module", "Gulf");
    expect(data).toHaveLength(1);
  });

  it("compares against the empty string, which goes over the wire as a bare `neq.`", async () => {
    // supabase-js encodes `.neq(col, "")` as `col=neq.` with nothing after the
    // dot. The parser used to drop that empty tail and then reject the filter
    // as unparseable, so a perfectly ordinary "exclude the blanks" query failed
    // in tests while working in production.
    backend.db.seed("vocabulary_words", [
      { id: "a", msa_form: "قصر" },
      { id: "b", msa_form: "" },
    ]);
    const { data, error } = await db.from("vocabulary_words").select("id").neq("msa_form", "");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: "a" }]);
  });

  it("gt / gte / lt / lte compare numerically, not as strings", async () => {
    // "10" < "2" as strings — the bug this guards against.
    backend.db.seed("vocabulary_words", [
      { id: "a", display_order: 2 },
      { id: "b", display_order: 10 },
    ]);
    const { data } = await db.from("vocabulary_words").select("id").gt("display_order", 5);
    expect(data).toEqual([{ id: "b" }]);
  });

  it("in", async () => {
    const { data } = await db.from("vocabulary_words").select("id").in("id", ["w1", "w3"]);
    expect(data?.map((row) => row.id).sort()).toEqual(["w1", "w3"]);
  });

  it("is null", async () => {
    backend.db.seed("vocabulary_words", [
      { id: "a", audio_url: null },
      { id: "b", audio_url: "https://x" },
    ]);
    const { data } = await db.from("vocabulary_words").select("id").is("audio_url", null);
    expect(data).toEqual([{ id: "a" }]);
  });

  it("like and ilike, with * as the wildcard", async () => {
    const like = await db.from("vocabulary_words").select("id").like("word_english", "*ous*");
    expect(like.data).toEqual([{ id: "w1" }]);

    const ilike = await db.from("vocabulary_words").select("id").ilike("word_english", "HOUSE");
    expect(ilike.data).toEqual([{ id: "w1" }]);
  });

  it("not", async () => {
    const { data } = await db.from("vocabulary_words").select("id").not("dialect_module", "eq", "Gulf");
    expect(data).toEqual([{ id: "w3" }]);
  });

  it("or", async () => {
    const { data } = await db
      .from("vocabulary_words")
      .select("id")
      .or("word_english.eq.house,word_english.eq.school");
    expect(data?.map((row) => row.id).sort()).toEqual(["w1", "w3"]);
  });

  it("combines several filters conjunctively", async () => {
    const { data } = await db
      .from("vocabulary_words")
      .select("id")
      .eq("dialect_module", "Gulf")
      .gt("display_order", 1);
    expect(data).toEqual([{ id: "w1" }]);
  });

  it("compares timestamps chronologically", async () => {
    const now = Date.now();
    backend.db.seed("word_reviews", [
      { id: "due", next_review_at: new Date(now - 86_400_000).toISOString() },
      { id: "later", next_review_at: new Date(now + 86_400_000).toISOString() },
    ]);

    const { data } = await db
      .from("word_reviews")
      .select("id")
      .lte("next_review_at", new Date(now).toISOString());
    expect(data).toEqual([{ id: "due" }]);
  });

  it("rejects an operator it does not implement rather than ignoring it", async () => {
    // Silently ignoring an unsupported clause is how a double starts passing
    // tests for the wrong reason: the filter vanishes and every row comes back.
    const { data, error } = await db
      .from("vocabulary_words")
      .select("id")
      .textSearch("word_english", "house");

    expect(data).toBeNull();
    expect(error?.message).toMatch(/does not implement/i);

    // And it is recorded, because supabase-js routes this into the `error`
    // channel where a component's catch block could swallow it.
    expect(() => backend.assertNoUnsupportedQueries()).toThrow(/does not implement/i);
  });

  it("passes the teardown assertion when every query was supported", async () => {
    await db.from("vocabulary_words").select("id").eq("dialect_module", "Gulf");
    expect(() => backend.assertNoUnsupportedQueries()).not.toThrow();
  });
});

describe("ordering, limits and ranges", () => {
  beforeEach(() => backend.db.seed("vocabulary_words", words));

  it("orders ascending by default", async () => {
    const { data } = await db.from("vocabulary_words").select("id").order("display_order");
    expect(data?.map((row) => row.id)).toEqual(["w2", "w1", "w3"]);
  });

  it("orders descending", async () => {
    const { data } = await db
      .from("vocabulary_words")
      .select("id")
      .order("display_order", { ascending: false });
    expect(data?.map((row) => row.id)).toEqual(["w3", "w1", "w2"]);
  });

  it("sorts nulls last ascending, matching Postgres", async () => {
    backend.db.seed("vocabulary_words", [
      { id: "null", display_order: null },
      { id: "one", display_order: 1 },
    ]);
    const { data } = await db.from("vocabulary_words").select("id").order("display_order");
    expect(data?.map((row) => row.id)).toEqual(["one", "null"]);
  });

  it("limits", async () => {
    const { data } = await db.from("vocabulary_words").select("id").order("display_order").limit(2);
    expect(data).toHaveLength(2);
  });

  it("ranges", async () => {
    const { data } = await db.from("vocabulary_words").select("id").order("display_order").range(1, 2);
    expect(data?.map((row) => row.id)).toEqual(["w1", "w3"]);
  });
});

describe("counts", () => {
  beforeEach(() => backend.db.seed("vocabulary_words", words));

  it("reports an exact count alongside the rows", async () => {
    const { count, data } = await db
      .from("vocabulary_words")
      .select("*", { count: "exact" })
      .eq("dialect_module", "Gulf");
    expect(count).toBe(2);
    expect(data).toHaveLength(2);
  });

  it("reports a count with head:true and no body", async () => {
    // This is the shape the due-card banners use. It reads zero unless
    // content-range is exposed through CORS.
    const { count, data } = await db
      .from("vocabulary_words")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(3);
    // No body at all — supabase-js reports the count and leaves data null.
    expect(data).toBeNull();
  });

  it("counts the whole match, not just the limited window", async () => {
    const { count, data } = await db
      .from("vocabulary_words")
      .select("*", { count: "exact" })
      .limit(1);
    expect(data).toHaveLength(1);
    expect(count).toBe(3);
  });
});

describe("single and maybeSingle", () => {
  beforeEach(() => backend.db.seed("vocabulary_words", words));

  it("single returns the row", async () => {
    const { data, error } = await db.from("vocabulary_words").select("*").eq("id", "w1").single();
    expect(error).toBeNull();
    expect(data?.word_english).toBe("house");
  });

  it("single errors when nothing matched", async () => {
    const { data, error } = await db.from("vocabulary_words").select("*").eq("id", "nope").single();
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST116");
  });

  it("maybeSingle returns null data and no error when nothing matched", async () => {
    // supabase-js only takes this path for code PGRST116 with that exact
    // details string. A plausible-looking 404 would surface as an error here
    // and make maybeSingle look broken in tests but fine in production.
    const { data, error } = await db
      .from("vocabulary_words")
      .select("*")
      .eq("id", "nope")
      .maybeSingle();
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it("single errors when more than one row matched", async () => {
    const { error } = await db
      .from("vocabulary_words")
      .select("*")
      .eq("dialect_module", "Gulf")
      .single();
    expect(error?.code).toBe("PGRST116");
  });
});

describe("embedded resources", () => {
  beforeEach(() => {
    backend.db
      .seed("topics", [
        { id: "t1", name: "Home", name_arabic: "بيت", icon: "🏠", gradient: "g" },
        { id: "t2", name: "Travel", name_arabic: "سفر", icon: "✈️", gradient: "g" },
      ])
      .seed("vocabulary_words", [
        { id: "w1", word_arabic: "بيت", topic_id: "t1", lesson_id: null },
        { id: "w2", word_arabic: "سيارة", topic_id: null, lesson_id: null },
      ]);
  });

  it("embeds a to-one relationship as an object", async () => {
    const { data, error } = await db.from("vocabulary_words").select("id, topics(name)").eq("id", "w1");
    expect(error).toBeNull();
    expect(data?.[0]).toEqual({ id: "w1", topics: { name: "Home" } });
  });

  it("embeds null when the foreign key is unset", async () => {
    const { data } = await db.from("vocabulary_words").select("id, topics(name)").eq("id", "w2");
    expect(data?.[0]).toEqual({ id: "w2", topics: null });
  });

  it("embeds a to-many relationship as an array", async () => {
    const { data } = await db.from("topics").select("id, vocabulary_words(id)").eq("id", "t1");
    expect(data?.[0]).toEqual({ id: "t1", vocabulary_words: [{ id: "w1" }] });
  });

  it("!inner drops parents whose embed matched nothing", async () => {
    // GrammarDrills depends on this: it selects user_concept_mastery with
    // curriculum_concepts!inner(...), and a left join would show mastery rows
    // for concepts that no longer exist.
    const { data } = await db.from("vocabulary_words").select("id, topics!inner(name)");
    expect(data).toHaveLength(1);
    expect(data?.[0].id).toBe("w1");
  });

  it("keeps the parent without !inner", async () => {
    const { data } = await db.from("vocabulary_words").select("id, topics(name)");
    expect(data).toHaveLength(2);
  });

  it("supports * alongside an embed", async () => {
    const { data } = await db.from("vocabulary_words").select("*, topics(name)").eq("id", "w1");
    expect(data?.[0]).toMatchObject({ id: "w1", word_arabic: "بيت", topics: { name: "Home" } });
  });

  it("errors when the tables are unrelated", async () => {
    const { error } = await db.from("profiles").select("user_id, listen_episodes(id)");
    expect(error?.code).toBe("PGRST200");
  });

  it("errors on an unrelated embed even when the parent table is empty", async () => {
    // PostgREST validates the select clause against the schema cache, so this
    // fails whether or not there are rows. Validating lazily per row meant an
    // empty table returned 200 and hid the broken query behind an empty state.
    backend.db.seed("profiles", []);
    const { error } = await db.from("profiles").select("user_id, listen_episodes(id)");
    expect(error?.code).toBe("PGRST200");
  });

  it("filters on an embedded resource's column", async () => {
    // The grammar-mastery query does exactly this. Treated as a plain column
    // it would be a nonexistent name; ignored, it would silently return every
    // concept kind rather than just grammar.
    backend.db
      .seed("curriculum_concepts", [
        { id: "c1", key: "negation", display_english: "Negation", kind: "grammar", dialect: "Gulf" },
        { id: "c2", key: "greetings", display_english: "Greetings", kind: "vocab", dialect: "Gulf" },
      ])
      .seed("user_concept_mastery", [
        { user_id: "u1", concept_id: "c1", exposures: 10, correct: 3 },
        { user_id: "u1", concept_id: "c2", exposures: 5, correct: 5 },
      ]);

    const { data, error } = await db
      .from("user_concept_mastery")
      .select("exposures, curriculum_concepts!inner(key, kind)")
      .eq("curriculum_concepts.kind", "grammar");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ exposures: 10, curriculum_concepts: { key: "negation" } });
  });
});

describe("writes", () => {
  it("insert persists and returns the row", async () => {
    const { data, error } = await db
      .from("user_vocabulary")
      .insert({ user_id: "u1", word_arabic: "قلم", word_english: "pen" })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.word_english).toBe("pen");
    // The predecessor echoed an empty array here, so no test could assert that
    // anything was actually saved.
    expect(backend.db.rows("user_vocabulary")).toHaveLength(1);
  });

  it("insert fills in id and timestamps", async () => {
    await db.from("user_vocabulary").insert({ user_id: "u1", word_arabic: "قلم", word_english: "pen" });
    const [row] = backend.db.rows("user_vocabulary");
    expect(row.id).toEqual(expect.any(String));
    expect(row.created_at).toEqual(expect.any(String));
  });

  it("insert rejects a missing required column", async () => {
    const { error } = await db.from("user_set_phrases").insert({ user_id: "u1" });
    expect(error?.code).toBe("23502");
    expect(error?.message).toContain("phrase_id");
  });

  it("update applies only to matching rows", async () => {
    backend.db.seed("user_vocabulary", [
      { id: "a", user_id: "u1", repetitions: 0 },
      { id: "b", user_id: "u1", repetitions: 0 },
    ]);

    await db.from("user_vocabulary").update({ repetitions: 5 }).eq("id", "a");

    const rows = backend.db.rows("user_vocabulary");
    expect(rows.find((row) => row.id === "a")?.repetitions).toBe(5);
    expect(rows.find((row) => row.id === "b")?.repetitions).toBe(0);
  });

  it("delete removes only matching rows", async () => {
    backend.db.seed("user_vocabulary", [
      { id: "a", user_id: "u1" },
      { id: "b", user_id: "u1" },
    ]);

    await db.from("user_vocabulary").delete().eq("id", "a");
    expect(backend.db.rows("user_vocabulary").map((row) => row.id)).toEqual(["b"]);
  });

  it("upsert merges rather than colliding", async () => {
    backend.db.seed("user_vocabulary", [{ id: "a", user_id: "u1", repetitions: 1 }]);

    await db
      .from("user_vocabulary")
      .upsert({ id: "a", user_id: "u1", word_arabic: "قلم", word_english: "pen", repetitions: 9 });

    const rows = backend.db.rows("user_vocabulary");
    expect(rows).toHaveLength(1);
    expect(rows[0].repetitions).toBe(9);
  });

  it("upsert with ignoreDuplicates leaves the existing row alone", async () => {
    backend.db.seed("user_vocabulary", [
      { id: "a", user_id: "u1", word_arabic: "قلم", word_english: "pen", dialect: "Gulf" },
    ]);

    await db
      .from("user_vocabulary")
      .upsert(
        { user_id: "u1", word_arabic: "قلم", word_english: "OVERWRITTEN", dialect: "Gulf" },
        { onConflict: "user_id,word_arabic,dialect", ignoreDuplicates: true },
      );

    // The point of ignore-duplicates: re-saving a word a learner already has
    // must not overwrite the definition, tags or schedule they built up on it.
    expect(backend.db.rows("user_vocabulary")[0].word_english).toBe("pen");
  });

  it("upsert with ignoreDuplicates returns only the rows it actually wrote", async () => {
    backend.db.seed("user_vocabulary", [
      { id: "a", user_id: "u1", word_arabic: "قلم", word_english: "pen", dialect: "Gulf" },
    ]);

    const { data } = await db
      .from("user_vocabulary")
      .upsert(
        [
          { user_id: "u1", word_arabic: "قلم", word_english: "pen", dialect: "Gulf" },
          { user_id: "u1", word_arabic: "كتاب", word_english: "book", dialect: "Gulf" },
        ],
        { onConflict: "user_id,word_arabic,dialect", ignoreDuplicates: true },
      )
      .select("id");

    // Bulk saves subtract this length from what they sent to report "N already
    // in My Words". Returning both rows would make every duplicate look new.
    expect(data).toHaveLength(1);
    expect(backend.db.rows("user_vocabulary")).toHaveLength(2);
  });

  it("insert on an existing primary key conflicts", async () => {
    const row = { id: "a", user_id: "u1", word_arabic: "قلم", word_english: "pen" };
    backend.db.seed("user_vocabulary", [row]);

    const { error } = await db.from("user_vocabulary").insert(row);
    expect(error?.code).toBe("23505");
  });

  it("records the payload for assertions", async () => {
    await db.from("word_reviews").insert({ user_id: "u1", word_id: "w1", ease_factor: 2.5 });

    const write = backend.db.lastWriteTo("word_reviews");
    expect(write?.method).toBe("POST");
    expect(write?.payload[0]).toMatchObject({ word_id: "w1", ease_factor: 2.5 });
  });
});

describe("fault injection", () => {
  it("failNext makes one request fail, then recovers", async () => {
    backend.db.seed("vocabulary_words", words).failNext("vocabulary_words", 500);

    const failed = await db.from("vocabulary_words").select("*");
    expect(failed.error).not.toBeNull();

    const recovered = await db.from("vocabulary_words").select("*");
    expect(recovered.error).toBeNull();
    expect(recovered.data).toHaveLength(3);
  });

  it("failWrites leaves reads working", async () => {
    // A save-failed test needs the page to render first. Failing the table
    // outright breaks the query that renders it, so the test never reaches the
    // button it means to click.
    backend.db.seed("vocabulary_words", words).failWrites("vocabulary_words", 500);

    const read = await db.from("vocabulary_words").select("*");
    expect(read.error).toBeNull();
    expect(read.data).toHaveLength(3);

    const write = await db.from("vocabulary_words").update({ display_order: 9 }).eq("id", "w1");
    expect(write.error).not.toBeNull();
  });

  it("failNextWrite fails one save, then lets a retry through", async () => {
    backend.db.seed("user_vocabulary", []).failNextWrite("user_vocabulary", 503);

    const row = { user_id: "u1", word_arabic: "قلم", word_english: "pen" };
    expect((await db.from("user_vocabulary").insert(row)).error).not.toBeNull();
    expect((await db.from("user_vocabulary").insert(row)).error).toBeNull();
    expect(backend.db.rows("user_vocabulary")).toHaveLength(1);
  });

  it("failAlways keeps failing until cleared", async () => {
    backend.db.seed("vocabulary_words", words).failAlways("vocabulary_words", 503);

    expect((await db.from("vocabulary_words").select("*")).error).not.toBeNull();
    expect((await db.from("vocabulary_words").select("*")).error).not.toBeNull();

    backend.db.clearFailure("vocabulary_words");
    expect((await db.from("vocabulary_words").select("*")).error).toBeNull();
  });
});

describe("rpc", () => {
  it("resolves roles from the seeded rows", async () => {
    backend.db.seed("user_roles", [{ user_id: "u1", role: "admin" }]);
    backend.setUser("u1");

    const { data } = await db.rpc("has_role", { _user_id: "u1", _role: "admin" });
    expect(data).toBe(true);

    const { data: notRecorder } = await db.rpc("has_role", { _user_id: "u1", _role: "recorder" });
    expect(notRecorder).toBe(false);
  });

  it("award_xp accumulates", async () => {
    backend.setUser("u1");
    await db.rpc("award_xp", { _amount: 15, _reason: "review" });
    const { data } = await db.rpc("award_xp", { _amount: 10, _reason: "review" });
    expect(data).toBe(25);
  });

  it("errors loudly for an RPC nothing implements", async () => {
    const { error } = await db.rpc("some_function_nobody_wrote");
    expect(error?.code).toBe("PGRST202");
  });

  it("turns a raising function into an error response, not a torn-down request", async () => {
    // A test makes an RPC fail by throwing from an override. Postgres reports a
    // raised exception to the client, so the app should reach its error branch.
    backend.stubRpc("award_xp", () => {
      throw new Error("no seats left");
    });

    const { data, error } = await db.rpc("award_xp", { _amount: 10 });
    expect(data).toBeNull();
    expect(error?.message).toBe("no seats left");
  });
});

describe("edge functions", () => {
  it("returns the registered response and records the call", async () => {
    backend.stubFunction("generate-mnemonic", { mnemonic: "sounds like 'bait'" });

    const { data } = await db.functions.invoke("generate-mnemonic", {
      body: { word: "بيت" },
    });

    expect(data).toEqual({ mnemonic: "sounds like 'bait'" });
    expect(backend.lastCallTo("generate-mnemonic")?.body).toEqual({ word: "بيت" });
  });

  it("serves the over-quota 429 the usage cap actually sends", async () => {
    backend.stubFunctionCapped("grammar-drill");

    const { error } = await db.functions.invoke("grammar-drill", { body: {} });
    expect(error).not.toBeNull();

    const call = backend.lastCallTo("grammar-drill");
    expect(call).toBeDefined();
  });

  it("refuses a function nothing registered instead of returning an empty object", async () => {
    // An empty object lets a component fall through to its empty branch, and
    // the test passes without the function ever being exercised.
    await db.functions.invoke("a-function-nobody-stubbed", { body: {} });
    expect(() => backend.assertNoUnstubbedCalls()).toThrow(/no registered response/i);
  });

  it("passes when every called function was registered", async () => {
    backend.stubFunction("translate-text", { translation: "hello" });
    await db.functions.invoke("translate-text", { body: { text: "مرحبا" } });
    expect(() => backend.assertNoUnstubbedCalls()).not.toThrow();
  });
});

describe("auth", () => {
  it("signs in with a password", async () => {
    const { data, error } = await db.auth.signInWithPassword({
      email: "learner@example.com",
      password: "correct-horse",
    });

    expect(error).toBeNull();
    expect(data.session?.access_token).toEqual(expect.any(String));
    expect(data.user?.email).toBe("learner@example.com");
  });

  it("rejects a bad password", async () => {
    const { error } = await db.auth.signInWithPassword({
      email: "learner@example.com",
      password: "wrong-password",
    });
    expect(error?.message).toMatch(/invalid login credentials/i);
  });

  it("rejects a sign-up for an email that already exists", async () => {
    // Registered as an account rather than a profile row: `profiles` has no
    // email column, which is the whole reason admin_find_user is an RPC.
    backend.addUser("u1", "taken@example.com");

    const { error } = await db.auth.signUp({
      email: "taken@example.com",
      password: "correct-horse",
    });
    expect(error).not.toBeNull();
  });
});

describe("column defaults", () => {
  it("fills a defaulted column the payload omitted", async () => {
    backend.db.seed("invite_codes", []);

    await db.from("invite_codes").insert({ code: "FRESH001", max_uses: 5 });

    // `uses INTEGER NOT NULL DEFAULT 0`. Leaving it absent is the normal way to
    // insert — the admin console renders `{uses}/{max_uses} used` immediately
    // afterwards, and without the default that reads "/5 used".
    expect(backend.db.rows("invite_codes")[0].uses).toBe(0);
  });

  it("returns the defaults it filled in", async () => {
    backend.db.seed("invite_codes", []);

    const { data } = await db
      .from("invite_codes")
      .insert({ code: "FRESH002", max_uses: 5 })
      .select()
      .single();

    expect(data).toMatchObject({ code: "FRESH002", uses: 0 });
  });

  it("does not overwrite a value the payload supplied", async () => {
    backend.db.seed("invite_codes", []);

    await db.from("invite_codes").insert({ code: "PARTUSED", max_uses: 5, uses: 3 });

    expect(backend.db.rows("invite_codes")[0].uses).toBe(3);
  });

  it("leaves an existing row's columns alone on the update half of an upsert", async () => {
    backend.db.seed("user_lesson_progress", [
      {
        id: "p1",
        user_id: "u1",
        lesson_id: "l1",
        status: "completed",
        words_total: 10,
        words_seen: 10,
      },
    ]);

    await db
      .from("user_lesson_progress")
      .upsert({ id: "p1", user_id: "u1", lesson_id: "l1", words_seen: 4 }, { onConflict: "id" });

    // The distinction that matters: Postgres applies a default when INSERTing
    // an absent column and leaves it alone on the UPDATE half of ON CONFLICT.
    // Folding defaults in before the merge would demote this finished lesson to
    // its default status and reset a word count the payload never mentioned.
    expect(backend.db.rows("user_lesson_progress")[0]).toMatchObject({
      status: "completed",
      words_total: 10,
      words_seen: 4,
    });
  });
});
