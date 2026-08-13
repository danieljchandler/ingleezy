import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getSRSStageByStability } from "@/lib/srsStats";

export interface AnalyticsData {
  totalWords: number;
  masteredWords: number;
  learningWords: number;
  newWords: number;
  totalReviews: number;
  accuracy: number;
  currentStreak: number;
  longestStreak: number;
  totalXP: number;
  level: number;
  stageBreakdown: { stage: string; count: number }[];
  dailyActivity: { date: string; reviews: number; correct: number }[];
  challengeStreak: number;
  challengesCompleted: number;
  skillRadar: { skill: string; value: number }[];
  vocabGrowth: { date: string; total: number }[];
  weeklyAccuracy: { week: string; accuracy: number }[];
  topMistakes: { word: string; errorRate: number }[];
  studyMinutes: number;
  wordsLearnedThisWeek: number;
}

const STAGE_ORDER = ["NEW", "STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "STAGE_5"];
const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  STAGE_1: "Learning",
  STAGE_2: "Familiar",
  STAGE_3: "Practiced",
  STAGE_4: "Strong",
  STAGE_5: "Mastered",
};

export function useLearningAnalytics() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["learning-analytics", user?.id],
    queryFn: async (): Promise<AnalyticsData> => {
      if (!user) throw new Error("Not authenticated");

      const [
        wordReviewsRes,
        userVocabRes,
        streakRes,
        xpRes,
        challengeRes,
        difficultyRes,
      ] = await Promise.all([
        supabase
          .from("word_reviews")
          .select("repetitions, ease_factor, review_count, correct_count, last_reviewed_at, created_at")
          .eq("user_id", user.id),
        supabase
          .from("user_vocabulary")
          .select("repetitions, ease_factor, review_count, correct_count, last_reviewed_at, created_at, word_arabic, word_english")
          .eq("user_id", user.id),
        supabase
          .from("review_streaks")
          .select("current_streak, longest_streak")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("user_xp")
          .select("total_xp, level")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("daily_challenge_completions" as any)
          .select("challenge_date, score, max_score")
          .eq("user_id", user.id)
          .order("challenge_date", { ascending: false }),
        supabase
          .from("user_difficulty")
          .select("vocab_difficulty, listening_difficulty, reading_difficulty, speaking_difficulty")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      // Surface the core query failures instead of silently rendering a
      // dashboard full of zeros. The word sources drive nearly every metric,
      // so if either fails let React Query show the error/retry state.
      if (wordReviewsRes.error) throw wordReviewsRes.error;
      if (userVocabRes.error) throw userVocabRes.error;

      const allWords = [
        ...(wordReviewsRes.data || []),
        ...(userVocabRes.data || []),
      ];

      const totalWords = allWords.length;
      const totalReviews = allWords.reduce((sum, w) => sum + (w.review_count || 0), 0);
      const totalCorrect = allWords.reduce((sum, w) => sum + (w.correct_count || 0), 0);
      const accuracy = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;

      // Stage breakdown.
      //
      // This used to read the persisted `stage` column, which only the Anki
      // importer ever writes — the review paths never update it, so for words
      // added in-app it stayed at its database default no matter how much you
      // reviewed, and this chart never moved. (Its repetition fallback was dead
      // too: it read `repetitions`, which wasn't in the SELECT.)
      //
      // Derive the stage from live SRS state instead, using the same helper as
      // the Card Health chart on this page so both agree.
      const stageCounts: Record<string, number> = {};
      STAGE_ORDER.forEach((s) => (stageCounts[s] = 0));
      const SRS_STAGE_TO_BUCKET: Record<ReturnType<typeof getSRSStageByStability>, string> = {
        new: "NEW",
        learning: "STAGE_1",
        familiar: "STAGE_2",
        practiced: "STAGE_3",
        strong: "STAGE_4",
        mastered: "STAGE_5",
      };
      allWords.forEach((w) => {
        const reps = (w as { repetitions?: number | null }).repetitions ?? 0;
        const stability = (w as { ease_factor?: number | null }).ease_factor ?? 0;
        stageCounts[SRS_STAGE_TO_BUCKET[getSRSStageByStability(reps, stability)]]++;
      });

      const stageBreakdown = STAGE_ORDER.map((stage) => ({
        stage: STAGE_LABELS[stage] || stage,
        count: stageCounts[stage] || 0,
      }));

      const masteredWords = stageCounts["STAGE_5"] || 0;
      const newWords = stageCounts["NEW"] || 0;
      const learningWords = totalWords - masteredWords - newWords;

      // Daily activity (last 14 days) with correct count
      const dailyMap: Record<string, { reviews: number; correct: number }> = {};
      const today = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dailyMap[d.toISOString().split("T")[0]] = { reviews: 0, correct: 0 };
      }

      allWords.forEach((w) => {
        if (w.last_reviewed_at) {
          const dateStr = new Date(w.last_reviewed_at).toISOString().split("T")[0];
          if (dailyMap[dateStr]) {
            dailyMap[dateStr].reviews++;
            // Approximate correct from ratio
            if (w.review_count > 0 && w.correct_count > 0) {
              dailyMap[dateStr].correct++;
            }
          }
        }
      });

      const dailyActivity = Object.entries(dailyMap).map(([date, data]) => ({
        date,
        reviews: data.reviews,
        correct: data.correct,
      }));

      // Vocab growth over time (cumulative words added by date)
      const growthMap: Record<string, number> = {};
      allWords.forEach((w) => {
        if (w.created_at) {
          const d = new Date(w.created_at).toISOString().split("T")[0];
          growthMap[d] = (growthMap[d] || 0) + 1;
        }
      });

      const sortedDates = Object.keys(growthMap).sort();
      let cumulative = 0;
      const vocabGrowth = sortedDates.map((date) => {
        cumulative += growthMap[date];
        return { date, total: cumulative };
      });

      // Weekly accuracy (last 4 weeks)
      const weeklyAccuracy: { week: string; accuracy: number }[] = [];
      for (let w = 3; w >= 0; w--) {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - (w * 7 + today.getDay()));
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        const weekStr = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;

        const weekWords = allWords.filter((word) => {
          if (!word.last_reviewed_at) return false;
          const d = new Date(word.last_reviewed_at);
          return d >= weekStart && d < weekEnd;
        });

        const weekReviews = weekWords.reduce((s, w2) => s + (w2.review_count || 0), 0);
        const weekCorrect = weekWords.reduce((s, w2) => s + (w2.correct_count || 0), 0);
        weeklyAccuracy.push({
          week: weekStr,
          accuracy: weekReviews > 0 ? Math.round((weekCorrect / weekReviews) * 100) : 0,
        });
      }

      // Top mistakes (words with worst accuracy)
      const vocabWords = userVocabRes.data || [];
      const topMistakes = vocabWords
        .filter((w) => (w.review_count || 0) >= 2)
        .map((w) => ({
          word: (w as any).word_arabic || "?",
          errorRate: w.review_count > 0
            ? Math.round(((w.review_count - w.correct_count) / w.review_count) * 100)
            : 0,
        }))
        .sort((a, b) => b.errorRate - a.errorRate)
        .slice(0, 5);

      // Skill radar from user_difficulty
      const diff = difficultyRes.data;
      const skillRadar = [
        { skill: "Vocabulary", value: Math.round((diff?.vocab_difficulty || 0.5) * 100) },
        { skill: "Listening", value: Math.round((diff?.listening_difficulty || 0.5) * 100) },
        { skill: "Reading", value: Math.round((diff?.reading_difficulty || 0.5) * 100) },
        { skill: "Speaking", value: Math.round((diff?.speaking_difficulty || 0.5) * 100) },
        { skill: "Culture", value: Math.min(100, Math.round((totalWords / 200) * 100)) },
      ];

      // Words learned this week
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 7);
      const wordsLearnedThisWeek = allWords.filter((w) => {
        if (!w.created_at) return false;
        return new Date(w.created_at) >= weekAgo;
      }).length;

      // Estimated study minutes (rough: 1 review ≈ 0.5 min)
      const studyMinutes = Math.round(totalReviews * 0.5);

      const challenges = (challengeRes.data as any[]) || [];

      // Consecutive-day daily-challenge streak, counted back from today. The
      // streak stays "current" if today isn't done yet but yesterday was.
      const toLocalKey = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const challengeDates = new Set(
        challenges.map((c) => String(c.challenge_date).slice(0, 10)),
      );
      let challengeStreak = 0;
      const cursor = new Date();
      cursor.setHours(0, 0, 0, 0);
      if (!challengeDates.has(toLocalKey(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (challengeDates.has(toLocalKey(cursor))) {
        challengeStreak++;
        cursor.setDate(cursor.getDate() - 1);
      }

      return {
        totalWords,
        masteredWords,
        learningWords,
        newWords,
        totalReviews,
        accuracy,
        currentStreak: streakRes.data?.current_streak || 0,
        longestStreak: streakRes.data?.longest_streak || 0,
        totalXP: xpRes.data?.total_xp || 0,
        level: xpRes.data?.level || 1,
        stageBreakdown,
        dailyActivity,
        challengeStreak,
        challengesCompleted: challenges.length,
        skillRadar,
        vocabGrowth,
        weeklyAccuracy,
        topMistakes,
        studyMinutes,
        wordsLearnedThisWeek,
      };
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

export { STAGE_LABELS };
