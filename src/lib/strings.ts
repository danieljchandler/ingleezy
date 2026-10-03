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

  /**
   * The streak, which every sweep walked past: `StreakDisplay` renders in the
   * header on every screen and was still entirely English ("day streak",
   * "Best", and a hand-rolled `day{s}` plural), as was the streak tooltip in
   * the old home page's welcome panel. Shared, so the strings live here.
   */
  streak: {
    label: "سلسلة",
    best: "الأطول",
    consecutive: "أيام متتالية",
    days: (n: number) =>
      arCount(n, { one: "يوم واحد", two: "يومان", few: "أيام", many: "يوماً" }),
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

  /** The Today screen: greeting, streak, the day's plan, and the way to the tutor. */
  today: {
    greetingMorning: "صباح الخير",
    greetingEvening: "مساء الخير",
    streakAlive: (days: string) => `سلسلة ${days}`,
    streakNone: "ابدأ سلسلتك اليوم",
    lastSevenDays: "آخر سبعة أيام",
    dayDone: "تم",
    dayToday: "اليوم",
    planTitle: "خطة اليوم",
    planProgress: (done: number, total: number) => `${done} من ${total}`,
    next: "التالي",
    start: "ابدأ",
    keepGoing: "كمّل",
    extrasTitle: "إذا عندك وقت",
    planDoneTitle: "خلّصت خطة اليوم",
    planDoneBody: "ارجع بكرة عشان تحافظ على سلسلتك.",
    minutes: (n: number) =>
      arCount(n, { one: "دقيقة", two: "دقيقتين", few: "دقائق", many: "دقيقة" }),
    talkTitle: "تكلّم مع المعلّم",
    talkAll: "كل أدوات الكلام",
    talkAsk: "كيف أقول…؟",
    talkCall: "مكالمة مع المعلّم",
    talkCallBody: "تكلّم 5 دقايق عن يومك، والتصحيح بلهجتك.",
    /** The unit under the streak number. The number is set apart, so the
     *  dual and the 3–10 plural are the only forms that change. */
    streakUnit: (n: number) =>
      n === 2 ? "يومين متواصلين" : n >= 3 && n <= 10 ? "أيام متواصلة" : "يوم متواصل",
    /** The unit under the word-count number. */
    wordsUnit: (n: number) =>
      n === 2 ? "كلمتين في بطاقاتك" : n >= 3 && n <= 10 ? "كلمات في بطاقاتك" : "كلمة في بطاقاتك",
    wordsLabel: "كلماتك",
    /** My Words' header line: how many words are saved. */
    savedWords: (n: number) =>
      n === 0
        ? "ما فيه كلمات محفوظة بعد"
        : arCount(n, { one: "كلمة وحدة محفوظة", two: "كلمتين محفوظتين", few: "كلمات محفوظة", many: "كلمة محفوظة" }),
    /** The unit under My Words' due number. */
    dueUnit: (n: number) =>
      n === 0
        ? "ما فيه كلمات مستحقة الحين"
        : n === 2 ? "كلمتين مستحقتين للمراجعة" : n >= 3 && n <= 10 ? "كلمات مستحقة للمراجعة" : "كلمة مستحقة للمراجعة",
    /** The plan card's line: where the learner is in today's steps. */
    planHeadline: (done: number, total: number) => {
      const steps = (n: number) =>
        arCount(n, { one: "خطوة وحدة", two: "خطوتين", few: "خطوات", many: "خطوة" });
      if (done >= total) return "يومك كامل، أحسنت";
      if (done === 0) return `يومك في ${steps(total)}`;
      return `كمّل، باقي ${steps(total - done)}`;
    },
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
