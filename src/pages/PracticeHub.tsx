import { Brain, Mic, MessageSquare, Headphones, FileText, Gamepad2, Swords, Flame, BookOpen, MessageCircle, AlertTriangle, PenLine } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader, HubSection } from "@/components/layout/HubGrid";
import { useAuth } from "@/hooks/useAuth";
import { useSRSStats } from "@/hooks/useSRSStats";
import { useMistakes } from "@/hooks/useLearnerErrors";
import { useDialect } from "@/contexts/DialectContext";
import { Badge } from "@/components/ui/badge";

const PracticeHub = () => {
  const { isAuthenticated } = useAuth();
  const { activeDialect } = useDialect();
  const { data: srs } = useSRSStats();
  const due = srs?.totalDueNow ?? 0;
  // Distinct targets, not raw rows: six misses on one word is one thing to fix.
  const { data: mistakes } = useMistakes(activeDialect);
  const mistakeCount = mistakes?.length ?? 0;

  return (
    <AppShell>
      <HubHeader title="Practice" subtitle="Sharpen what you've learned." />

      <HubSection
        title="Spaced repetition"
        tiles={[
          {
            id: "review",
            label: "Review",
            description: due > 0 ? `${due} cards due now` : "Curriculum SRS",
            icon: Brain,
            to: "/review",
            accent: "bg-primary/10 text-primary",
            badge: due > 0 ? <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">{due}</Badge> : undefined,
          },
          {
            id: "my-words-review",
            label: "My Words Review",
            description: "Drill your saved vocabulary",
            icon: BookOpen,
            to: "/review/my-words",
            accent: "bg-primary/10 text-primary",
            show: isAuthenticated,
          },
          {
            id: "my-phrases-review",
            label: "My Phrases Review",
            description: "Drill your saved phrases",
            icon: MessageCircle,
            to: "/review/my-phrases",
            accent: "bg-emerald-500/10 text-emerald-600",
            show: isAuthenticated,
          },
        ]}
      />

      <HubSection
        title="Speaking"
        tiles={[
          {
            id: "pronunciation",
            label: "Pronunciation Practice",
            description: "Record yourself & get AI feedback",
            icon: Mic,
            to: "/pronunciation",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "conversation",
            label: "Conversation Simulator",
            description: "Free-form chat with native voices",
            icon: MessageSquare,
            to: "/conversation",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "native-feedback",
            label: "Native Feedback",
            description: "A real native speaker corrects your writing",
            icon: PenLine,
            to: "/native-feedback",
            accent: "bg-emerald-500/10 text-emerald-600",
            show: isAuthenticated,
          },
          {
            id: "mistakes",
            label: "Your Mistakes",
            description: "What keeps tripping you up",
            icon: AlertTriangle,
            to: "/mistakes",
            accent: "bg-amber-500/10 text-amber-600",
            show: isAuthenticated,
            badge: mistakeCount > 0
              ? (
                <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">
                  {mistakeCount}
                </Badge>
              )
              : undefined,
          },
        ]}
      />

      <HubSection
        title="Skills"
        tiles={[
          {
            id: "writing",
            label: "Writing",
            description: "Reply in dialect & get corrected",
            icon: PenLine,
            to: "/write",
            accent: "bg-violet-500/10 text-violet-600",
            show: isAuthenticated,
          },
          {
            id: "listening",
            label: "Listening Practice",
            description: "Dictation, comprehension & speed drills",
            icon: Headphones,
            to: "/listening",
            accent: "bg-cyan-500/10 text-cyan-600",
          },
          {
            id: "reading",
            label: "Reading Practice",
            description: "Passages with tap-to-translate",
            icon: FileText,
            to: "/reading",
            accent: "bg-indigo-500/10 text-indigo-600",
          },
        ]}
      />

      <HubSection
        title="Play"
        tiles={[
          {
            id: "vocab-games",
            label: "Vocabulary Games",
            description: "Matching, memory & fill-in-the-blank",
            icon: Gamepad2,
            to: "/vocab-games",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "battles",
            label: "Vocab Battles",
            description: "Head-to-head vocabulary duels",
            icon: Swords,
            to: "/battles",
            accent: "bg-red-500/10 text-red-500",
            show: isAuthenticated,
          },
          {
            id: "daily",
            label: "Daily Challenge",
            description: "Fresh bite-sized mission for bonus XP",
            icon: Flame,
            to: "/daily-challenge",
            accent: "bg-orange-500/10 text-orange-600",
          },
        ]}
      />
    </AppShell>
  );
};

export default PracticeHub;
