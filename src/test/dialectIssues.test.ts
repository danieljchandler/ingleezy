import { describe, it, expect } from "vitest";
import {
  extractJsonCandidates,
  findIssuesArray,
  normalizeDigits,
  parseDialectIssues,
  tolerantJsonParse,
} from "../../supabase/functions/_shared/dialectIssues";

describe("normalizeDigits", () => {
  it("converts Arabic-Indic digits to ASCII", () => {
    expect(normalizeDigits("٣")).toBe("3");
    expect(normalizeDigits("١٢٣")).toBe("123");
  });

  it("converts extended (Persian) Arabic-Indic digits", () => {
    expect(normalizeDigits("۴۵")).toBe("45");
  });

  it("leaves ASCII and Arabic letters alone", () => {
    expect(normalizeDigits("line 7 السطر")).toBe("line 7 السطر");
  });
});

describe("extractJsonCandidates", () => {
  it("finds an object embedded in prose on both sides", () => {
    const reply = 'راجعت النص. {"issues": []} انتهى.';
    expect(extractJsonCandidates(reply)[0]).toBe('{"issues": []}');
  });

  it("finds a bare array", () => {
    expect(extractJsonCandidates('[{"word":"جل"}]')).toContain('[{"word":"جل"}]');
  });

  it("strips markdown fences and think blocks", () => {
    const reply = '<think>hmm</think>\n```json\n{"issues": []}\n```';
    expect(extractJsonCandidates(reply)[0]).toBe('{"issues": []}');
  });

  it("is not fooled by a brace inside an Arabic note", () => {
    const reply = '{"issues":[{"note":"قوس } داخل النص","word":"جل"}]}';
    const [longest] = extractJsonCandidates(reply);
    expect(longest).toBe(reply);
    expect(tolerantJsonParse(longest)).not.toBeNull();
  });

  it("returns longest first so the outer object wins over a nested one", () => {
    const reply = '{"issues":[{"word":"جل"}]}';
    expect(extractJsonCandidates(reply)[0]).toBe(reply);
  });

  it("returns nothing for prose with no JSON", () => {
    expect(extractJsonCandidates("النص سليم ولا توجد مشاكل")).toEqual([]);
  });
});

describe("tolerantJsonParse", () => {
  it("parses clean JSON unchanged", () => {
    expect(tolerantJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("repairs a trailing comma", () => {
    expect(tolerantJsonParse('{"issues":[{"word":"جل"},]}')).toEqual({
      issues: [{ word: "جل" }],
    });
  });

  it("repairs smart quotes", () => {
    expect(tolerantJsonParse('{“a”:1}')).toEqual({ a: 1 });
  });

  it("repairs an Arabic comma used as a separator", () => {
    expect(tolerantJsonParse('{"a":"x"، "b":"y"}')).toEqual({ a: "x", b: "y" });
  });

  it("returns null for something beyond repair", () => {
    expect(tolerantJsonParse("{not json at all")).toBeNull();
  });
});

describe("findIssuesArray", () => {
  it("finds the requested shape", () => {
    expect(findIssuesArray({ issues: [{ word: "جل" }] })).toEqual([{ word: "جل" }]);
  });

  it("accepts a bare array of issue-shaped objects", () => {
    expect(findIssuesArray([{ word: "جل" }])).toEqual([{ word: "جل" }]);
  });

  it("finds an array nested under an unexpected wrapper key", () => {
    expect(findIssuesArray({ result: { issues: [{ word: "جل" }] } }))
      .toEqual([{ word: "جل" }]);
  });

  it("treats an empty array as a real answer", () => {
    expect(findIssuesArray({ issues: [] })).toEqual([]);
  });

  it("rejects an array of unrelated objects", () => {
    expect(findIssuesArray([{ unrelated: 1 }])).toBeNull();
  });
});

describe("parseDialectIssues", () => {
  it("parses the shape the prompt asks for", () => {
    const reply = JSON.stringify({
      issues: [{ line: 3, word: "جل", kind: "msa", severity: "low", note: "فصحى" }],
    });
    expect(parseDialectIssues(reply)).toEqual([
      { line: 3, word: "جل", kind: "msa", severity: "low", note: "فصحى" },
    ]);
  });

  it("distinguishes 'no problems found' from 'could not parse'", () => {
    expect(parseDialectIssues('{"issues": []}')).toEqual([]);
    expect(parseDialectIssues("النص سليم تماماً")).toBeNull();
    expect(parseDialectIssues("")).toBeNull();
  });

  it("recovers the reply that was being discarded: real leaks, imperfect JSON", () => {
    // Prose preamble, trailing comma, Arabic-Indic line numbers, Arabic kind.
    const reply = `راجعت النص وهذه الملاحظات:
{
  "issues": [
    { "line": ٤, "word": "جل", "kind": "فصحى", "severity": "منخفضة", "note": "كلمة فصيحة" },
    { "line": "٧", "word": "تسري", "kind": "msa", "severity": "low", "note": "MSA leak" },
  ]
}`;
    const issues = parseDialectIssues(reply);
    expect(issues).toHaveLength(2);
    expect(issues![0]).toEqual({
      line: 4, word: "جل", kind: "msa", severity: "low", note: "كلمة فصيحة",
    });
    expect(issues![1].line).toBe(7);
    expect(issues![1].word).toBe("تسري");
  });

  it("accepts a bare array instead of the requested wrapper", () => {
    const issues = parseDialectIssues('[{"word":"جل","kind":"msa"}]');
    expect(issues).toHaveLength(1);
    expect(issues![0].word).toBe("جل");
  });

  it("maps Arabic severity labels, defaulting to low", () => {
    const high = parseDialectIssues('{"issues":[{"word":"x","severity":"عالية"}]}');
    expect(high![0].severity).toBe("high");
    const unknown = parseDialectIssues('{"issues":[{"word":"x","severity":"شيء"}]}');
    expect(unknown![0].severity).toBe("low");
    const missing = parseDialectIssues('{"issues":[{"word":"x"}]}');
    expect(missing![0].severity).toBe("low");
  });

  it("keeps an unrecognised kind rather than dropping the issue", () => {
    const issues = parseDialectIssues('{"issues":[{"word":"x","kind":"something_new"}]}');
    expect(issues![0].kind).toBe("something_new");
  });

  it("normalises kind spacing and case", () => {
    const issues = parseDialectIssues('{"issues":[{"word":"x","kind":"Foreign Dialect"}]}');
    expect(issues![0].kind).toBe("foreign_dialect");
  });

  it("pulls a line number out of a prose value", () => {
    const issues = parseDialectIssues('{"issues":[{"line":"السطر 5","word":"x"}]}');
    expect(issues![0].line).toBe(5);
  });

  it("drops objects carrying none of the issue fields", () => {
    const issues = parseDialectIssues('{"issues":[{"word":"جل"},{"irrelevant":1}]}');
    expect(issues).toHaveLength(1);
  });

  it("truncates oversized fields instead of storing them whole", () => {
    const long = "x".repeat(500);
    const issues = parseDialectIssues(
      JSON.stringify({ issues: [{ word: long, note: long }] }),
    );
    expect(issues![0].word!.length).toBe(80);
    expect(issues![0].note!.length).toBe(200);
  });

  it("never throws on hostile input", () => {
    for (const bad of ["{", "[[[", '{"issues":', '{"issues":{}}', "null", "[]"]) {
      expect(() => parseDialectIssues(bad)).not.toThrow();
    }
  });
});
