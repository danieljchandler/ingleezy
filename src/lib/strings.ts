/**
 * Arabic-first UI strings — the app chrome speaks the learner's language.
 *
 * Deliberately a plain module rather than an i18n library: there is exactly
 * one UI language (Arabic; English is the *studied content*, never the
 * chrome), so a translation framework would be machinery without a job.
 * Strings are written in a neutral, cross-dialect register — the dialect
 * machinery governs generated content, not the chrome.
 *
 * Pages migrate onto this module incrementally; a string belongs here once
 * more than one component needs it or once its page has been flipped.
 */
export const AR = {
  nav: {
    home: "الرئيسية",
    learn: "تعلّم",
    discover: "اكتشف",
    practice: "تدرّب",
    me: "أنا",
  },
} as const;
