import { GraduationCap, BookOpen, Globe2, PenTool, MessageCircle, Sparkles, Library, Headphones, Shuffle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader, HubSection } from "@/components/layout/HubGrid";

const LearnHub = () => {
  return (
    <AppShell>
      <HubHeader title="Learn" subtitle="Build your foundation, step by step." />

      <HubSection
        title="Start here"
        tiles={[
          {
            id: "placement",
            label: "Placement Quiz",
            description: "20 adaptive questions to find your CEFR level",
            icon: GraduationCap,
            to: "/placement",
            accent: "bg-primary/15 text-primary",
          },
          {
            id: "alphabet",
            label: "Alphabet Journey",
            description: "Learn all 28 letters — trace, hear & play",
            icon: BookOpen,
            to: "/alphabet",
            accent: "bg-amber-500/15 text-amber-600",
          },
        ]}
      />

      <HubSection
        title="Curriculum"
        tiles={[
          {
            id: "lessons",
            label: "Lessons",
            // Was pointing at /learn, which with no lesson id serves a shuffled
            // batch of five unseen words — the opposite of a path.
            description: "Stage by stage, with your progress saved",
            icon: Sparkles,
            to: "/curriculum",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "quick-practice",
            label: "Quick Practice",
            description: "A fast batch of new words, no path required",
            icon: Shuffle,
            to: "/learn",
            accent: "bg-sky-500/10 text-sky-600",
          },
          {
            id: "grammar",
            label: "Grammar Drills",
            description: "AI conjugation, pronouns & structure practice",
            icon: PenTool,
            to: "/grammar",
            accent: "bg-violet-500/10 text-violet-600",
          },
          {
            id: "set-phrases",
            label: "Set Phrases",
            description: "Greetings, weddings, Eid wishes & more",
            icon: MessageCircle,
            to: "/set-phrases",
            accent: "bg-emerald-500/10 text-emerald-600",
          },
        ]}
      />

      <HubSection
        title="Reading & Listening"
        tiles={[
          {
            id: "reading-library",
            label: "Reading Library",
            description: "Authentic Arabic stories with synced audio",
            icon: Library,
            to: "/reading-library",
            accent: "bg-indigo-500/10 text-indigo-600",
          },
          {
            id: "listen",
            label: "Listen",
            description: "AI podcasts, talks & interviews in your dialect",
            icon: Headphones,
            to: "/listen",
            accent: "bg-amber-500/10 text-amber-600",
          },
        ]}
      />
    </AppShell>
  );
};

export default LearnHub;
