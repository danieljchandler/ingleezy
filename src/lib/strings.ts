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

/**
 * Arabic count phrase. Arabic number agreement is not "1 vs many": one and
 * two have their own forms, 3-10 takes the plural, and 11+ takes the
 * singular again. Latin digits on purpose — that is how counts are commonly
 * written in the region, and the UI interpolates JS numbers.
 */
export function arCount(
  n: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

export const AR = {
  nav: {
    home: "الرئيسية",
    learn: "تعلّم",
    discover: "اكتشف",
    practice: "تدرّب",
    me: "أنا",
  },

  common: {
    save: "حفظ",
    login: "تسجيل الدخول",
    signOut: "تسجيل الخروج",
    profile: "الملف الشخصي",
    settings: "الإعدادات",
    admin: "الإدارة",
  },

  home: {
    today: "اليوم",
    queueHintTitle: "مهامك اليومية",
    queueHintBody:
      "كل ما يقترحه إنجليزي عليك اليوم — مراجعات، تحدي، استماع، قراءة وأكثر. أنجزها لتحقق هدفك وتنمّي سلسلتك.",
    tasksDone: (done: number, total: number) => `أنجزت ${done} من ${total} مهام`,
    dailyGoal: "الهدف اليومي",
    dailyGoalXpLabel: "هدف النقاط اليومي",
    allCaughtUpTitle: "أنجزت كل المهام!",
    allCaughtUpBody: "لا مهام مستحقة اليوم — جرّب شيئاً جديداً بالأسفل.",
    goalCompleteTitle: "أكملت هدف اليوم",
    goalCompleteBody: "عد غداً للحفاظ على سلسلتك.",
    cardsDue: (n: number) =>
      arCount(n, {
        one: "بطاقة واحدة مستحقة للمراجعة",
        two: "بطاقتان مستحقتان للمراجعة",
        few: "بطاقات مستحقة للمراجعة",
        many: "بطاقة مستحقة للمراجعة",
      }),
    reviewNow: "راجع الآن",
    placementTitle: "اختبار تحديد المستوى",
    placementBody:
      "جاوب على 20 سؤالاً تكيفياً حتى نضبط الدروس والمفردات والتمارين على مستواك بدقة.",
    placementMinutes: "~5 دقائق",
  },

  queue: {
    reviewWords: (n: number) =>
      `راجع ${arCount(n, { one: "كلمة واحدة", two: "كلمتين", few: "كلمات", many: "كلمة" })}`,
    flashcardsDone: "أنجزت مراجعة البطاقات",
    srs: "تكرار متباعد",
    dailyChallenge: "تحدي اليوم",
    streakMultiplier: "مضاعف السلسلة",
    todaysStory: "قصة اليوم",
    builtFromYourWords: "مبنية من كلماتك",
    readPassage: "اقرأ نصاً قصيراً",
    readingPractice: "تدريب القراءة",
    watchVideo: "شاهد فيديو اليوم",
    discover: "اكتشف",
    souqArticle: "مقال من أخبار السوق",
    newsInEnglish: "أخبار بالإنجليزي",
    practicePhrases: (n: number) =>
      `تدرّب على ${arCount(n, { one: "عبارة واحدة", two: "عبارتين", few: "عبارات", many: "عبارة" })}`,
    phrasesDone: "أنجزت مراجعة العبارات",
    everydayExpressions: "عبارات يومية",
    watched: "شاهدته",
    videoHintTitle: "فيديو اليوم",
    videoHintBody:
      "فيديو حقيقي بترجمة متزامنة — اضغط أي كلمة لتتعلمها وتحفظها للمراجعة. اختيار جديد كل يوم.",
    taskAria: (done: boolean, title: string, minutes: number) =>
      `${done ? "مكتملة: " : ""}${title} — تقريباً ${minutes} دقائق`,
  },

  taskHints: {
    flashcards: {
      title: "مراجعة البطاقات",
      body: "نعرض لك فقط الكلمات التي أوشك عقلك على نسيانها — ضغطات سريعة الآن تعني ذاكرة طويلة الأمد.",
    },
    "daily-challenge": {
      title: "تحدي اليوم",
      body: "مهمة قصيرة جديدة كل يوم. أنجزها لتشعل مضاعف سلسلتك وتكسب نقاطاً إضافية.",
    },
    reading: {
      title: "تدريب القراءة",
      body: "نصوص قصيرة بالإنجليزي مع ترجمة بالضغط. ابنِ فهمك دون الحاجة إلى قاموس.",
    },
    "daily-story": {
      title: "قصة اليوم",
      body: "قصة قصيرة جديدة (~200 كلمة) مبنية على كلمات تعرفها مع القليل من الجديد. اضغط أي كلمة لمعناها فوراً.",
    },
    souq: {
      title: "أخبار السوق",
      body: "أخبار اليوم من منطقتك محكية بإنجليزي سهل — أحداث تعرفها بلغة تتعلمها.",
    },
    "set-phrases": {
      title: "العبارات الجاهزة",
      body: "التحيات والمجاملات والمواقف اليومية — العبارات التي يقولها الناطقون بالإنجليزي تلقائياً. اختبر نفسك صوتياً.",
    },
  },
} as const;
