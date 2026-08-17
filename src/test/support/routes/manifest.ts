/**
 * Every route the app declares, with what should happen when each kind of user
 * asks for it.
 *
 * This is the list `src/test/routeManifest.test.ts` diffs against `App.tsx`, so
 * adding a route without deciding how it is gated fails the build. It is also
 * what `e2e/routes.spec.ts` iterates, which is how ~110 routes get exercised
 * without ~110 hand-written specs.
 */

/**
 * How a route turns an unauthorised visitor away. The mechanisms in this app
 * behave differently enough that a test has to know which is which.
 */
export type Gate =
  /** No guard at all. */
  | "public"
  /** <ProtectedRoute> — redirects to /auth. */
  | "auth"
  /** AdminLayout — admin or recorder only; others are redirected with a toast. */
  | "admin"
  /** AdminLayout — also reachable by a content_reviewer (the rbac.ts allow-list). */
  | "admin-or-reviewer";

export interface RouteSpec {
  path: string;
  /** Concrete values for `:params`, so the sweep can build a real URL. */
  params?: Record<string, string>;
  gate: Gate;
  /** The <ErrorBoundary name> wrapping the element, where there is one. */
  boundary?: string;
  /** Target of a <Navigate>, for redirect-only routes. */
  redirectsTo?: string;
  /**
   * Third-party hosts this route contacts directly from the browser on mount.
   *
   * The request is still blocked — the suite stays hermetic — but it is not
   * treated as a leak. Listing them here is the point: it makes "this page
   * talks to an external API from the client" a visible, reviewed fact rather
   * than something discovered when a test flakes.
   */
  externalHosts?: string[];
  /**
   * Console errors this route is expected to log, as patterns.
   *
   * Narrower than switching the console check off: everything else on the page
   * is still asserted, so a real crash here is still caught.
   */
  expectedConsoleErrors?: RegExp[];
  /**
   * Skip the render sweep, with a reason. Kept deliberately rare — a route
   * nobody loads is a route nobody knows is broken.
   */
  skipRender?: string;
}

const LESSON_ID = "66666666-0000-4000-8000-000000000000";
const TOPIC_ID = "77777777-0000-4000-8000-000000000000";
const WORD_ID = "11111111-0000-4000-8000-000000000000";
const VIDEO_ID = "aaaaaaaa-0000-4000-8000-000000000000";
const STORY_ID = "bbbbbbbb-0000-4000-8000-000000000000";
const EPISODE_ID = "cccccccc-0000-4000-8000-000000000000";
const GENERIC_ID = "12345678-0000-4000-8000-000000000000";

export const ROUTES: RouteSpec[] = [
  // ── Redirects ──────────────────────────────────────────────────────────────
  { path: "/index", gate: "public", redirectsTo: "/" },

  // ── Public shell ───────────────────────────────────────────────────────────
  // "/" is the video feed for a signed-in learner and the landing page for a
  // visitor, so it stays public. The daily dashboard kept its content and moved
  // to /today when the feed took the front door.
  { path: "/", gate: "public", boundary: "HomeRoute" },
  { path: "/today", gate: "public", boundary: "TodayRoute" },
  { path: "/choose", gate: "public", boundary: "ChooseRoute" },
  { path: "/auth", gate: "public", boundary: "AuthRoute" },
  { path: "/reset-password", gate: "public", boundary: "ResetPasswordRoute" },
  { path: "/onboarding", gate: "public", boundary: "OnboardingRoute" },
  { path: "/terms", gate: "public", boundary: "TermsRoute" },
  { path: "/privacy", gate: "public", boundary: "PrivacyRoute" },
  { path: "/pricing", gate: "public", boundary: "PricingRoute" },
  { path: "/learn-hub", gate: "public", redirectsTo: "/choose" },
  { path: "/practice", gate: "public", redirectsTo: "/choose" },
  { path: "/leaderboard", gate: "public", boundary: "LeaderboardRoute" },

  // ── Curriculum ─────────────────────────────────────────────────────────────
  { path: "/curriculum", gate: "public", boundary: "CurriculumRoute" },
  { path: "/learn", gate: "public", boundary: "LearnRoute" },
  { path: "/learn/:lessonId", params: { lessonId: LESSON_ID }, gate: "public", boundary: "LearnLessonRoute" },
  { path: "/quiz/:lessonId", params: { lessonId: LESSON_ID }, gate: "public", boundary: "QuizRoute" },
  { path: "/placement", gate: "public", boundary: "PlacementQuizRoute" },
  { path: "/grammar", gate: "public", boundary: "GrammarRoute" },

  // ── English Sounds ────────────────────────────────────────────────────────
  { path: "/sounds", gate: "public", boundary: "EnglishSoundsRoute" },
  { path: "/sounds/:soundCode", params: { soundCode: "p" }, gate: "public", boundary: "EnglishSoundRoute" },
  { path: "/sounds/checkpoint/:index", params: { index: "0" }, gate: "auth", boundary: "SoundsCheckpointRoute" },

  // ── Review and saved decks ─────────────────────────────────────────────────
  { path: "/review", gate: "auth", boundary: "ReviewRoute" },
  { path: "/review/my-words", gate: "auth", boundary: "MyWordsReviewRoute" },
  { path: "/review/my-phrases", gate: "auth", boundary: "MyPhrasesReviewRoute" },
  { path: "/my-words", gate: "auth", boundary: "MyWordsRoute" },
  { path: "/mistakes", gate: "auth", boundary: "MistakesRoute" },
  { path: "/analytics", gate: "auth", boundary: "AnalyticsRoute" },

  // ── Set phrases ────────────────────────────────────────────────────────────
  { path: "/set-phrases", gate: "public", boundary: "SetPhrasesRoute" },
  { path: "/set-phrases/practice", gate: "public", boundary: "SetPhrasesPracticeRoute" },
  { path: "/set-phrases/review", gate: "public", boundary: "SetPhrasesReviewRoute" },

  // ── Discover ───────────────────────────────────────────────────────────────
  { path: "/discover", gate: "public", boundary: "DiscoverRoute" },
  { path: "/discover/:videoId", params: { videoId: VIDEO_ID }, gate: "public", boundary: "DiscoverVideoRoute" },
  { path: "/liked-videos", gate: "auth", boundary: "LikedVideosRoute" },

  // ── Stories, reading, listening ────────────────────────────────────────────
  { path: "/stories", gate: "public", boundary: "StoriesRoute" },
  { path: "/stories/:storyId", params: { storyId: STORY_ID }, gate: "public", boundary: "StoryPlayerRoute" },
  { path: "/today/story", gate: "auth", boundary: "DailyStoryRoute" },
  { path: "/reading", gate: "public", boundary: "ReadingRoute" },
  { path: "/reading-library", gate: "public", boundary: "ReadingLibraryRoute" },
  { path: "/reading-library/:id", params: { id: STORY_ID }, gate: "public", boundary: "ReadingLibraryStoryRoute" },
  { path: "/listen", gate: "auth", boundary: "ListenRoute" },
  { path: "/listen/:id", params: { id: EPISODE_ID }, gate: "auth", boundary: "ListenEpisodeRoute" },
  { path: "/souq-news", gate: "public", boundary: "SouqNewsRoute" },

  // ── Practice tools ─────────────────────────────────────────────────────────
  { path: "/pronunciation", gate: "public", boundary: "PronunciationRoute" },
  // Loads its credit balance on mount; the default native-feedback stub in
  // src/test/support/server/functions.ts answers it.
  { path: "/native-feedback", gate: "auth", boundary: "NativeFeedbackRoute" },
  // Fetches a writing prompt on mount; the default writing-coach stub in
  // src/test/support/server/functions.ts answers it.
  { path: "/write", gate: "auth", boundary: "WritingPracticeRoute" },
  {
    path: "/conversation",
    gate: "public",
    boundary: "ConversationRoute",
    // The live-voice panel opens a WebRTC session on mount and POSTs the offer
    // straight to OpenAI from the browser (src/hooks/useOpenAIRealtime.ts). It
    // catches its own failure and the page still renders, so the sweep records
    // the behaviour rather than treating it as a crash.
    externalHosts: ["api.openai.com"],
    expectedConsoleErrors: [/\[realtime\] start error/],
  },
  { path: "/listening", gate: "public", boundary: "ListeningRoute" },
  { path: "/daily-challenge", gate: "public", boundary: "DailyChallengeRoute" },
  { path: "/vocab-games", gate: "public", boundary: "VocabGamesRoute" },
  { path: "/battles", gate: "auth", boundary: "VocabBattlesRoute" },
  { path: "/battles/:battleId", params: { battleId: GENERIC_ID }, gate: "auth", boundary: "BattlePlayRoute" },

  // ── AI helpers ─────────────────────────────────────────────────────────────
  { path: "/translate", gate: "auth", boundary: "TranslateRoute" },
  { path: "/translate/saved", gate: "auth", boundary: "SavedTranslationsRoute" },
  { path: "/saved-chats", gate: "auth", boundary: "SavedChatsRoute" },
  { path: "/how-do-i-say", gate: "public", boundary: "HowDoISayRoute" },
  { path: "/culture-guide", gate: "public", boundary: "CultureGuideRoute" },
  { path: "/meme", gate: "public", boundary: "MemeAnalyzerRoute" },
  { path: "/learn-from-x", gate: "public", boundary: "LearnFromXRoute" },

  // ── Transcription ──────────────────────────────────────────────────────────
  { path: "/transcribe", gate: "auth", boundary: "TranscribeRoute" },
  { path: "/my-transcriptions", gate: "auth", boundary: "MyTranscriptionsRoute" },
  { path: "/tutor-upload", gate: "auth", boundary: "TutorUploadRoute" },

  // ── Account ────────────────────────────────────────────────────────────────
  { path: "/me", gate: "auth", boundary: "MeHubRoute" },
  { path: "/profile", gate: "auth", boundary: "ProfileRoute" },
  { path: "/settings", gate: "auth", boundary: "SettingsRoute" },
  { path: "/friends", gate: "auth", boundary: "FriendsRoute" },

  // ── Admin ──────────────────────────────────────────────────────────────────
  { path: "/admin/login", gate: "public", boundary: "AdminLoginRoute" },
  { path: "/admin", gate: "admin-or-reviewer", boundary: "AdminRoute" },
  { path: "/admin/videos", gate: "admin-or-reviewer" },
  { path: "/admin/videos/new", gate: "admin-or-reviewer" },
  { path: "/admin/videos/:videoId/edit", params: { videoId: VIDEO_ID }, gate: "admin-or-reviewer" },
  { path: "/admin/set-phrases", gate: "admin-or-reviewer" },
  { path: "/admin/dialect-rules", gate: "admin-or-reviewer" },
  { path: "/admin/interference-rules", gate: "admin-or-reviewer" },

  { path: "/admin/curriculum", gate: "admin" },
  { path: "/admin/lessons/import", gate: "admin" },
  { path: "/admin/lessons/:lessonId/words", params: { lessonId: LESSON_ID }, gate: "admin" },
  { path: "/admin/topics", gate: "admin" },
  { path: "/admin/topics/new", gate: "admin" },
  { path: "/admin/topics/:topicId/edit", params: { topicId: TOPIC_ID }, gate: "admin" },
  { path: "/admin/topics/:topicId/words", params: { topicId: TOPIC_ID }, gate: "admin" },
  { path: "/admin/topics/:topicId/words/new", params: { topicId: TOPIC_ID }, gate: "admin" },
  {
    path: "/admin/topics/:topicId/words/:wordId/edit",
    params: { topicId: TOPIC_ID, wordId: WORD_ID },
    gate: "admin",
  },
  { path: "/admin/topics/:topicId/words/bulk", params: { topicId: TOPIC_ID }, gate: "admin" },
  { path: "/admin/curriculum-builder", gate: "admin" },
  { path: "/admin/curriculum-builder/:sessionId", params: { sessionId: GENERIC_ID }, gate: "admin" },
  { path: "/admin/stories", gate: "admin" },
  { path: "/admin/stories/new", gate: "admin" },
  { path: "/admin/stories/:storyId/edit", params: { storyId: STORY_ID }, gate: "admin" },
  { path: "/admin/trending", gate: "admin" },
  { path: "/admin/coverage", gate: "admin" },
  { path: "/admin/memes", gate: "admin" },
  { path: "/admin/memes/new", gate: "admin" },
  { path: "/admin/memes/:memeId", params: { memeId: GENERIC_ID }, gate: "admin" },
  { path: "/admin/invite-codes", gate: "admin" },
  { path: "/admin/errors", gate: "admin" },
  { path: "/admin/metrics", gate: "admin" },
  { path: "/admin/feedback", gate: "admin" },
  { path: "/admin/reading-library", gate: "admin" },
  { path: "/admin/reading-library/new", gate: "admin" },
  { path: "/admin/reading-library/:id/edit", params: { id: STORY_ID }, gate: "admin" },

  // ── Catch-all ──────────────────────────────────────────────────────────────
  { path: "*", gate: "public" },
];

/** Substitute `:params` to get a URL the browser can actually visit. */
export function concreteUrl(route: RouteSpec): string {
  if (route.path === "*") return "/a-path-that-does-not-exist";

  return route.path.replace(/:([A-Za-z0-9_]+)/g, (match, name: string) => {
    const value = route.params?.[name];
    if (value === undefined) {
      throw new Error(
        `Route ${route.path} has no sample value for :${name}. ` +
          `Add one to its \`params\` in src/test/support/routes/manifest.ts.`,
      );
    }
    return value;
  });
}

export const byPath = new Map(ROUTES.map((route) => [route.path, route]));
