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
      <HubHeader title="تدرّب" subtitle="اصقل ما تعلّمته." />

      <HubSection
        title="التكرار المتباعد"
        tiles={[
          {
            id: "review",
            label: "المراجعة",
            description: due > 0 ? `${due} بطاقة مستحقة الآن` : "مراجعة المنهج المتباعدة",
            icon: Brain,
            to: "/review",
            accent: "bg-primary/10 text-primary",
            badge: due > 0 ? <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">{due}</Badge> : undefined,
          },
          {
            id: "my-words-review",
            label: "مراجعة كلماتي",
            description: "تدرّب على مفرداتك المحفوظة",
            icon: BookOpen,
            to: "/review/my-words",
            accent: "bg-primary/10 text-primary",
            show: isAuthenticated,
          },
          {
            id: "my-phrases-review",
            label: "مراجعة عباراتي",
            description: "تدرّب على عباراتك المحفوظة",
            icon: MessageCircle,
            to: "/review/my-phrases",
            accent: "bg-emerald-500/10 text-emerald-600",
            show: isAuthenticated,
          },
        ]}
      />

      <HubSection
        title="التحدث"
        tiles={[
          {
            id: "pronunciation",
            label: "تدريب النطق",
            description: "سجّل صوتك واحصل على ملاحظات الذكاء الاصطناعي",
            icon: Mic,
            to: "/pronunciation",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "conversation",
            label: "محاكي المحادثة",
            description: "حوار حر بأصوات متحدثين أصليين",
            icon: MessageSquare,
            to: "/conversation",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "native-feedback",
            label: "تصحيح من متحدث أصلي",
            description: "متحدث أصلي حقيقي يصحّح كتابتك",
            icon: PenLine,
            to: "/native-feedback",
            accent: "bg-emerald-500/10 text-emerald-600",
            show: isAuthenticated,
          },
          {
            id: "mistakes",
            label: "أخطاؤك",
            description: "ما الذي يتعثّر معك باستمرار",
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
        title="المهارات"
        tiles={[
          {
            id: "writing",
            label: "الكتابة",
            description: "اكتب بالإنجليزية واحصل على التصحيح",
            icon: PenLine,
            to: "/write",
            accent: "bg-violet-500/10 text-violet-600",
            show: isAuthenticated,
          },
          {
            id: "listening",
            label: "تدريب الاستماع",
            description: "إملاء وفهم وتمارين سرعة",
            icon: Headphones,
            to: "/listening",
            accent: "bg-cyan-500/10 text-cyan-600",
          },
          {
            id: "reading",
            label: "تدريب القراءة",
            description: "نصوص مع ترجمة بلمسة واحدة",
            icon: FileText,
            to: "/reading",
            accent: "bg-indigo-500/10 text-indigo-600",
          },
        ]}
      />

      <HubSection
        title="العب"
        tiles={[
          {
            id: "vocab-games",
            label: "ألعاب المفردات",
            description: "توصيل وذاكرة وملء الفراغات",
            icon: Gamepad2,
            to: "/vocab-games",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "battles",
            label: "معارك المفردات",
            description: "منافسات مفردات وجهاً لوجه",
            icon: Swords,
            to: "/battles",
            accent: "bg-red-500/10 text-red-500",
            show: isAuthenticated,
          },
          {
            id: "daily",
            label: "تحدي اليوم",
            description: "مهمة قصيرة جديدة كل يوم لنقاط إضافية",
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
