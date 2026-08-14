import { BookOpen, MessageCircle, Languages, FileText, Heart, BarChart3, Trophy, Users, User, Settings, CreditCard, GraduationCap, Newspaper, Globe2, Compass, MessageCircleQuestion, Laugh, Twitter, Mic, BookOpen as Stories } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HubHeader, HubSection } from "@/components/layout/HubGrid";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAuth } from "@/hooks/useAdminAuth";

const MeHub = () => {
  const { isAuthenticated } = useAuth();
  const { isAdmin } = useAdminAuth();

  return (
    <AppShell>
      <HubHeader title="أنا" subtitle="مكتبتك وأدواتك وملفك الشخصي." />

      <HubSection
        title="مكتبتي"
        tiles={[
          { id: "my-words", label: "كلماتي", description: "بطاقات مفرداتك المحفوظة", icon: BookOpen, to: "/my-words", show: isAuthenticated },
          { id: "saved-translations", label: "ترجمات محفوظة", description: "ارجع إلى تحليلاتك السابقة", icon: Languages, to: "/translate/saved", show: isAuthenticated },
          { id: "my-transcriptions", label: "نصوصي المفرّغة", description: "تفريغات صوتية محفوظة", icon: FileText, to: "/my-transcriptions", show: isAuthenticated },
          { id: "liked", label: "فيديوهات أعجبتني", description: "فيديوهات حفظتها من اكتشف", icon: Heart, to: "/liked-videos", accent: "bg-red-500/10 text-red-500", show: isAuthenticated },
        ]}
      />

      <HubSection
        title="الأدوات"
        tiles={[
          { id: "translate", label: "ترجم واحفظ", description: "الصق نصاً إنجليزياً واحفظ المفردات", icon: Languages, to: "/translate" },
          { id: "transcribe", label: "تفريغ الصوت", description: "حوّل المقاطع الصوتية إلى نص", icon: Mic, to: "/transcribe" },
          { id: "tutor", label: "رفع درس خصوصي", description: "استخراج بطاقات تلقائياً من تسجيل درسك", icon: GraduationCap, to: "/tutor-upload", show: isAuthenticated },
          { id: "how-do-i-say", label: "كيف أقول…؟", description: "ترجم عباراتك إلى الإنجليزية", icon: MessageCircleQuestion, to: "/how-do-i-say" },
          { id: "culture", label: "ماذا أفعل؟", description: "دليل الثقافة وآداب التعامل", icon: Compass, to: "/culture-guide" },
        ]}
      />

      <HubSection
        title="المحتوى"
        tiles={[
          { id: "stories", label: "قصص تفاعلية", description: "اختر مغامرتك بالإنجليزية", icon: Stories, to: "/stories", accent: "bg-amber-500/10 text-amber-600" },
          { id: "souq", label: "أخبار السوق", description: "عناوين الأخبار بإنجليزية مبسّطة", icon: Newspaper, to: "/souq-news", accent: "bg-emerald-500/10 text-emerald-600" },
          { id: "meme", label: "محلل الميمز", description: "تحليل ميمز عربية (قيد التحويل للإنجليزية)", icon: Laugh, to: "/meme" },
          { id: "learn-from-x", label: "تعلّم من منشور X", description: "تحليل منشورات X عربية (قيد التحويل للإنجليزية)", icon: Twitter, to: "/learn-from-x" },
        ]}
      />

      <HubSection
        title="التقدم والأصدقاء"
        tiles={[
          { id: "analytics", label: "إحصاءات التعلم", description: "رسوم بيانية لتقدّمك", icon: BarChart3, to: "/analytics", accent: "bg-blue-500/10 text-blue-600", show: isAuthenticated },
          { id: "leaderboard", label: "لوحة الصدارة", description: "ترتيبك هذا الأسبوع", icon: Trophy, to: "/leaderboard", accent: "bg-yellow-500/10 text-yellow-600" },
          { id: "friends", label: "الأصدقاء", description: "أضف أصدقاء وشاركهم تقدّمك", icon: Users, to: "/friends", show: isAuthenticated },
        ]}
      />

      <HubSection
        title="الحساب"
        tiles={[
          { id: "profile", label: "الملف الشخصي", icon: User, to: "/profile", show: isAuthenticated },
          { id: "settings", label: "الإعدادات", icon: Settings, to: "/settings", show: isAuthenticated },
          { id: "pricing", label: "الأسعار والباقات", icon: CreditCard, to: "/pricing" },
          { id: "admin", label: "الإدارة", description: "لوحة المحتوى والإشراف", icon: GraduationCap, to: "/admin", show: isAdmin },
        ]}
      />
    </AppShell>
  );
};

export default MeHub;
