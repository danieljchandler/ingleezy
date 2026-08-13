import { describe, it, expect } from "vitest";
import {
  CAMEL_CITY_MAP,
  camelAgreesWithModule,
  parseCamelPredictions,
  toCamelPrediction,
} from "../../supabase/functions/_shared/camelDialect";

describe("parseCamelPredictions", () => {
  it("reads the flat HuggingFace shape", () => {
    expect(parseCamelPredictions([{ label: "RIY", score: 0.8 }])).toEqual([
      { label: "RIY", score: 0.8 },
    ]);
  });

  it("reads the nested HuggingFace shape", () => {
    // This shape used to make `predictions[0].label` undefined and throw on
    // .toUpperCase(), which surfaced as a silent null.
    expect(parseCamelPredictions([[{ label: "CAI", score: 0.7 }]])).toEqual([
      { label: "CAI", score: 0.7 },
    ]);
  });

  it("sorts by score descending", () => {
    const out = parseCamelPredictions([
      { label: "RIY", score: 0.2 },
      { label: "CAI", score: 0.9 },
    ]);
    expect(out?.map((p) => p.label)).toEqual(["CAI", "RIY"]);
  });

  it("skips malformed entries but keeps valid ones", () => {
    const out = parseCamelPredictions([null, { score: 1 }, { label: "SAN", score: 0.5 }]);
    expect(out).toEqual([{ label: "SAN", score: 0.5 }]);
  });

  it("returns null for non-arrays, empty arrays and all-malformed entries", () => {
    expect(parseCamelPredictions({ error: "loading" })).toBeNull();
    expect(parseCamelPredictions([])).toBeNull();
    expect(parseCamelPredictions([{ nope: true }])).toBeNull();
  });

  it("defaults a missing score to 0 rather than dropping the label", () => {
    expect(parseCamelPredictions([{ label: "DOH" }])).toEqual([{ label: "DOH", score: 0 }]);
  });
});

describe("toCamelPrediction", () => {
  it("maps a known code to its dialect, country and module", () => {
    const p = toCamelPrediction([{ label: "riy", score: 0.8123 }]);
    expect(p).toMatchObject({
      code: "RIY",
      dialect: "Saudi",
      country: "Saudi Arabia",
      isGulf: true,
      module: "Gulf",
      confidence: 0.812,
    });
  });

  it("maps Sana'a to the Yemeni module", () => {
    expect(toCamelPrediction([{ label: "SAN", score: 0.6 }]).module).toBe("Yemeni");
  });

  it("degrades gracefully on an unknown label", () => {
    const p = toCamelPrediction([{ label: "ZZZ", score: 0.4 }]);
    expect(p).toMatchObject({ code: "ZZZ", dialect: "ZZZ", isGulf: false, module: null });
  });

  it("caps topPredictions at five", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: "RIY", score: 1 - i / 10 }));
    expect(toCamelPrediction(many).topPredictions).toHaveLength(5);
  });
});

describe("camelAgreesWithModule", () => {
  const gulf = toCamelPrediction([{ label: "RIY", score: 0.9 }]);
  const egyptian = toCamelPrediction([{ label: "CAI", score: 0.9 }]);
  const yemeni = toCamelPrediction([{ label: "SAN", score: 0.9 }]);
  const levantine = toCamelPrediction([{ label: "BEI", score: 0.9 }]);
  const msa = toCamelPrediction([{ label: "MSA", score: 0.9 }]);
  const unknown = toCamelPrediction([{ label: "ZZZ", score: 0.9 }]);

  it("agrees when the predicted module matches", () => {
    expect(camelAgreesWithModule(gulf, "Gulf")).toBe(true);
    expect(camelAgreesWithModule(egyptian, "Egyptian")).toBe(true);
    expect(camelAgreesWithModule(yemeni, "Yemeni")).toBe(true);
  });

  it("disagrees only across two taught modules", () => {
    expect(camelAgreesWithModule(egyptian, "Gulf")).toBe(false);
    expect(camelAgreesWithModule(gulf, "Yemeni")).toBe(false);
  });

  it("stays null when CAMeL has no bearing on the question", () => {
    // The Gulf-only map used to score all of these as disagreement, which
    // raised `flagged` on content the model had no opinion about.
    expect(camelAgreesWithModule(levantine, "Gulf")).toBeNull();
    expect(camelAgreesWithModule(msa, "Gulf")).toBeNull();
    expect(camelAgreesWithModule(unknown, "Gulf")).toBeNull();
    expect(camelAgreesWithModule(null, "Gulf")).toBeNull();
  });

  it("does not treat a correct Egyptian call as a Gulf disagreement", () => {
    expect(camelAgreesWithModule(egyptian, "Egyptian")).not.toBe(false);
  });
});

describe("CAMEL_CITY_MAP", () => {
  it("covers all three taught modules", () => {
    const modules = new Set(Object.values(CAMEL_CITY_MAP).map((m) => m.module));
    expect(modules).toContain("Gulf");
    expect(modules).toContain("Egyptian");
    expect(modules).toContain("Yemeni");
  });

  it("marks exactly the Gulf entries as isGulf", () => {
    for (const meta of Object.values(CAMEL_CITY_MAP)) {
      expect(meta.isGulf).toBe(meta.module === "Gulf");
    }
  });
});
