import { useEffect, useState } from "react";
import { AR } from "@/lib/strings";
import { useReviewSession } from "@/hooks/useReviewSession";
import { useUserSetPhrasesDueCount } from "@/hooks/useSetPhrases";
import { useTodaysVideo } from "@/hooks/useTodaysVideo";
import { isTaskCompletedToday } from "@/lib/todayCompletion";
import { BookOpen, Play, Newspaper, MessageCircle, Flame, Brain, Sparkles, type LucideIcon } from "lucide-react";

export type TodayTaskId =
  | "flashcards"
  | "daily-challenge"
  | "daily-story"
  | "reading"
  | "listening"
  | "souq"
  | "set-phrases";

export interface TodayTask {
  id: TodayTaskId;
  title: string;
  subtitle?: string;
  countBadge?: string;
  estMinutes: number;
  icon: LucideIcon;
  route: string;
  done: boolean;
  hidden?: boolean;
  xpEstimate: number;
}

const useCompletionTick = () => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("today:tasks-changed", onChange);
    return () => window.removeEventListener("today:tasks-changed", onChange);
  }, []);
};

export const useTodayQueue = (): TodayTask[] => {
  useCompletionTick();
  // Covers all three SRS decks (curriculum, saved words, saved phrases) — the
  // flashcards task used to count only the personal-vocabulary deck, so cards
  // due elsewhere never showed up in the daily queue.
  const session = useReviewSession();
  const { data: phrasesDue } = useUserSetPhrasesDueCount();
  // The same pick the home page leads with, so the task and the card at the top
  // of the page can never point at two different clips.
  const { video: todaysVideo } = useTodaysVideo();

  const vocabDueCount = session.totalDue;

  const tasks: TodayTask[] = [
    {
      id: "flashcards",
      title: vocabDueCount > 0 ? AR.queue.reviewWords(vocabDueCount) : AR.queue.flashcardsDone,
      subtitle: AR.queue.srs,
      countBadge: vocabDueCount > 0 ? String(vocabDueCount) : undefined,
      estMinutes: Math.max(2, Math.min(15, Math.ceil(vocabDueCount * 0.4))),
      icon: Brain,
      // "/review" is the session entry point — it walks every deck that has
      // cards due, forwarding past any that are already clear.
      route: "/review",
      done: vocabDueCount === 0,
      hidden: vocabDueCount === 0 && !isTaskCompletedToday("flashcards"),
      xpEstimate: vocabDueCount * 3,
    },
    {
      id: "daily-challenge",
      title: AR.queue.dailyChallenge,
      subtitle: AR.queue.streakMultiplier,
      estMinutes: 3,
      icon: Flame,
      route: "/daily-challenge",
      done: isTaskCompletedToday("daily-challenge"),
      xpEstimate: 20,
    },
    {
      id: "daily-story",
      title: AR.queue.todaysStory,
      subtitle: AR.queue.builtFromYourWords,
      estMinutes: 4,
      icon: Sparkles,
      route: "/today/story",
      done: isTaskCompletedToday("daily-story"),
      xpEstimate: 25,
    },
    {
      id: "reading",
      title: AR.queue.readPassage,
      subtitle: AR.queue.readingPractice,
      estMinutes: 5,
      icon: BookOpen,
      route: "/reading",
      done: isTaskCompletedToday("reading"),
      xpEstimate: 15,
    },
    {
      // Kept as "listening" because that is the key completions are stored
      // under in localStorage; renaming the id would silently un-tick the task
      // for everyone who had already done it today. The home page renders this
      // one as the WatchTodayCard hero rather than as a queue row, so it still
      // counts towards "n of m tasks done" without appearing twice.
      id: "listening",
      title: AR.queue.watchVideo,
      subtitle: AR.queue.discover,
      estMinutes: 3,
      icon: Play,
      // Straight to today's clip rather than the browse list — the point of the
      // task is that the choice has already been made.
      route: todaysVideo ? `/discover/${todaysVideo.id}` : "/discover",
      done: isTaskCompletedToday("listening"),
      hidden: !todaysVideo,
      xpEstimate: 10,
    },
    {
      id: "souq",
      title: AR.queue.souqArticle,
      subtitle: AR.queue.newsInEnglish,
      estMinutes: 4,
      icon: Newspaper,
      route: "/souq-news",
      done: isTaskCompletedToday("souq"),
      xpEstimate: 15,
    },
    {
      id: "set-phrases",
      title: phrasesDue && phrasesDue > 0 ? AR.queue.practicePhrases(phrasesDue) : AR.queue.phrasesDone,
      subtitle: AR.queue.everydayExpressions,
      countBadge: phrasesDue && phrasesDue > 0 ? String(phrasesDue) : undefined,
      estMinutes: 3,
      icon: MessageCircle,
      route: "/set-phrases",
      done: !phrasesDue || phrasesDue === 0,
      hidden: (!phrasesDue || phrasesDue === 0) && !isTaskCompletedToday("set-phrases"),
      xpEstimate: (phrasesDue ?? 0) * 3,
    },
  ];

  return tasks;
};
