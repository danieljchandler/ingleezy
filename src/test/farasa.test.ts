import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callFarasa,
  callFarasaDiacritizeLines,
  extractFarasaText,
  farasaEndpoints,
  looksLikeAuthFailure,
} from "../../supabase/functions/_shared/farasa";

/** Minimal Response stand-in — callFarasa only reads status, ok and text(). */
const reply = (status: number, body: string) =>
  ({ status, ok: status >= 200 && status < 300, text: async () => body }) as unknown as Response;

const AUTH_BODY = "invalid api key. please register at farasa.qcri.org.";

describe("farasaEndpoints", () => {
  it("puts diacritizeV2 first for the diac task", () => {
    const [first] = farasaEndpoints("diac");
    expect(first[0]).toContain("diacritizeV2");
  });

  it("tries both hosts and both encodings for the other tasks", () => {
    const endpoints = farasaEndpoints("pos");
    expect(endpoints).toHaveLength(4);
    expect(new Set(endpoints.map((e) => e[1]))).toEqual(new Set(["json", "form"]));
    expect(endpoints.every(([url]) => url.endsWith("/pos/"))).toBe(true);
  });
});

describe("looksLikeAuthFailure", () => {
  it("recognises Farasa's prose rejection at any status", () => {
    expect(looksLikeAuthFailure(200, AUTH_BODY)).toBe(true);
    expect(looksLikeAuthFailure(400, AUTH_BODY)).toBe(true);
  });

  it("recognises the auth status codes regardless of body", () => {
    expect(looksLikeAuthFailure(401, "")).toBe(true);
    expect(looksLikeAuthFailure(403, "nope")).toBe(true);
  });

  it("does not mistake an ordinary failure for an auth failure", () => {
    expect(looksLikeAuthFailure(500, "internal server error")).toBe(false);
    expect(looksLikeAuthFailure(404, "not found")).toBe(false);
  });
});

describe("extractFarasaText", () => {
  it("reads whichever field this deployment used", () => {
    expect(extractFarasaText({ text: "بَيْت" })).toBe("بَيْت");
    expect(extractFarasaText({ output: "بَيْت" })).toBe("بَيْت");
    // `result` was handled by only one of the two copies this module replaced.
    expect(extractFarasaText({ result: "بَيْت" })).toBe("بَيْت");
  });

  it("accepts a bare string body", () => {
    expect(extractFarasaText("بَيْت")).toBe("بَيْت");
  });

  it("rejects payloads with no usable text", () => {
    expect(extractFarasaText({ text: "" })).toBeNull();
    expect(extractFarasaText({ text: "   " })).toBeNull();
    expect(extractFarasaText({ status: "ok" })).toBeNull();
    expect(extractFarasaText(null)).toBeNull();
    expect(extractFarasaText(42)).toBeNull();
  });
});

describe("callFarasa", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first usable response and stops calling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, JSON.stringify({ text: "مَرْحَبا" })));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "مرحبا", { apiKey: "k" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe("مَرْحَبا");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps going past a 200 whose body has no usable text", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, JSON.stringify({ unexpected: "shape" })))
      .mockResolvedValueOnce(reply(200, JSON.stringify({ result: "مَرْحَبا" })));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "مرحبا", { apiKey: "k" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe("مَرْحَبا");
    // The old code returned null here and never tried the second endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.attempts.map((a) => a.outcome)).toEqual(["unusable_body", "ok"]);
  });

  it("reports invalid_api_key when every endpoint rejects the credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(401, AUTH_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "مرحبا", { apiKey: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("invalid_api_key");
      expect(out.attempts).toHaveLength(farasaEndpoints("diac").length);
      expect(out.attempts.every((a) => a.outcome === "auth")).toBe(true);
    }
  });

  it("still succeeds when only some endpoints reject the key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(403, AUTH_BODY))
      .mockResolvedValueOnce(reply(200, JSON.stringify({ text: "مَرْحَبا" })));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "مرحبا", { apiKey: "k" });
    expect(out.ok).toBe(true);
  });

  it("distinguishes a broken service from a rejected key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(500, "internal server error"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "مرحبا", { apiKey: "k" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("all_endpoints_failed");
  });

  it("reports timeout when nothing ever answers", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException("aborted", "AbortError"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "مرحبا", { apiKey: "k" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("timeout");
  });

  it("does not call the network for empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasa("diac", "   ", { apiKey: "k" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("empty_input");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the api key in whichever encoding the endpoint expects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(404, "not found"))
      .mockResolvedValueOnce(reply(404, "not found"))
      .mockResolvedValue(reply(200, JSON.stringify({ text: "ok" })));
    vi.stubGlobal("fetch", fetchMock);

    await callFarasa("diac", "مرحبا", { apiKey: "secret-key" });

    const [, jsonInit] = fetchMock.mock.calls[0];
    expect(jsonInit.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(jsonInit.body).api_key).toBe("secret-key");

    const formCall = fetchMock.mock.calls.find(
      ([, init]) => init.headers["Content-Type"] === "application/x-www-form-urlencoded",
    );
    expect(formCall).toBeDefined();
    expect(new URLSearchParams(formCall![1].body).get("api_key")).toBe("secret-key");
  });

  it("omits the api_key field entirely when no key is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, JSON.stringify({ text: "ok" })));
    vi.stubGlobal("fetch", fetchMock);

    await callFarasa("diac", "مرحبا", { apiKey: "" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("api_key");
  });
});

describe("callFarasaDiacritizeLines", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ok = (text: string) => reply(200, JSON.stringify({ text }));

  it("returns one diacritized line per input line, in order", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok("أَوَّل"))
      .mockResolvedValueOnce(ok("ثَانِي"))
      .mockResolvedValueOnce(ok("ثَالِث"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasaDiacritizeLines(["اول", "ثاني", "ثالث"], { apiKey: "k" });
    expect(out.lines).toEqual(["أَوَّل", "ثَانِي", "ثَالِث"]);
    expect(out.ok).toBe(true);
    expect(out.succeeded).toBe(3);
  });

  it("stops immediately when the key is rejected, rather than retrying every line", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(401, AUTH_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasaDiacritizeLines(["اول", "ثاني", "ثالث"], { apiKey: "" });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("invalid_api_key");
    // Only the probe line's endpoint cascade — not 3 lines' worth.
    expect(fetchMock.mock.calls.length).toBe(farasaEndpoints("diac").length);
  });

  it("keeps the lines that worked when one fails", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { body: string }) => {
      const text = JSON.parse(init.body).text;
      if (text === "ثاني") return Promise.resolve(reply(500, "boom"));
      return Promise.resolve(ok(`${text}ِ`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasaDiacritizeLines(["اول", "ثاني", "ثالث"], { apiKey: "k" });
    expect(out.lines[0]).toBeTruthy();
    expect(out.lines[1]).toBeNull();
    expect(out.lines[2]).toBeTruthy();
    expect(out.succeeded).toBe(2);
    expect(out.failed).toBe(1);
  });

  it("skips blank lines without calling out for them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok("أَوَّل"));
    vi.stubGlobal("fetch", fetchMock);

    const out = await callFarasaDiacritizeLines(["اول", "   ", ""], { apiKey: "k" });
    expect(out.lines[1]).toBeNull();
    expect(out.lines[2]).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("carries a sample of the output for diagnosis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("أَوَّل")));
    const out = await callFarasaDiacritizeLines(["اول"], { apiKey: "k" });
    expect(out.sample).toBe("أَوَّل");
  });

  it("reports empty input without calling out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await callFarasaDiacritizeLines([], { apiKey: "k" });
    expect(out.reason).toBe("empty_input");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
