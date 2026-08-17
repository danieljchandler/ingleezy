import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { CheckCircle2, Clock, Loader2, PenLine, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";

interface FeedbackRequest {
  id: string;
  dialect: string;
  text: string;
  status: "pending" | "answered" | "declined";
  response_text: string | null;
  reviewer_notes: string | null;
  created_at: string;
  answered_at: string | null;
}

interface FeedbackStatus {
  balance: number;
  requests: FeedbackRequest[];
  credits_per_pack: number;
  purchase_enabled: boolean;
}

/**
 * Paid native feedback: write something in dialect, a real native speaker
 * corrects it within the reviewers' normal queue, the answer lands here.
 * A dismissed request refunds its credit automatically (the settle trigger).
 */
const NativeFeedback = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { activeDialect } = useDialect();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("native-feedback", {
      body: { action: "status" },
    });
    if (!error && data && typeof data.balance === "number") setStatus(data as FeedbackStatus);
  }, []);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // Returning from Stripe: confirm the session (exactly-once server-side),
  // then drop the param so a bookmark doesn't re-confirm forever.
  useEffect(() => {
    const sessionId = searchParams.get("purchase");
    if (!sessionId || !user) return;
    void (async () => {
      const { data } = await supabase.functions.invoke("native-feedback", {
        body: { action: "confirm", sessionId },
      });
      if (data?.ok) toast.success("أُضيفت الأرصدة!");
      setSearchParams({}, { replace: true });
      void load();
    })();
  }, [searchParams, setSearchParams, user, load]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("native-feedback", {
        body: { action: "submit", dialect: activeDialect, text },
      });
      if (error || data?.error) {
        toast.error((data as { message?: string } | null)?.message ?? "ما وصل الطلب — جرّب مرة ثانية.");
        return;
      }
      toast.success("أُرسل! بيرد عليك متحدث أصلي خلال ٤٨ ساعة تقريباً.");
      setText("");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const buy = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("native-feedback", {
        body: { action: "purchase" },
      });
      if (error || !data?.url) {
        toast.error("ما بدأت عملية الشراء — جرّب مرة ثانية.");
        return;
      }
      window.open(data.url as string, "_blank");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageCorner />
      <h1 className="mb-2 text-2xl font-bold text-foreground">ملاحظات متحدث أصلي</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Write something in {activeDialect} Arabic — a real native speaker corrects it, usually
        within 48 hours. One credit per submission; a request we can't answer is refunded.
      </p>

      <div className="mb-6 flex items-center justify-between rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-sm font-medium">الأرصدة</p>
          <p className="text-2xl font-bold">{status?.balance ?? "—"}</p>
        </div>
        {status?.purchase_enabled && (
          <Button onClick={buy} disabled={busy} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            اشترِ {status.credits_per_pack} رصيد
          </Button>
        )}
      </div>

      <div className="mb-8 space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب كم جملة بالإنجليزي…"
          dir="auto"
          rows={4}
          aria-label="نصّك"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.trim().length}/2000</span>
          <Button
            onClick={submit}
            disabled={busy || text.trim().length < 20 || (status !== null && status.balance < 1)}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            Send to a native speaker
          </Button>
        </div>
        {status !== null && status.balance < 1 && (
          <p className="text-xs text-muted-foreground">
            {status.purchase_enabled
              ? "خلص رصيدك — خذ باقة فوق عشان تكمل."
              : "أرصدة الملاحظات ما بعد نزلت للبيع — ارجع قريباً."}
          </p>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        طلباتك
      </h2>
      <div className="space-y-3">
        {(status?.requests ?? []).map((request) => (
          <div key={request.id} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              {request.status === "answered" ? (
                <Badge className="gap-1 bg-emerald-600 text-white"><CheckCircle2 className="h-3 w-3" />مُجاب</Badge>
              ) : request.status === "declined" ? (
                <Badge variant="outline" className="gap-1"><Undo2 className="h-3 w-3" />مُسترد</Badge>
              ) : (
                <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />بانتظار الرد</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(request.created_at).toLocaleDateString()}
              </span>
            </div>
            <p dir="auto" className="text-sm">{request.text}</p>
            {request.response_text && (
              <div className="mt-3 rounded-lg bg-emerald-500/10 p-3">
                <p className="mb-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  صيغة الناطق الأصلي
                </p>
                <p dir="auto" className="text-sm">{request.response_text}</p>
                {request.reviewer_notes && (
                  <p className="mt-2 text-xs text-muted-foreground">{request.reviewer_notes}</p>
                )}
              </div>
            )}
            {request.status === "declined" && request.reviewer_notes && (
              <p className="mt-2 text-xs text-muted-foreground">{request.reviewer_notes}</p>
            )}
          </div>
        ))}
        {status !== null && status.requests.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing yet — your first correction is one paragraph away.
          </p>
        )}
      </div>
    </AppShell>
  );
};

export default NativeFeedback;
