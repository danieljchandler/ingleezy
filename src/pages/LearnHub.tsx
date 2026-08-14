import { GraduationCap, PenTool, MessageCircle, Sparkles, Library, Headphones, Shuffle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader, HubSection } from "@/components/layout/HubGrid";

const LearnHub = () => {
  return (
    <AppShell>
      <HubHeader title="تعلّم" subtitle="ابنِ أساسك خطوة بخطوة." />

      <HubSection
        title="ابدأ من هنا"
        tiles={[
          {
            id: "placement",
            label: "اختبار تحديد المستوى",
            description: "٢٠ سؤالاً متكيّفاً لتحديد مستواك في الإنجليزية",
            icon: GraduationCap,
            to: "/placement",
            accent: "bg-primary/15 text-primary",
          },
          // The Arabic Alphabet Journey tile lived here — hidden post-flip
          // (Arabic speakers don't need it). Returns as the English Sounds
          // journey; see RETARGET.md.
        ]}
      />

      <HubSection
        title="المنهج"
        tiles={[
          {
            id: "lessons",
            label: "الدروس",
            // Was pointing at /learn, which with no lesson id serves a shuffled
            // batch of five unseen words — the opposite of a path.
            description: "مرحلة بعد مرحلة، مع حفظ تقدّمك",
            icon: Sparkles,
            to: "/curriculum",
            accent: "bg-primary/10 text-primary",
          },
          {
            id: "quick-practice",
            label: "تدريب سريع",
            description: "دفعة سريعة من كلمات جديدة، بدون مسار",
            icon: Shuffle,
            to: "/learn",
            accent: "bg-sky-500/10 text-sky-600",
          },
          {
            id: "grammar",
            label: "تمارين القواعد",
            description: "تصريف الأفعال والضمائر وتركيب الجمل بالذكاء الاصطناعي",
            icon: PenTool,
            to: "/grammar",
            accent: "bg-violet-500/10 text-violet-600",
          },
          {
            id: "set-phrases",
            label: "عبارات جاهزة",
            description: "تحيات ومقابلات عمل ومواقف يومية وأكثر",
            icon: MessageCircle,
            to: "/set-phrases",
            accent: "bg-emerald-500/10 text-emerald-600",
          },
        ]}
      />

      <HubSection
        title="قراءة واستماع"
        tiles={[
          {
            id: "reading-library",
            label: "مكتبة القراءة",
            description: "قصص إنجليزية أصيلة مع صوت متزامن",
            icon: Library,
            to: "/reading-library",
            accent: "bg-indigo-500/10 text-indigo-600",
          },
          {
            id: "listen",
            label: "استمع",
            description: "بودكاست ومحادثات ومقابلات بالإنجليزية",
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
