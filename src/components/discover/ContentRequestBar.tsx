import { useState } from "react";
import { Send, Sparkles, Video, User, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const REQUEST_TYPES = [
  { value: "video", label: "فيديو / رابط", icon: Video },
  { value: "creator", label: "صانع محتوى", icon: User },
  { value: "topic", label: "موضوع", icon: MessageSquare },
] as const;

type RequestType = (typeof REQUEST_TYPES)[number]["value"];

export const ContentRequestBar = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RequestType>("video");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const placeholders: Record<RequestType, string> = {
    video: "الصق رابطاً أو صف الفيديو الذي تريده…",
    creator: "اذكر صانع محتوى أو مؤثراً يتحدث الإنجليزية…",
    topic: "ما الموضوع الذي تريد أن تتعلم عنه؟",
  };

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (trimmed.length > 500) {
      toast.error("الطلب طويل جداً (الحد الأقصى 500 حرف)");
      return;
    }
    if (!user) {
      toast.error("سجّل الدخول لطلب محتوى");
      return;
    }

    setSending(true);
    const { error } = await supabase.from("content_requests").insert({
      user_id: user.id,
      request_type: type,
      body: trimmed,
    });
    setSending(false);

    if (error) {
      console.error("Request error:", error);
      toast.error("تعذّر إرسال الطلب");
    } else {
      toast.success("تم إرسال الطلب! سننظر فيه 🙏");
      setBody("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 text-sm text-primary hover:bg-primary/10 transition-colors flex items-center justify-center gap-2"
      >
        <Sparkles className="h-4 w-4" />
        اطلب محتوى — اقترح فيديو أو صانع محتوى أو موضوعاً
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-medium text-foreground">ماذا تريد أن تشاهد؟</p>
      </div>

      {/* Type selector */}
      <div className="flex gap-2">
        {REQUEST_TYPES.map((rt) => {
          const Icon = rt.icon;
          return (
            <button
              key={rt.value}
              onClick={() => setType(rt.value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                type === rt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {rt.label}
            </button>
          );
        })}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholders[type]}
          maxLength={500}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          dir="auto"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!body.trim() || sending}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <button
        onClick={() => { setOpen(false); setBody(""); }}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        إلغاء
      </button>
    </div>
  );
};
