import { useEffect, lazy, Suspense, type ComponentType } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DialectProvider } from "@/contexts/DialectContext";
import { AiAssistantProvider } from "@/contexts/AiAssistantContext";
import { AssistantMount } from "@/components/assistant/AssistantMount";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { lazyRetry } from "@/lib/lazyRetry";
import { PageSkeleton } from "@/components/ui/skeleton-page";
import { logClientError } from "@/lib/errorLog";

// ─── Lazy-loaded page components ─────────────────────────────────────────────
// Each page is loaded on-demand so the initial bundle stays small.
const lazyPage = <T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) =>
  lazy(lazyRetry(loader));

const Feed = lazyPage(() => import("./pages/Feed"));
const Choose = lazyPage(() => import("./pages/Choose"));
// The old dashboard home. Kept routable at /today for now: it still carries
// the daily queue and streak, which the feed does not replace yet.
const Index = lazyPage(() => import("./pages/Index"));
const Learn = lazyPage(() => import("./pages/Learn"));
const LearnHub = lazyPage(() => import("./pages/LearnHub"));
const Curriculum = lazyPage(() => import("./pages/Curriculum"));
const Mistakes = lazyPage(() => import("./pages/Mistakes"));
const PracticeHub = lazyPage(() => import("./pages/PracticeHub"));
const MeHub = lazyPage(() => import("./pages/MeHub"));
const NotFound = lazyPage(() => import("./pages/NotFound"));

const Quiz = lazyPage(() => import("./pages/Quiz"));
const Auth = lazyPage(() => import("./pages/Auth"));
const ResetPassword = lazyPage(() => import("./pages/ResetPassword"));
const Review = lazyPage(() => import("./pages/Review"));
const Transcribe = lazyPage(() => import("./pages/Transcribe"));
const Translate = lazyPage(() => import("./pages/Translate"));
const SavedTranslations = lazyPage(() => import("./pages/SavedTranslations"));
const SavedChats = lazyPage(() => import("./pages/SavedChats"));
const MyWords = lazyPage(() => import("./pages/MyWords"));
const TutorUpload = lazyPage(() => import("./pages/TutorUpload"));
const MyWordsReview = lazyPage(() => import("./pages/MyWordsReview"));
const MyPhrasesReview = lazyPage(() => import("./pages/MyPhrasesReview"));
const MemeAnalyzer = lazyPage(() => import("./pages/MemeAnalyzer"));
const Discover = lazyPage(() => import("./pages/Discover"));
const DiscoverVideo = lazyPage(() => import("./pages/DiscoverVideo"));
const LearnFromX = lazyPage(() => import("./pages/LearnFromX"));
const HowDoISay = lazyPage(() => import("./pages/HowDoISay"));
const CultureGuide = lazyPage(() => import("./pages/CultureGuide"));
const Pricing = lazyPage(() => import("./pages/Pricing"));
const PronunciationPractice = lazyPage(() => import("./pages/PronunciationPractice"));
const NativeFeedback = lazyPage(() => import("./pages/NativeFeedback"));
const WritingPractice = lazyPage(() => import("./pages/WritingPractice"));
const ConversationSimulator = lazyPage(() => import("./pages/ConversationSimulator"));
const ListeningPractice = lazyPage(() => import("./pages/ListeningPractice"));
const Leaderboard = lazyPage(() => import("./pages/Leaderboard"));
const ReadingPractice = lazyPage(() => import("./pages/ReadingPractice"));
const DailyChallenge = lazyPage(() => import("./pages/DailyChallenge"));
const LearningAnalytics = lazyPage(() => import("./pages/LearningAnalytics"));
const GrammarDrills = lazyPage(() => import("./pages/GrammarDrills"));
const VocabGames = lazyPage(() => import("./pages/VocabGames"));
const Onboarding = lazyPage(() => import("./pages/Onboarding"));
const Settings = lazyPage(() => import("./pages/Settings"));
const Profile = lazyPage(() => import("./pages/Profile"));
const Friends = lazyPage(() => import("./pages/Friends"));
const LikedVideos = lazyPage(() => import("./pages/LikedVideos"));
const Stories = lazyPage(() => import("./pages/Stories"));
const DailyStory = lazyPage(() => import("./pages/DailyStory"));
const StoryPlayer = lazyPage(() => import("./pages/StoryPlayer"));
const VocabBattles = lazyPage(() => import("./pages/VocabBattles"));
const BattlePlay = lazyPage(() => import("./pages/BattlePlay"));
const PlacementQuiz = lazyPage(() => import("./pages/PlacementQuiz"));
const SouqNews = lazyPage(() => import("./pages/SouqNews"));
const MyTranscriptions = lazyPage(() => import("./pages/MyTranscriptions"));
const EnglishSounds = lazyPage(() => import("./pages/EnglishSounds"));
const EnglishSound = lazyPage(() => import("./pages/EnglishSound"));
const SoundsCheckpoint = lazyPage(() => import("./pages/SoundsCheckpoint"));
const Listen = lazyPage(() => import("./pages/Listen"));
const ListenEpisode = lazyPage(() => import("./pages/ListenEpisode"));
const Terms = lazyPage(() => import("./pages/Terms"));
const Privacy = lazyPage(() => import("./pages/Privacy"));
const AdminErrors = lazyPage(() => import("./pages/admin/AdminErrors"));
const AdminFeatureMetrics = lazyPage(() => import("./pages/admin/AdminFeatureMetrics"));

// Admin pages
const AdminLayout = lazyPage(() => import("./pages/admin/AdminLayout"));
const AdminLogin = lazyPage(() => import("./pages/admin/AdminLogin"));
const Dashboard = lazyPage(() => import("./pages/admin/Dashboard"));
const Topics = lazyPage(() => import("./pages/admin/Topics"));
const TopicForm = lazyPage(() => import("./pages/admin/TopicForm"));
const Words = lazyPage(() => import("./pages/admin/Words"));
const WordForm = lazyPage(() => import("./pages/admin/WordForm"));
const BulkWordImport = lazyPage(() => import("./pages/admin/BulkWordImport"));
const AdminVideos = lazyPage(() => import("./pages/admin/AdminVideos"));
const AdminVideoForm = lazyPage(() => import("./pages/admin/AdminVideoForm"));
const Stages = lazyPage(() => import("./pages/admin/Stages"));
const LessonWords = lazyPage(() => import("./pages/admin/LessonWords"));
const LessonImport = lazyPage(() => import("./pages/admin/LessonImport"));
const CurriculumBuilder = lazyPage(() => import("./pages/admin/CurriculumBuilder"));
const AdminStories = lazyPage(() => import("./pages/admin/AdminStories"));
const AdminStoryForm = lazyPage(() => import("./pages/admin/AdminStoryForm"));
const TrendingVideos = lazyPage(() => import("./pages/admin/TrendingVideos"));
const AdminMemes = lazyPage(() => import("./pages/admin/AdminMemes"));
const AdminMemeForm = lazyPage(() => import("./pages/admin/AdminMemeForm"));
const AdminCoverage = lazyPage(() => import("./pages/admin/AdminCoverage"));
const AdminSetPhrases = lazyPage(() => import("./pages/admin/AdminSetPhrases"));
const AdminDialectRules = lazyPage(() => import("./pages/admin/AdminDialectRules"));
const AdminInterferenceRules = lazyPage(() => import("./pages/admin/AdminInterferenceRules"));
const AdminInviteCodes = lazyPage(() => import("./pages/admin/AdminInviteCodes"));
const AdminFeedback = lazyPage(() => import("./pages/admin/AdminFeedback"));
const AdminReadingLibrary = lazyPage(() => import("./pages/admin/AdminReadingLibrary"));
const AdminReadingLibraryForm = lazyPage(() => import("./pages/admin/AdminReadingLibraryForm"));
const SetPhrases = lazyPage(() => import("./pages/SetPhrases"));
const SetPhrasesPractice = lazyPage(() => import("./pages/SetPhrasesPractice"));
const SetPhrasesReview = lazyPage(() => import("./pages/SetPhrasesReview"));
const ReadingLibrary = lazyPage(() => import("./pages/ReadingLibrary"));
const ReadingLibraryStory = lazyPage(() => import("./pages/ReadingLibraryStory"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — avoid redundant refetches on navigation
      gcTime: 5 * 60_000, // 5 min garbage collection
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => {
  useEffect(() => {
    const CRASH_KEY = "__app_last_crash";

    const persistCrash = (payload: unknown) => {
      try {
        sessionStorage.setItem(
          CRASH_KEY,
          JSON.stringify({ at: new Date().toISOString(), url: window.location.href, payload }),
        );
      } catch {
        // ignore
      }
    };

    // If the runtime hard-reloaded due to an error, surface the reason after boot.
    try {
      const raw = sessionStorage.getItem(CRASH_KEY);
      if (raw) {
        sessionStorage.removeItem(CRASH_KEY);
        const parsed = JSON.parse(raw) as { at?: string; url?: string; payload?: unknown };
        const msg =
          parsed?.payload instanceof Error
            ? parsed.payload.message
            : typeof parsed?.payload === "string"
              ? parsed.payload
              : "";

        toast.error("التطبيق وقف فجأة قبل شوي", {
          description: msg || "سجّلنا التفاصيل في الكونسول. جرّب مرة ثانية.",
        });
        console.error("Recovered last crash:", parsed);
      }
    } catch (e) {
      console.error("Failed to restore last crash:", e);
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled promise rejection:", event.reason);
      persistCrash(event.reason);
      void logClientError({
        message: event.reason instanceof Error ? event.reason.message : String(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack ?? null : null,
        meta: { kind: "unhandledrejection" },
      });
      toast.error("صار خطأ ما توقعناه", {
        description: "جرّب مرة ثانية. لو تكرّر، خبّرنا وش كنت تسوي.",
      });
      // Prevent browser/dev overlay from treating it as fatal.
      event.preventDefault();
    };

    const onError = (event: ErrorEvent) => {
      // Resource load failures (img/script/link) bubble here in capture phase
      // with no .error and no .message. Those are not real script errors and
      // must not trigger the crash toast / persisted-crash banner.
      if (event.target && event.target !== window && !(event.error || event.message)) {
        return;
      }
      if (!event.error && !event.message) {
        return;
      }
      console.error("Global error:", event.error ?? event.message);
      persistCrash(event.error ?? event.message);
      void logClientError({
        message: event.error?.message ?? event.message ?? "Unknown error",
        stack: event.error?.stack ?? null,
        meta: { kind: "window.error", filename: event.filename, lineno: event.lineno },
      });
      // Don't spam toasts for every error; but make crashes visible.
      toast.error("صار خطأ في الصفحة", {
        description: "سجّلنا الخطأ في الكونسول. جرّب مرة ثانية.",
      });

      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError, true);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError, true);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <DialectProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <AiAssistantProvider>
          <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* Public learning app */}
            {/* Home is the feed: the app opens on content, not on a checklist.
                The chooser sits one sideways swipe away — see useSwipeSurfaces
                for why "forward" is leftward in an RTL app. */}
            <Route path="/" element={<ErrorBoundary name="HomeRoute"><Feed /></ErrorBoundary>} />
            <Route path="/choose" element={<ErrorBoundary name="ChooseRoute"><Choose /></ErrorBoundary>} />
            <Route path="/index" element={<Navigate to="/" replace />} />
            {/* The daily queue keeps its own address while the feed takes over
                the front door. */}
            <Route path="/today" element={<ErrorBoundary name="TodayRoute"><Index /></ErrorBoundary>} />
            <Route path="/auth" element={<ErrorBoundary name="AuthRoute"><Auth /></ErrorBoundary>} />
            <Route path="/reset-password" element={<ErrorBoundary name="ResetPasswordRoute"><ResetPassword /></ErrorBoundary>} />
            <Route path="/learn-hub" element={<ErrorBoundary name="LearnHubRoute"><LearnHub /></ErrorBoundary>} />
            <Route path="/practice" element={<ErrorBoundary name="PracticeHubRoute"><PracticeHub /></ErrorBoundary>} />
            <Route path="/me" element={<ErrorBoundary name="MeHubRoute"><ProtectedRoute><MeHub /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/review" element={<ErrorBoundary name="ReviewRoute"><ProtectedRoute><Review /></ProtectedRoute></ErrorBoundary>} />

            <Route
              path="/transcribe"
              element={
                <ErrorBoundary name="TranscribeRoute">
                  <ProtectedRoute><Transcribe /></ProtectedRoute>
                </ErrorBoundary>
              }
            />
            <Route path="/my-words" element={<ErrorBoundary name="MyWordsRoute"><ProtectedRoute><MyWords /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/translate" element={<ErrorBoundary name="TranslateRoute"><ProtectedRoute><Translate /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/translate/saved" element={<ErrorBoundary name="SavedTranslationsRoute"><ProtectedRoute><SavedTranslations /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/saved-chats" element={<ErrorBoundary name="SavedChatsRoute"><ProtectedRoute><SavedChats /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/review/my-words" element={<ErrorBoundary name="MyWordsReviewRoute"><ProtectedRoute><MyWordsReview /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/review/my-phrases" element={<ErrorBoundary name="MyPhrasesReviewRoute"><ProtectedRoute><MyPhrasesReview /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/tutor-upload" element={<ErrorBoundary name="TutorUploadRoute"><ProtectedRoute><TutorUpload /></ProtectedRoute></ErrorBoundary>} />
            <Route path="/meme" element={
              <ErrorBoundary name="MemeAnalyzerRoute">
                <MemeAnalyzer />
              </ErrorBoundary>
            } />
            <Route path="/curriculum" element={<ErrorBoundary name="CurriculumRoute"><Curriculum /></ErrorBoundary>} />
            <Route path="/learn" element={<ErrorBoundary name="LearnRoute"><Learn /></ErrorBoundary>} />
            <Route path="/learn/:lessonId" element={<ErrorBoundary name="LearnLessonRoute"><Learn /></ErrorBoundary>} />
            <Route path="/quiz/:lessonId" element={<ErrorBoundary name="QuizRoute"><Quiz /></ErrorBoundary>} />
            <Route path="/discover" element={<ErrorBoundary name="DiscoverRoute"><Discover /></ErrorBoundary>} />
            <Route path="/discover/:videoId" element={<ErrorBoundary name="DiscoverVideoRoute"><DiscoverVideo /></ErrorBoundary>} />
            <Route path="/learn-from-x" element={
              <ErrorBoundary name="LearnFromXRoute">
                <LearnFromX />
              </ErrorBoundary>
            } />
            <Route path="/how-do-i-say" element={
              <ErrorBoundary name="HowDoISayRoute">
                <HowDoISay />
              </ErrorBoundary>
            } />
            <Route path="/culture-guide" element={
              <ErrorBoundary name="CultureGuideRoute">
                <CultureGuide />
              </ErrorBoundary>
            } />
            <Route path="/pricing" element={
              <ErrorBoundary name="PricingRoute">
                <Pricing />
              </ErrorBoundary>
            } />
            <Route path="/pronunciation" element={
              <ErrorBoundary name="PronunciationRoute">
                <PronunciationPractice />
              </ErrorBoundary>
            } />
            <Route path="/native-feedback" element={
              <ErrorBoundary name="NativeFeedbackRoute">
                <ProtectedRoute><NativeFeedback /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/write" element={
              <ErrorBoundary name="WritingPracticeRoute">
                <ProtectedRoute><WritingPractice /></ProtectedRoute>
              </ErrorBoundary>
            } />

            <Route path="/conversation" element={
              <ErrorBoundary name="ConversationRoute">
                <ConversationSimulator />
              </ErrorBoundary>
            } />
            <Route path="/listening" element={
              <ErrorBoundary name="ListeningRoute">
                <ListeningPractice />
              </ErrorBoundary>
            } />
            <Route path="/leaderboard" element={
              <ErrorBoundary name="LeaderboardRoute">
                <Leaderboard />
              </ErrorBoundary>
            } />
            <Route path="/reading" element={
              <ErrorBoundary name="ReadingRoute">
                <ReadingPractice />
              </ErrorBoundary>
            } />
            <Route path="/listen" element={
              <ErrorBoundary name="ListenRoute">
                <ProtectedRoute><Listen /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/listen/:id" element={
              <ErrorBoundary name="ListenEpisodeRoute">
                <ProtectedRoute><ListenEpisode /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/daily-challenge" element={
              <ErrorBoundary name="DailyChallengeRoute">
                <DailyChallenge />
              </ErrorBoundary>
            } />
            <Route path="/analytics" element={
              <ErrorBoundary name="AnalyticsRoute">
                <ProtectedRoute><LearningAnalytics /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/grammar" element={
              <ErrorBoundary name="GrammarRoute">
                <GrammarDrills />
              </ErrorBoundary>
            } />
            <Route path="/mistakes" element={
              <ErrorBoundary name="MistakesRoute">
                <ProtectedRoute><Mistakes /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/vocab-games" element={
              <ErrorBoundary name="VocabGamesRoute">
                <VocabGames />
              </ErrorBoundary>
            } />
            <Route path="/onboarding" element={
              <ErrorBoundary name="OnboardingRoute">
                <Onboarding />
              </ErrorBoundary>
            } />
            <Route path="/settings" element={
              <ErrorBoundary name="SettingsRoute">
                <ProtectedRoute><Settings /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/profile" element={
              <ErrorBoundary name="ProfileRoute">
                <ProtectedRoute><Profile /></ProtectedRoute>
              </ErrorBoundary>
            } />
            <Route path="/friends" element={
              <ErrorBoundary name="FriendsRoute"><ProtectedRoute><Friends /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/liked-videos" element={
              <ErrorBoundary name="LikedVideosRoute"><ProtectedRoute><LikedVideos /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/stories" element={
              <ErrorBoundary name="StoriesRoute"><Stories /></ErrorBoundary>
            } />
            <Route path="/today/story" element={
              <ErrorBoundary name="DailyStoryRoute"><ProtectedRoute><DailyStory /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/stories/:storyId" element={
              <ErrorBoundary name="StoryPlayerRoute"><StoryPlayer /></ErrorBoundary>
            } />
            <Route path="/battles" element={
              <ErrorBoundary name="VocabBattlesRoute"><ProtectedRoute><VocabBattles /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/battles/:battleId" element={
              <ErrorBoundary name="BattlePlayRoute"><ProtectedRoute><BattlePlay /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/souq-news" element={
              <ErrorBoundary name="SouqNewsRoute"><SouqNews /></ErrorBoundary>
            } />
            <Route path="/placement" element={
              <ErrorBoundary name="PlacementQuizRoute"><PlacementQuiz /></ErrorBoundary>
            } />
            <Route path="/my-transcriptions" element={
              <ErrorBoundary name="MyTranscriptionsRoute"><ProtectedRoute><MyTranscriptions /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/sounds" element={
              <ErrorBoundary name="EnglishSoundsRoute"><EnglishSounds /></ErrorBoundary>
            } />
            <Route path="/terms" element={
              <ErrorBoundary name="TermsRoute"><Terms /></ErrorBoundary>
            } />
            <Route path="/privacy" element={
              <ErrorBoundary name="PrivacyRoute"><Privacy /></ErrorBoundary>
            } />

            <Route path="/sounds/checkpoint/:index" element={
              <ErrorBoundary name="SoundsCheckpointRoute"><ProtectedRoute><SoundsCheckpoint /></ProtectedRoute></ErrorBoundary>
            } />
            <Route path="/sounds/:soundCode" element={
              <ErrorBoundary name="EnglishSoundRoute"><EnglishSound /></ErrorBoundary>
            } />

            {/* Standalone login — must sit OUTSIDE AdminLayout, which redirects
                unauthenticated visitors here before rendering its Outlet. */}
            <Route path="/admin/login" element={<ErrorBoundary name="AdminLoginRoute"><AdminLogin /></ErrorBoundary>} />

            <Route path="/admin" element={<ErrorBoundary name="AdminRoute"><AdminLayout /></ErrorBoundary>}>
              <Route index element={<Dashboard />} />
              {/* Curriculum routes */}
              <Route path="curriculum" element={<Stages />} />
              <Route path="lessons/import" element={<LessonImport />} />
              <Route path="lessons/:lessonId/words" element={<LessonWords />} />
              {/* Legacy topic routes (still used for word management) */}
              <Route path="topics" element={<Topics />} />
              <Route path="topics/new" element={<TopicForm />} />
              <Route path="topics/:topicId/edit" element={<TopicForm />} />
              <Route path="topics/:topicId/words" element={<Words />} />
              <Route path="topics/:topicId/words/new" element={<WordForm />} />
              <Route
                path="topics/:topicId/words/:wordId/edit"
                element={<WordForm />}
              />
              <Route path="topics/:topicId/words/bulk" element={<BulkWordImport />} />
              <Route path="videos" element={<AdminVideos />} />
              <Route path="videos/new" element={<AdminVideoForm />} />
              <Route path="videos/:videoId/edit" element={<AdminVideoForm />} />
              <Route path="curriculum-builder" element={<CurriculumBuilder />} />
              <Route path="curriculum-builder/:sessionId" element={<CurriculumBuilder />} />
              <Route path="stories" element={<AdminStories />} />
              <Route path="stories/new" element={<AdminStoryForm />} />
              <Route path="stories/:storyId/edit" element={<AdminStoryForm />} />
              <Route path="trending" element={<TrendingVideos />} />
              <Route path="coverage" element={<AdminCoverage />} />
              <Route path="memes" element={<AdminMemes />} />
              <Route path="memes/new" element={<AdminMemeForm />} />
              <Route path="memes/:memeId" element={<AdminMemeForm />} />
              <Route path="set-phrases" element={<AdminSetPhrases />} />
              <Route path="dialect-rules" element={<AdminDialectRules />} />
              <Route path="interference-rules" element={<AdminInterferenceRules />} />
              <Route path="invite-codes" element={<AdminInviteCodes />} />
              <Route path="errors" element={<AdminErrors />} />
              <Route path="metrics" element={<AdminFeatureMetrics />} />
              <Route path="feedback" element={<AdminFeedback />} />
              <Route path="reading-library" element={<AdminReadingLibrary />} />
              <Route path="reading-library/new" element={<AdminReadingLibraryForm />} />
              <Route path="reading-library/:id/edit" element={<AdminReadingLibraryForm />} />
            </Route>

            <Route path="/set-phrases" element={<ErrorBoundary name="SetPhrasesRoute"><SetPhrases /></ErrorBoundary>} />
            <Route path="/set-phrases/practice" element={<ErrorBoundary name="SetPhrasesPracticeRoute"><SetPhrasesPractice /></ErrorBoundary>} />
            <Route path="/set-phrases/review" element={<ErrorBoundary name="SetPhrasesReviewRoute"><SetPhrasesReview /></ErrorBoundary>} />
            <Route path="/reading-library" element={<ErrorBoundary name="ReadingLibraryRoute"><ReadingLibrary /></ErrorBoundary>} />
            <Route path="/reading-library/:id" element={<ErrorBoundary name="ReadingLibraryStoryRoute"><ReadingLibraryStory /></ErrorBoundary>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          {/* App-wide chrome, not page chrome. The tour points at the dock,
              and the dock now outlives any single layout — it is on the feed,
              which does not use AppShell at all. Mounting it here is what
              makes the first-run tour reachable from the front door. It gates
              itself on a localStorage flag, so it costs nothing elsewhere. */}
          <OnboardingTour />
          <AssistantMount />
          </AiAssistantProvider>
        </BrowserRouter>
      </TooltipProvider>
      </DialectProvider>
    </QueryClientProvider>
  );
};

export default App;
