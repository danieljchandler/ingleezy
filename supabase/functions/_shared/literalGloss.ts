// Canonical definition of the "literal translation" field, shared by every
// translation-emitting edge function so the gloss style stays consistent.

export const LITERAL_GLOSS_RULE = `LITERAL TRANSLATION ("literal" field):
Alongside the natural translation, ALSO provide a close word-for-word English gloss
that preserves the Arabic word order and structure (e.g. "what news-your?" for "شخبارك؟").
It may sound stiff or ungrammatical in English — that is expected. Its purpose is to
show learners how the Arabic sentence is constructed and how each word is used.
Never merge it with the natural translation; keep both fields.`;

export const literalSchema = (what = "line") => ({
  type: "string",
  description:
    `Close word-for-word English gloss of the ${what}, preserving Arabic word order; may sound stiff; reveals sentence structure.`,
});
