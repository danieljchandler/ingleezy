import { BookOpen, MessageCircle, Languages, FileText, Heart, BarChart3, Trophy, Users, User, Settings, CreditCard, GraduationCap, BookMarked, Newspaper, Globe2, Compass, MessageCircleQuestion, Laugh, Twitter, Mic, BookOpen as Stories } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader, HubSection } from "@/components/layout/HubGrid";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useBibleAccess } from "@/hooks/useBibleAccess";

const MeHub = () => {
  const { isAuthenticated } = useAuth();
  const { isAdmin } = useAdminAuth();
  const { hasAccess: hasBible } = useBibleAccess();

  return (
    <AppShell>
      <HubHeader title="Me" subtitle="Your library, tools & profile." />

      <HubSection
        title="My library"
        tiles={[
          { id: "my-words", label: "My Words", description: "Saved vocabulary flashcards", icon: BookOpen, to: "/my-words", show: isAuthenticated },
          { id: "saved-translations", label: "Saved Translations", description: "Re-read past breakdowns", icon: Languages, to: "/translate/saved", show: isAuthenticated },
          { id: "my-transcriptions", label: "My Transcriptions", description: "Saved transcripts", icon: FileText, to: "/my-transcriptions", show: isAuthenticated },
          { id: "liked", label: "Liked Videos", description: "Videos you saved from Discover", icon: Heart, to: "/liked-videos", accent: "bg-red-500/10 text-red-500", show: isAuthenticated },
        ]}
      />

      <HubSection
        title="Tools"
        tiles={[
          { id: "translate", label: "Translate & Save", description: "Paste Arabic, save vocabulary", icon: Languages, to: "/translate" },
          { id: "transcribe", label: "Transcribe Audio", description: "Convert Arabic audio to text", icon: Mic, to: "/transcribe" },
          { id: "tutor", label: "Tutor Upload", description: "Auto-extract flashcards from tutor audio", icon: GraduationCap, to: "/tutor-upload", show: isAuthenticated },
          { id: "how-do-i-say", label: "How do I say…?", description: "Translate phrases into dialect", icon: MessageCircleQuestion, to: "/how-do-i-say" },
          { id: "culture", label: "What should I do?", description: "Culture & etiquette guide", icon: Compass, to: "/culture-guide" },
          { id: "dialect-compare", label: "Dialect Compare", description: "Same word across dialects", icon: Globe2, to: "/dialect-compare", accent: "bg-emerald-500/10 text-emerald-600" },
        ]}
      />

      <HubSection
        title="Content"
        tiles={[
          { id: "stories", label: "Interactive Stories", description: "Choose-your-adventure in Arabic", icon: Stories, to: "/stories", accent: "bg-amber-500/10 text-amber-600" },
          { id: "souq", label: "Souq News", description: "Headlines retold in dialect", icon: Newspaper, to: "/souq-news", accent: "bg-emerald-500/10 text-emerald-600" },
          { id: "bible", label: "Bible Reading", description: "Scripture in Arabic with tools", icon: BookMarked, to: "/bible", accent: "bg-amber-500/10 text-amber-600", show: hasBible },
          { id: "meme", label: "Meme Analyzer", description: "Break down Arabic memes", icon: Laugh, to: "/meme" },
          { id: "learn-from-x", label: "Learn from X Post", description: "Analyze Arabic X posts", icon: Twitter, to: "/learn-from-x" },
        ]}
      />

      <HubSection
        title="Progress & social"
        tiles={[
          { id: "analytics", label: "Learning Analytics", description: "Charts of your progress", icon: BarChart3, to: "/analytics", accent: "bg-blue-500/10 text-blue-600", show: isAuthenticated },
          { id: "leaderboard", label: "Leaderboard", description: "Where you stack up this week", icon: Trophy, to: "/leaderboard", accent: "bg-yellow-500/10 text-yellow-600" },
          { id: "friends", label: "Friends", description: "Add friends & share progress", icon: Users, to: "/friends", show: isAuthenticated },
        ]}
      />

      <HubSection
        title="Account"
        tiles={[
          { id: "profile", label: "Profile", icon: User, to: "/profile", show: isAuthenticated },
          { id: "settings", label: "Settings", icon: Settings, to: "/settings", show: isAuthenticated },
          { id: "pricing", label: "Pricing & Plans", icon: CreditCard, to: "/pricing" },
          { id: "admin", label: "Admin", description: "Content & moderation console", icon: GraduationCap, to: "/admin", show: isAdmin },
        ]}
      />
    </AppShell>
  );
};

export default MeHub;
