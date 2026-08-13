import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadSharedModule, stubUpstreams, type StubbedUpstreams } from "./harness.ts";
import { chatCompletion, json } from "./upstreams.ts";

/**
 * The native-speaker authenticity gate, and the literal-gloss rule every
 * translation shares.
 *
 * The validator is the last thing between generated Arabic and a learner. The
 * app's entire premise is that it teaches how people actually speak, so text
 * that is fusha grammar with a few dialect words dropped in is not a cosmetic
 * problem — it is the app failing at the one thing it claims to do, in a way
 * the learner cannot detect for themselves.
 *
 * Two models judge every candidate and the harsher verdict wins. The comment on
 * `validateDialectCrossChecked` records why: the cheap Arabic-native model was
 * once asked first and trusted when it said 5/5, and on Yemeni it read
 * fusha-inflected prose as fine — so the strict reviewer that would have caught
 * it never ran.
 */

const GATEWAY = "ai.gateway.lovable.dev";
const OPENROUTER = "openrouter.ai";
const STRONG = "google/gemini-2.5-pro";
const ARABIC = "mistralai/mistral-saba";

interface ValidatorLeak {
  token: string;
  suggestion?: string;
  reason?: string;
}

interface ValidatorResult {
  score: number;
  verdict: "pass" | "rewrite" | "unknown";
  leaks: ValidatorLeak[];
  notes?: string;
  latencyMs: number;
  ok: boolean;
  model?: string;
  agreement?: "agree" | "disagree" | "single";
}

interface ValidateOptions {
  apiKey?: string;
  passThreshold?: number;
  maxChars?: number;
  timeoutMs?: number;
  model?: string;
}

interface ValidatorModule {
  validateDialect: (
    text: string,
    dialect: string,
    opts?: ValidateOptions,
  ) => Promise<ValidatorResult>;
  validateDialectCrossChecked: (
    text: string,
    dialect: string,
    opts?: ValidateOptions,
  ) => Promise<ValidatorResult>;
}

/** What the model is asked to emit: a score, a verdict and the offending tokens. */
const judgment = (over: Record<string, unknown> = {}) => ({
  score: 5,
  verdict: "pass",
  leaks: [],
  ...over,
});

async function withValidator(
  run: (mod: ValidatorModule, up: StubbedUpstreams) => Promise<void>,
  options: { env?: Record<string, string | undefined>; upstreams?: Record<string, () => Response> } = {},
): Promise<void> {
  const up = stubUpstreams({ env: options.env, upstreams: options.upstreams });
  try {
    await run(await loadSharedModule<ValidatorModule>("dialectValidator"), up);
  } finally {
    up.restore();
  }
}

const bodyOf = (call: { body: string | null }) => JSON.parse(call.body ?? "null");

// ── One validator ───────────────────────────────────────────────────────────

Deno.test("an authentic text passes with the model's score", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("شخبارك؟", "Gulf");

    assertEquals(result.ok, true);
    assertEquals(result.score, 5);
    assertEquals(result.verdict, "pass");
    assertEquals(result.model, STRONG);
  }, { upstreams: { [GATEWAY]: () => chatCompletion("", judgment()) } });
});

Deno.test("a fusha-sounding text is sent back for a rewrite, with the offending words", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("ماذا تفعل؟", "Gulf");

    assertEquals(result.verdict, "rewrite");
    assertEquals(result.score, 2);
    // Naming the token and the replacement is what makes the rewrite pass
    // possible; a bare score would only say "try again".
    assertEquals(result.leaks, [{ token: "ماذا", suggestion: "شنو", reason: "MSA interrogative" }]);
    assertEquals(result.notes, "reads as fusha");
  }, {
    upstreams: {
      [GATEWAY]: () =>
        chatCompletion("", judgment({
          score: 2,
          verdict: "rewrite",
          leaks: [{ token: "ماذا", suggestion: "شنو", reason: "MSA interrogative" }],
          notes: "reads as fusha",
        })),
    },
  });
});

Deno.test("a score below the bar is a rewrite even when the model said pass", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("ماذا تفعل؟", "Gulf");

    // The rubric tells the model to choose 3 when torn between 3 and 4, so a
    // "pass" at 3 is the model contradicting its own instructions.
    assertEquals(result.score, 3);
    assertEquals(result.verdict, "rewrite");
  }, { upstreams: { [GATEWAY]: () => chatCompletion("", judgment({ score: 3 })) } });
});

Deno.test("a caller can demand a stricter score than the default", async () => {
  await withValidator(async (mod) => {
    assertEquals((await mod.validateDialect("x", "Gulf", { passThreshold: 5 })).verdict, "rewrite");
    assertEquals((await mod.validateDialect("x", "Gulf", { passThreshold: 4 })).verdict, "pass");
  }, { upstreams: { [GATEWAY]: () => chatCompletion("", judgment({ score: 4 })) } });
});

Deno.test("a score outside the scale is clamped rather than trusted", async () => {
  await withValidator(async (mod) => {
    assertEquals((await mod.validateDialect("x", "Gulf")).score, 5);
  }, { upstreams: { [GATEWAY]: () => chatCompletion("", judgment({ score: 9 })) } });
});

Deno.test("a fractional score is rounded onto the scale", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("x", "Gulf");
    assertEquals(result.score, 4);
    assertEquals(result.verdict, "pass");
  }, { upstreams: { [GATEWAY]: () => chatCompletion("", judgment({ score: 3.6 })) } });
});

Deno.test("a judgment with no score at all is treated as a perfect five", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("ماذا تفعل؟", "Gulf");

    // Pinned. `Number(undefined) || 5` makes a missing or non-numeric score a
    // 5, so a model that emits the tool call but omits the field waves the text
    // through at the top of the scale. The one field the gate exists to read is
    // the one whose absence is read as the best possible answer.
    assertEquals(result.score, 5);
    assertEquals(result.verdict, "pass");
    assertEquals(result.ok, true);
  }, { upstreams: { [GATEWAY]: () => chatCompletion("", { verdict: "pass", leaks: [] }) } });
});

Deno.test("leaks without a token are dropped", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("x", "Gulf");

    // The rewrite pass substitutes on `token`; an entry without one would be a
    // null replaced into the text.
    assertEquals(result.leaks, [{ token: "ماذا" }]);
  }, {
    upstreams: {
      [GATEWAY]: () =>
        chatCompletion("", judgment({
          score: 2,
          leaks: [{ token: "ماذا" }, { suggestion: "شنو" }, null],
        })),
    },
  });
});

Deno.test("a text with nothing in it is not sent to a model", async () => {
  await withValidator(async (mod, up) => {
    for (const text of ["", "   "]) {
      const result = await mod.validateDialect(text, "Gulf");
      assertEquals(result.ok, false);
      assertEquals(result.verdict, "unknown");
      assertEquals(result.score, 0);
    }
    // ok:false is what tells the caller to ignore the result; a paid call to
    // judge an empty string would return "pass" and mean nothing.
    assertEquals(up.calls.length, 0);
  });
});

Deno.test("a missing API key degrades to unknown rather than to pass", async () => {
  await withValidator(async (mod, up) => {
    const result = await mod.validateDialect("شخبارك؟", "Gulf");

    // The difference matters: `unknown` with ok:false makes the caller skip the
    // gate knowingly, where a default `pass` would silently disable it.
    assertEquals(result.ok, false);
    assertEquals(result.verdict, "unknown");
    assertEquals(up.calls.length, 0);
  }, { env: { LOVABLE_API_KEY: undefined } });
});

Deno.test("a gateway error degrades to unknown", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialect("شخبارك؟", "Gulf");

    assertEquals(result.ok, false);
    assertEquals(result.verdict, "unknown");
    assertEquals(result.model, STRONG);
  }, { upstreams: { [GATEWAY]: () => json({ error: "rate limited" }, 429) } });
});

Deno.test("a reply with no tool call degrades to unknown", async () => {
  await withValidator(async (mod) => {
    // A model that answers in prose instead of calling the tool has not
    // produced a score, and there is nothing to parse out of it.
    assertEquals((await mod.validateDialect("x", "Gulf")).ok, false);
  }, { upstreams: { [GATEWAY]: () => chatCompletion("looks fine to me") } });
});

Deno.test("unparseable tool arguments degrade to unknown", async () => {
  await withValidator(async (mod) => {
    assertEquals((await mod.validateDialect("x", "Gulf")).ok, false);
  }, {
    upstreams: {
      [GATEWAY]: () =>
        json({
          choices: [{
            message: {
              tool_calls: [{ function: { name: "emit_authenticity_score", arguments: "{oops" } }],
            },
          }],
        }),
    },
  });
});

Deno.test("a network failure degrades to unknown rather than throwing", async () => {
  await withValidator(async (mod) => {
    // The validator sits inside a generation request the learner is waiting on;
    // an unhandled rejection here would fail the lesson, not just the check.
    assertEquals((await mod.validateDialect("x", "Gulf")).ok, false);
  }, {
    upstreams: {
      [GATEWAY]: () => {
        throw new TypeError("connection reset");
      },
    },
  });
});

Deno.test("the judgment is asked for as a tool call, not as prose", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialect("شخبارك؟", "Gulf");

    const body = bodyOf(up.callsTo(GATEWAY)[0]);
    // Forcing the function call is what makes the score parseable at all — the
    // no-tool-call path above is the alternative.
    assertEquals(body.tool_choice.function.name, "emit_authenticity_score");
    assertEquals(body.model, STRONG);
    // Judging is a classification, not a creative task.
    assertEquals(body.temperature, 0.2);
  });
});

Deno.test("the reviewer is briefed with the dialect's own rulebook", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialect("شخبارك؟", "Yemeni");

    const system = bodyOf(up.callsTo(GATEWAY)[0]).messages[0].content;
    // Without the dialect identity and vocab rules in the prompt, the model
    // judges against generic Arabic — which is the failure mode this validator
    // was written to catch.
    assert(system.includes("Yemeni"), system.slice(0, 200));
    assert(system.includes("STRICT NATIVE-SPEAKER REVIEWER"), system.slice(0, 200));
    assert(system.includes("Be harsh."), system.slice(-200));
  });
});

Deno.test("a long text is truncated before it is judged", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialect("ا".repeat(9000), "Gulf", { maxChars: 100 });

    const user = bodyOf(up.callsTo(GATEWAY)[0]).messages[1].content;
    // Cost control on a check that runs on every generated paragraph; the first
    // few hundred characters are enough to hear the dialect.
    assert(user.includes("ا".repeat(100)), "truncated snippet missing");
    assert(!user.includes("ا".repeat(101)), "snippet was not truncated");
  });
});

Deno.test("an Arabic-native model is billed through OpenRouter instead", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialect("شخبارك؟", "Gulf", { model: ARABIC });

    assertEquals(up.callsTo(GATEWAY).length, 0);
    const [call] = up.callsTo(OPENROUTER);
    // Saba is not on the Lovable gateway, and sending it there with the wrong
    // key is a 401 that would show up as "validator unavailable".
    assertEquals(call.headers.authorization, "Bearer fixture-openrouter");
  });
});

Deno.test("an explicit key overrides the gateway secret", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialect("شخبارك؟", "Gulf", { apiKey: "caller-key" });

    assertEquals(up.callsTo(GATEWAY)[0].headers.authorization, "Bearer caller-key");
  });
});

Deno.test("an explicit key cannot be used for an OpenRouter model", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialect("شخبارك؟", "Gulf", { model: ARABIC, apiKey: "caller-key" });

    // Pinned. The OpenRouter branch reads the environment and ignores
    // `opts.apiKey` entirely, so a caller passing its own key for a Saba call
    // gets the ambient one — and gets `ok: false` with no explanation when
    // OPENROUTER_API_KEY is unset.
    assertEquals(up.callsTo(OPENROUTER)[0].headers.authorization, "Bearer fixture-openrouter");
  });
});

// ── Two validators ──────────────────────────────────────────────────────────

/** Route each model to its own verdict, so the merge is what is being tested. */
const crossCheck = (arabic: Record<string, unknown>, strong: Record<string, unknown>) => ({
  [OPENROUTER]: () => chatCompletion("", judgment(arabic)),
  [GATEWAY]: () => chatCompletion("", judgment(strong)),
});

Deno.test("both models always run, and agreement is reported", async () => {
  await withValidator(async (mod, up) => {
    const result = await mod.validateDialectCrossChecked("شخبارك؟", "Gulf");

    // Both, every time: the shortcut that skipped the strong reviewer whenever
    // the cheap one said 5/5 is the bug this shape exists to prevent.
    assertEquals(up.callsTo(OPENROUTER).length, 1);
    assertEquals(up.callsTo(GATEWAY).length, 1);
    assertEquals(result.agreement, "agree");
    assertEquals(result.verdict, "pass");
    assertEquals(result.model, `${ARABIC}+${STRONG}`);
  }, { upstreams: crossCheck({ score: 5 }, { score: 5 }) });
});

Deno.test("a rewrite from either model stands", async () => {
  await withValidator(async (mod) => {
    const lenientArabic = await mod.validateDialectCrossChecked("x", "Gulf");
    assertEquals(lenientArabic.verdict, "rewrite");
    assertEquals(lenientArabic.agreement, "disagree");
    // The lower score is reported, so a caller thresholding on the number
    // reaches the same conclusion as one reading the verdict.
    assertEquals(lenientArabic.score, 2);
  }, {
    upstreams: crossCheck({ score: 5 }, { score: 2, verdict: "rewrite" }),
  });
});

Deno.test("a rewrite from the cheap model also stands", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialectCrossChecked("x", "Gulf");
    assertEquals(result.verdict, "rewrite");
    assertEquals(result.score, 1);
  }, {
    upstreams: crossCheck({ score: 1, verdict: "rewrite" }, { score: 5 }),
  });
});

Deno.test("the two leak lists are merged without repeating a token", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialectCrossChecked("x", "Gulf");

    // Both models flagging the same word is confirmation, not two problems.
    assertEquals(result.leaks.map((leak) => leak.token), ["ماذا", "لماذا", "كيف"]);
  }, {
    upstreams: crossCheck(
      { score: 2, verdict: "rewrite", leaks: [{ token: "ماذا" }, { token: "كيف" }] },
      { score: 2, verdict: "rewrite", leaks: [{ token: "ماذا" }, { token: "لماذا" }] },
    ),
  });
});

Deno.test("the merged leak list is capped at ten", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialectCrossChecked("x", "Gulf");
    assertEquals(result.leaks.length, 10);
  }, {
    upstreams: crossCheck(
      {
        score: 2,
        verdict: "rewrite",
        leaks: Array.from({ length: 10 }, (_, i) => ({ token: `a${i}` })),
      },
      {
        score: 2,
        verdict: "rewrite",
        leaks: Array.from({ length: 10 }, (_, i) => ({ token: `b${i}` })),
      },
    ),
  });
});

Deno.test("when the strong model fails the Arabic one stands alone", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialectCrossChecked("x", "Gulf");

    // Degrading to one opinion beats degrading to none, and `single` tells the
    // caller the cross-check did not happen.
    assertEquals(result.ok, true);
    assertEquals(result.agreement, "single");
    assertEquals(result.model, ARABIC);
  }, {
    upstreams: {
      [OPENROUTER]: () => chatCompletion("", judgment({ score: 5 })),
      [GATEWAY]: () => json({ error: "down" }, 503),
    },
  });
});

Deno.test("when the Arabic model fails the strong one stands alone", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialectCrossChecked("x", "Gulf");

    assertEquals(result.ok, true);
    assertEquals(result.agreement, "single");
    assertEquals(result.model, STRONG);
  }, {
    upstreams: {
      [OPENROUTER]: () => json({ error: "down" }, 503),
      [GATEWAY]: () => chatCompletion("", judgment({ score: 5 })),
    },
  });
});

Deno.test("when both fail the result says so instead of guessing", async () => {
  await withValidator(async (mod) => {
    const result = await mod.validateDialectCrossChecked("x", "Gulf");

    assertEquals(result.ok, false);
    assertEquals(result.verdict, "unknown");
  }, {
    upstreams: {
      [OPENROUTER]: () => json({ error: "down" }, 503),
      [GATEWAY]: () => json({ error: "down" }, 503),
    },
  });
});

Deno.test("the cross-check can be switched off for a single strong opinion", async () => {
  await withValidator(async (mod, up) => {
    const result = await mod.validateDialectCrossChecked("شخبارك؟", "Gulf");

    // An escape hatch for cost, not a default: it halves the spend and removes
    // the second opinion that catches the Yemeni fusha case.
    assertEquals(up.callsTo(OPENROUTER).length, 0);
    assertEquals(result.model, STRONG);
    assertEquals(result.agreement, undefined);
  }, {
    env: { DIALECT_VALIDATOR_CROSSCHECK: "off" },
    upstreams: { [GATEWAY]: () => chatCompletion("", judgment()) },
  });
});

Deno.test("any other value leaves the cross-check on", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialectCrossChecked("شخبارك؟", "Gulf");

    // A misspelt "false" or "0" must not silently disable the gate.
    assertEquals(up.callsTo(OPENROUTER).length, 1);
  }, {
    env: { DIALECT_VALIDATOR_CROSSCHECK: "false" },
    upstreams: crossCheck({}, {}),
  });
});

Deno.test("each leg gets its own clock", async () => {
  await withValidator(async (mod, up) => {
    await mod.validateDialectCrossChecked("شخبارك؟", "Gulf", { timeoutMs: 5000 });

    // Two calls, two AbortSignals. One shared signal is what once left the
    // strong validator with the seconds a slow Saba had not spent, so it
    // aborted into `unknown` and the cross-check degraded to Saba alone.
    assertEquals(up.callsTo(OPENROUTER).length, 1);
    assertEquals(up.callsTo(GATEWAY).length, 1);
  }, { upstreams: crossCheck({}, {}) });
});

// ── literalGloss ────────────────────────────────────────────────────────────

interface LiteralGlossModule {
  LITERAL_GLOSS_RULE: string;
  literalSchema: (what?: string) => { type: string; description: string };
}

Deno.test("the literal-gloss rule insists on both translations", async () => {
  const mod = await loadSharedModule<LiteralGlossModule>("literalGloss");

  // One shared string across every translating function is the point: a gloss
  // written to a different style in each feature teaches a different thing in
  // each feature.
  assert(mod.LITERAL_GLOSS_RULE.includes('"literal" field'), mod.LITERAL_GLOSS_RULE);
  assert(mod.LITERAL_GLOSS_RULE.includes("word-for-word"), mod.LITERAL_GLOSS_RULE);
  // The instruction models the stiffness so the model does not smooth it away —
  // the stiffness is the pedagogy.
  assert(mod.LITERAL_GLOSS_RULE.includes("what news-your?"), mod.LITERAL_GLOSS_RULE);
  assert(mod.LITERAL_GLOSS_RULE.includes("Never merge"), mod.LITERAL_GLOSS_RULE);
});

Deno.test("the literal field is described for whatever is being glossed", async () => {
  const { literalSchema } = await loadSharedModule<LiteralGlossModule>("literalGloss");

  assertEquals(literalSchema().type, "string");
  assert(literalSchema().description.includes("of the line"), literalSchema().description);
  // The noun varies — a line, a phrase, a caption — and it goes into a JSON
  // schema the model reads, so it has to name the thing in front of it.
  assert(literalSchema("caption").description.includes("of the caption"));
});
