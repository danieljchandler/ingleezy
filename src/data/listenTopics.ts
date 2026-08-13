// Curated topic catalog for Listen. Each category has prompt seeds; users can
// always type their own. A handful of categories are culturally-loaded
// (Culture, History, Food, Sports) and get dialect-specific topic seeds so
// Egyptian and Yemeni learners aren't only offered Gulf-flavored prompts;
// the rest (Tech, Psychology, Science, Business, Ideas) are dialect-neutral
// and shared across all three.

export interface TopicCategory {
  id: string;
  label: string;
  emoji: string;
  topics: string[];
}

type ListenDialect = "Gulf" | "Egyptian" | "Yemeni";

const CULTURE_TOPICS: Record<ListenDialect, string[]> = {
  Gulf: [
    "The dying art of pearl diving in the Gulf",
    "Why hospitality means everything in our culture",
    "How weddings have changed in one generation",
    "The story behind a beloved local dish",
    "Why coffee is more than a drink",
  ],
  Egyptian: [
    "Why ahwa (coffee shop) culture defines Cairo mornings",
    "Why hospitality means everything in our culture",
    "How Egyptian weddings blend old and new",
    "The story behind koshari, Egypt's national dish",
    "The enduring magic of Egyptian cinema",
  ],
  Yemeni: [
    "The daily ritual of the qat gathering (maqyal)",
    "Why hospitality means everything in our culture",
    "How Yemeni weddings have changed in one generation",
    "The story behind saltah, Yemen's national dish",
    "Why the jambiya dagger still matters today",
  ],
};

const HISTORY_TOPICS: Record<ListenDialect, string[]> = {
  Gulf: [
    "How the spice trade shaped our cities",
    "The lost kingdom of Saba",
    "Why old Sanaa looks like nowhere else on earth",
    "The forgotten women rulers of Arabia",
    "How one map changed the Middle East",
  ],
  Egyptian: [
    "How the Nile shaped every Egyptian city",
    "The forgotten women rulers of ancient Egypt",
    "Why old Cairo looks like nowhere else on earth",
    "How the pyramids were really built",
    "The lost library of Alexandria",
  ],
  Yemeni: [
    "The lost kingdom of Saba",
    "Why old Sanaa looks like nowhere else on earth",
    "How the spice and incense trade shaped Yemen",
    "The forgotten queens of Arabia",
    "How one map changed the Middle East",
  ],
};

const FOOD_TOPICS: Record<ListenDialect, string[]> = {
  Gulf: [
    "A perfect day in old Cairo",
    "Why mansaf is more than a meal",
    "The street food capitals of the Arab world",
    "How spices traveled the silk road",
    "Why everyone is moving to Riyadh",
  ],
  Egyptian: [
    "A perfect day in old Cairo",
    "Why koshari became a national obsession",
    "The street food capitals of Egypt",
    "How a Nile felucca trip became a tradition",
    "Why molokhia divides Egyptian dinner tables",
  ],
  Yemeni: [
    "Why saltah is more than a meal",
    "A perfect day in old Sanaa",
    "How Yemeni coffee (bunn) conquered the world first",
    "The street food of Aden",
    "Why mandi is made for sharing",
  ],
};

const SPORTS_TOPICS: Record<ListenDialect, string[]> = {
  Gulf: [
    "Why football unites a country like nothing else",
    "The science of falconry training",
    "How camel racing went high-tech",
    "What it really takes to climb Everest",
    "The rise of women's sports in the region",
  ],
  Egyptian: [
    "Why football unites a country like nothing else",
    "The legendary rivalry of Al Ahly and Zamalek",
    "How squash became an Egyptian specialty",
    "What it really takes to climb Everest",
    "The rise of women's sports in the region",
  ],
  Yemeni: [
    "Why football unites a country like nothing else",
    "The tradition of Yemeni horse racing",
    "How mountain trekking shaped Yemeni endurance",
    "What it really takes to climb Everest",
    "The rise of women's sports in the region",
  ],
};

// Dialect-neutral — shared across all three.
const SHARED_TOPICS: Record<string, { label: string; emoji: string; topics: string[] }> = {
  tech: {
    label: "Tech & Future",
    emoji: "🚀",
    topics: [
      "How AI is changing the way we learn languages",
      "Why everyone is suddenly building apps",
      "The dark side of social media addiction",
      "Will robots replace your barista?",
      "How TikTok reshaped Arabic music",
    ],
  },
  psychology: {
    label: "Mind & Psychology",
    emoji: "🧠",
    topics: [
      "Why we procrastinate even when it hurts us",
      "The science of habits that actually stick",
      "How to spot a manipulator in conversation",
      "Why nostalgia feels so good",
      "What loneliness really does to your brain",
    ],
  },
  science: {
    label: "Science",
    emoji: "🔬",
    topics: [
      "Why the desert holds the secret to better farming",
      "How sleep cleans your brain at night",
      "What a black hole would do to you",
      "The strange biology of camels",
      "Why some people never seem to age",
    ],
  },
  business: {
    label: "Business & Money",
    emoji: "💼",
    topics: [
      "How a tea stall became a global brand",
      "Why most startups fail in year two",
      "The hidden economics of a souq",
      "What young entrepreneurs get wrong",
      "How oil changed everything — and what comes next",
    ],
  },
  ideas: {
    label: "Big Ideas",
    emoji: "💡",
    topics: [
      "Does free will really exist?",
      "Why we tell ourselves stories",
      "The hidden power of small daily rituals",
      "Why boredom might be a superpower",
      "What we mean when we say 'home'",
    ],
  },
};

function categoriesFor(dialect: ListenDialect): TopicCategory[] {
  return [
    { id: "culture", label: "Culture & Identity", emoji: "🕌", topics: CULTURE_TOPICS[dialect] },
    { id: "history", label: "History", emoji: "📜", topics: HISTORY_TOPICS[dialect] },
    { id: "tech", ...SHARED_TOPICS.tech },
    { id: "psychology", ...SHARED_TOPICS.psychology },
    { id: "science", ...SHARED_TOPICS.science },
    { id: "business", ...SHARED_TOPICS.business },
    { id: "sports", label: "Sports", emoji: "⚽", topics: SPORTS_TOPICS[dialect] },
    { id: "food", label: "Food & Travel", emoji: "🍽️", topics: FOOD_TOPICS[dialect] },
    { id: "ideas", ...SHARED_TOPICS.ideas },
  ];
}

export function getTopicCategories(dialect?: string): TopicCategory[] {
  const d: ListenDialect = dialect === "Egyptian" || dialect === "Yemeni" ? dialect : "Gulf";
  return categoriesFor(d);
}

/** @deprecated Use getTopicCategories(dialect) instead — this is the Gulf list. */
export const TOPIC_CATEGORIES: TopicCategory[] = categoriesFor("Gulf");
