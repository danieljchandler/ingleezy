// souq-news — the day's news from the learner's own region, retold in easy
// spoken ENGLISH with a dialect-Arabic scaffold. The regional search is the
// part of the Arabic-era feature worth keeping exactly: a Yemeni learner
// reading about Sanaa in English is reading news they already half-know,
// which is the cheapest comprehension scaffold there is.
import { getDialectLabel, type Dialect } from "../_shared/dialectHelpers.ts";
import { emitMetric } from "../_shared/featureMetrics.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { MODEL_IDS } from "../_shared/modelRegistry.ts";

const FEATURE = "souq-news";

const REGION_QUERIES: Record<string, string> = {
  Gulf: "Saudi Arabia UAE Qatar Kuwait Bahrain Oman news today",
  Egyptian: "Egypt Cairo news today",
  Yemeni: "Yemen Sanaa Aden news today",
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  let dialect: string = "Gulf";

  try {
    const body = await req.json();
    dialect = body?.dialect ?? "Gulf";

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      emitMetric({ feature: FEATURE, event: "config_missing", dialect, status: "error", meta: { missing: "FIRECRAWL_API_KEY" } });
      return new Response(
        JSON.stringify({ error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      emitMetric({ feature: FEATURE, event: "config_missing", dialect, status: "error", meta: { missing: "LOVABLE_API_KEY" } });
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const query = REGION_QUERIES[dialect] || REGION_QUERIES.Gulf;
    console.log("Searching news:", query);

    async function firecrawlSearch(tbs: string | null) {
      const fcStart = Date.now();
      const body: Record<string, unknown> = {
        query,
        limit: 5,
        lang: "en",
        scrapeOptions: { formats: ["markdown"] },
      };
      if (tbs) body.tbs = tbs;
      const res = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const elapsed = Date.now() - fcStart;
      if (!res.ok) {
        const errText = await res.text();
        console.error("Firecrawl error:", res.status, errText);
        emitMetric({
          feature: FEATURE,
          event: "firecrawl_search",
          dialect,
          status: "error",
          durationMs: elapsed,
          count: 0,
          meta: { tbs: tbs ?? "none", http_status: res.status, error: errText.slice(0, 500) },
        });
        return { ok: false as const, status: res.status, articles: [] as any[] };
      }
      const json = await res.json();
      let arr: any[] = [];
      if (Array.isArray(json.data)) arr = json.data;
      else if (Array.isArray(json.data?.web)) arr = json.data.web;
      else if (Array.isArray(json.web)) arr = json.web;
      if (json.warning) console.log(`Firecrawl warning (tbs=${tbs}):`, json.warning);
      emitMetric({
        feature: FEATURE,
        event: "firecrawl_search",
        dialect,
        status: arr.length === 0 ? "warn" : "ok",
        durationMs: elapsed,
        count: arr.length,
        meta: { tbs: tbs ?? "none", warning: json.warning ?? null },
      });
      return { ok: true as const, status: 200, articles: arr };
    }

    let articles: any[] = [];
    let chosenTbs: string | null = null;
    for (const tbs of ["qdr:d", "qdr:w", null]) {
      const r = await firecrawlSearch(tbs);
      if (!r.ok) {
        emitMetric({ feature: FEATURE, event: "request_failed", dialect, status: "error", durationMs: Date.now() - startedAt, meta: { stage: "firecrawl" } });
        return new Response(
          JSON.stringify({ error: "Failed to fetch news articles" }),
          { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (r.articles.length > 0) {
        articles = r.articles;
        chosenTbs = tbs;
        console.log(`Firecrawl returned ${articles.length} articles for ${dialect} (tbs=${tbs ?? "none"})`);
        break;
      }
    }

    if (articles.length === 0) {
      console.log(`No articles found for ${dialect} after fallbacks`);
      emitMetric({
        feature: FEATURE,
        event: "no_articles",
        dialect,
        status: "warn",
        count: 0,
        durationMs: Date.now() - startedAt,
      });
      return new Response(
        JSON.stringify({ articles: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dialectLabel = getDialectLabel(dialect as Dialect);

    const systemPrompt = `You are an English teacher retelling today's news to a native ${dialectLabel} Arabic speaker who is learning English. You are retelling news stories the way a friend tells them over coffee. Your tone in English is:
- Casual, animated, natural spoken English — contractions welcome; textbook stiffness is a defect
- Simple everyday vocabulary a learner can follow (roughly B1 level)
- You stay ACCURATE to the facts — no fabrication
- Keep it concise: 3-5 short sentences per story

For each article, return a JSON object with:
- "title_english": A catchy ENGLISH headline — this is what the learner reads first
- "body_english": The story retold in easy spoken English (3-5 sentences) — this is the full body as one string
- "sentences": Array of {"english": "...", "arabic": "...", "literal": "..."} — split body_english into its individual sentences. For EACH sentence provide "arabic": a natural ${dialectLabel} translation (authentic spoken dialect, NEVER Modern Standard Arabic / فصحى), and "literal": a word-for-word Arabic gloss preserving the ENGLISH word order (it may sound stiff — it shows the learner how the English sentence is built). The english values concatenated must equal body_english.
- "title_arabic": A ${dialectLabel} translation of the headline
- "summary_arabic": Brief ${dialectLabel} summary (1-2 sentences)
- "vocabulary": Array of 2-3 key English words from your retelling worth learning, each as {"english": "...", "arabic": "..."} with the ${dialectLabel} meaning

Return ONLY the JSON object, no markdown fencing. CRITICAL: use ONLY ASCII punctuation for JSON structure (commas \`,\`, colons \`:\`, quotes \`"\`). Never use Arabic comma \`،\` or Arabic semicolon \`؛\` as JSON separators — they are valid only inside string values.`;

    let creditsExhausted = false;
    let rateLimited = false;
    let parseErrors = 0;
    let aiErrors = 0;

    const settled = await Promise.all(
      articles.slice(0, 4).map(async (article) => {
        const content = article.markdown
          ? article.markdown.slice(0, 2000)
          : article.description || article.title || "";

        const aiStart = Date.now();
        try {
          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL_IDS.GEMINI_FAST,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `Retell this news article in easy spoken English for an Arabic-speaking learner:\n\nTitle: ${article.title || "No title"}\n\nContent: ${content}`,
                },
              ],
            }),
          });

          if (!aiRes.ok) {
            const status = aiRes.status;
            const errBody = await aiRes.text();
            console.error("AI error:", status, errBody);
            if (status === 429) rateLimited = true;
            if (status === 402) creditsExhausted = true;
            aiErrors++;
            emitMetric({
              feature: FEATURE,
              event: "ai_rewrite",
              dialect,
              status: "error",
              durationMs: Date.now() - aiStart,
              meta: { http_status: status, error: errBody.slice(0, 400), article: (article.title || "").slice(0, 200) },
            });
            return null;
          }

          const aiData = await aiRes.json();
          const raw = aiData.choices?.[0]?.message?.content || "";

          let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const firstBrace = cleaned.indexOf("{");
          const lastBrace = cleaned.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.slice(firstBrace, lastBrace + 1);
          }
          let parsed;
          let repairUsed = false;
          try {
            parsed = JSON.parse(cleaned);
          } catch (_e1) {
            const repaired = cleaned
              .replace(/(["}\]\d])\s*،/g, "$1,")
              .replace(/(["}\]\d])\s*؛/g, "$1;");
            try {
              parsed = JSON.parse(repaired);
              repairUsed = true;
            } catch (parseErr) {
              parseErrors++;
              console.error("JSON parse failed. Raw (first 500):", raw.slice(0, 500));
              emitMetric({
                feature: FEATURE,
                event: "json_parse",
                dialect,
                status: "error",
                durationMs: Date.now() - aiStart,
                meta: {
                  article: (article.title || "").slice(0, 200),
                  raw_preview: raw.slice(0, 400),
                  error: parseErr instanceof Error ? parseErr.message : String(parseErr),
                },
              });
              throw parseErr;
            }
          }

          emitMetric({
            feature: FEATURE,
            event: "ai_rewrite",
            dialect,
            status: repairUsed ? "warn" : "ok",
            durationMs: Date.now() - aiStart,
            meta: { repair_used: repairUsed, article: (article.title || "").slice(0, 200) },
          });

          return {
            ...parsed,
            source_url: article.url || null,
            published_at: new Date().toISOString(),
          };
        } catch (e) {
          console.error("Failed to process article:", article.title, e);
          return null;
        }
      })
    );

    if (creditsExhausted) {
      emitMetric({ feature: FEATURE, event: "request_failed", dialect, status: "error", durationMs: Date.now() - startedAt, meta: { reason: "credits_exhausted" } });
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Please add funds." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (rateLimited && settled.every((x) => x === null)) {
      emitMetric({ feature: FEATURE, event: "request_failed", dialect, status: "error", durationMs: Date.now() - startedAt, meta: { reason: "rate_limited" } });
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rewrittenArticles = settled.filter((x) => x !== null);
    console.log(`Returning ${rewrittenArticles.length} rewritten articles for ${dialect}`);

    const successRate = articles.length > 0 ? rewrittenArticles.length / Math.min(articles.length, 4) : 0;
    emitMetric({
      feature: FEATURE,
      event: "request_complete",
      dialect,
      status: rewrittenArticles.length === 0 ? "error" : (parseErrors > 0 || aiErrors > 0 ? "warn" : "ok"),
      durationMs: Date.now() - startedAt,
      count: rewrittenArticles.length,
      score: successRate,
      meta: {
        firecrawl_tbs: chosenTbs ?? "none",
        firecrawl_count: articles.length,
        attempted: Math.min(articles.length, 4),
        parse_errors: parseErrors,
        ai_errors: aiErrors,
      },
    });

    return new Response(
      JSON.stringify({ articles: rewrittenArticles }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("souq-news error:", e);
    emitMetric({
      feature: FEATURE,
      event: "unhandled_error",
      dialect,
      status: "error",
      durationMs: Date.now() - startedAt,
      meta: { error: e instanceof Error ? e.message : String(e) },
    });
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
