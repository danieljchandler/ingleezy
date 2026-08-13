import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jsonRequest, loadFunction } from "./harness.ts";
import { json } from "./upstreams.ts";

/**
 * What the AI-backed functions do when the model provider says no.
 *
 * Two upstream failures happen in production for reasons outside the app's
 * control: 402 when the gateway's credits run out, and 429 when it rate-limits.
 * Both are transient and both need to reach the learner as something other than
 * silence — the client shows a generic failure, so a function that swallows the
 * status leaves them clicking a button that appears to do nothing.
 *
 * 32 of the 84 functions handle 402 explicitly and 36 handle 429, which is most
 * but not all of the AI-backed set. This sweeps every function that talks to a
 * model gateway and asserts the floor: never a throw, never a 200 pretending it
 * worked.
 */

/** Functions whose source reaches an LLM gateway. */
async function aiBackedFunctions(): Promise<string[]> {
  const names: string[] = [];

  for await (const entry of Deno.readDir(new URL("../", import.meta.url))) {
    if (!entry.isDirectory || entry.name.startsWith("_")) continue;

    const source = await Deno.readTextFile(
      new URL(`../${entry.name}/index.ts`, import.meta.url),
    ).catch(() => "");

    const callsModel =
      source.includes("askBrain") ||
      source.includes("ai.gateway.lovable.dev") ||
      source.includes("openrouter.ai") ||
      source.includes("generativelanguage.googleapis.com");

    if (callsModel) names.push(entry.name);
  }

  return names.sort();
}

const names = await aiBackedFunctions();

/** Every gateway answers with the given status, everything else succeeds. */
function failingGateways(status: number, body: unknown) {
  const fail = () => json(body, status);
  return {
    "ai.gateway.lovable.dev": fail,
    "openrouter.ai": fail,
    "generativelanguage.googleapis.com": fail,
    "api.fanar.qa": fail,
    "api.openai.com": fail,
    "router.huggingface.co": fail,

    // The usage cap runs first on many of these; let it through so the model
    // call is what fails rather than the quota check.
    "/auth/v1/user": () => json({ id: "00000000-0000-4000-8000-000000000001" }),
    "/rest/v1/subscribers": () => json({ subscribed: true, subscription_end: null }),
    "/rest/v1/user_roles": () => json(null),
    "/rest/v1/rpc/increment_usage_counter": () => json(1),
  };
}

async function sweep(
  describe: string,
  status: number,
  body: unknown,
): Promise<void> {
  const threw: string[] = [];
  const pretendedToWork: string[] = [];

  for (const name of names) {
    const fn = await loadFunction(name, { upstreams: failingGateways(status, body) });

    try {
      const response = await fn.handler(
        jsonRequest(name, {
          text: "مرحبا",
          dialect: "Gulf",
          category: "negation",
          word: "بيت",
          prompt: "hello",
          messages: [{ role: "user", content: "hi" }],
        }),
      );

      // A 200 whose body carries no result is the shape that makes a button
      // look broken: the client sees success and renders nothing.
      if (response.status === 200) {
        const text = await response.clone().text();
        const looksEmpty = text === "" || text === "{}" || text === "null";
        if (looksEmpty) pretendedToWork.push(`${name}: 200 with ${text || "empty body"}`);
      }
    } catch (error) {
      threw.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fn.restore();
    }
  }

  assertEquals(
    threw,
    [],
    `Functions that threw on ${describe}. An unhandled throw returns a bare 500 ` +
      `with no CORS headers, which the browser reports as a network error:\n` +
      threw.join("\n"),
  );

  assertEquals(
    pretendedToWork,
    [],
    `Functions that returned an empty success on ${describe}:\n` +
      pretendedToWork.join("\n"),
  );
}

Deno.test("there are AI-backed functions to sweep", () => {
  // A floor, so a broken detector shows up here rather than as a suspiciously
  // clean run.
  assertEquals(names.length > 15, true, `only found ${names.length}: ${names.join(", ")}`);
});

Deno.test("no AI function falls over when the gateway is out of credits", async () => {
  await sweep("a 402 from the model gateway", 402, {
    error: { message: "Insufficient credits", type: "insufficient_quota" },
  });
});

Deno.test("no AI function falls over when the gateway rate-limits", async () => {
  await sweep("a 429 from the model gateway", 429, {
    error: { message: "Rate limit exceeded", type: "rate_limit_error" },
  });
});

Deno.test("no AI function falls over on a gateway 500", async () => {
  await sweep("a 500 from the model gateway", 500, { error: { message: "internal error" } });
});

Deno.test("no AI function falls over when the gateway returns unparseable JSON", async () => {
  // Gateways return HTML error pages under load, which is a different failure
  // from a well-formed error body and breaks different code.
  const threw: string[] = [];

  for (const name of names) {
    const html = () => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 });
    const fn = await loadFunction(name, {
      upstreams: {
        ...failingGateways(502, {}),
        "ai.gateway.lovable.dev": html,
        "openrouter.ai": html,
        "generativelanguage.googleapis.com": html,
      },
    });

    try {
      await fn.handler(jsonRequest(name, { text: "مرحبا", dialect: "Gulf" }));
    } catch (error) {
      threw.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fn.restore();
    }
  }

  assertEquals(threw, [], `Functions that threw on an HTML error page:\n${threw.join("\n")}`);
});

Deno.test("no AI function falls over when the gateway never answers", async () => {
  // A dropped connection, as opposed to an error status.
  const threw: string[] = [];

  for (const name of names) {
    const drop = () => {
      throw new TypeError("error sending request for url: connection closed");
    };
    const fn = await loadFunction(name, {
      upstreams: {
        ...failingGateways(500, {}),
        "ai.gateway.lovable.dev": drop,
        "openrouter.ai": drop,
        "generativelanguage.googleapis.com": drop,
      },
    });

    try {
      await fn.handler(jsonRequest(name, { text: "مرحبا", dialect: "Gulf" }));
    } catch (error) {
      threw.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fn.restore();
    }
  }

  assertEquals(threw, [], `Functions that threw on a dropped connection:\n${threw.join("\n")}`);
});
